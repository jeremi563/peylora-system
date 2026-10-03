import { randomBytes } from "node:crypto";

import {
    buildStkPayload,
    extractCallbackMetadata,
    generateStkPassword,
    generateTimestamp,
    getAccessToken,
    queryStkStatus,
    sendStkPush
} from "../services/mpesa.service.js";
import {
    createPendingTransaction,
    getMerchantPayment,
    getMerchantTransaction,
    listMerchantPayments,
    markInitiationFailed,
    markReconciliationRequested,
    IdempotencyConflictError,
    recordReconciliationResponse,
    saveStkResponse
} from "../services/transaction.service.js";
import { enqueueMpesaCallback } from "../services/webhook.service.js";

export function getHome(req, res) {
    res.json({
        message: "Welcome to the homepage"
    });
}

async function initiatePayment(req, res, {
    merchantId,
    amount: fixedAmount,
    description: fixedDescription,
    paymentLinkId,
    invoiceId,
    idempotencyKey: fixedIdempotencyKey
}) {
    const requestBody = req.validatedBody ?? req.body ?? {};
    const amount = fixedAmount ?? requestBody.amount;
    const phoneNumber = requestBody.phoneNumber;
    const description = fixedDescription ?? requestBody.description;

    if (typeof phoneNumber !== "string" || !/^254[17]\d{8}$/.test(phoneNumber)) {
        return res.status(400).json({
            message: "phoneNumber must be a Kenyan mobile number in 254XXXXXXXXX format"
        });
    }

    if (!Number.isInteger(amount) || amount < 1) {
        return res.status(400).json({
            message: "amount must be a positive integer in KES"
        });
    }

    const callbackUrl = process.env.MPESA_CALLBACK_URL;
    if (!callbackUrl) {
        return res.status(500).json({
            message: "MPESA_CALLBACK_URL is not configured"
        });
    }

    const accountReference = randomBytes(6).toString("hex").toUpperCase();
    const idempotencyKey = fixedIdempotencyKey ?? req.get("Idempotency-Key")?.trim();
    if (idempotencyKey && !/^[\x21-\x7E]{1,128}$/.test(idempotencyKey)) {
        return res.status(400).json({ message: "Idempotency-Key must be 1-128 visible ASCII characters" });
    }

    let transaction;
    let stkRequestDispatched = false;

    try {
        transaction = await createPendingTransaction({
            merchantId,
            accountReference,
            phoneNumber,
            requestedAmount: amount,
            description,
            paymentLinkId,
            invoiceId,
            idempotencyKey
        });

        if (transaction.reused) {
            return res.status(200).json({
                message: "Existing payment request returned; no additional STK push was sent",
                transactionId: transaction._id?.toString(),
                paymentId: transaction.paymentId,
                accountReference: transaction.accountReference,
                checkoutRequestId: transaction.checkoutRequestId,
                status: transaction.status,
                reused: true
            });
        }

        const accessToken = await getAccessToken();
        const timestamp = generateTimestamp();
        const password = generateStkPassword(
            process.env.MPESA_SHORTCODE,
            process.env.MPESA_PASSKEY,
            timestamp
        );
        const payload = buildStkPayload({
            shortCode: process.env.MPESA_SHORTCODE,
            password,
            timestamp,
            amount,
            phoneNumber,
            callbackUrl,
            accountReference,
            transactionDesc: description || "Payment"
        });

        stkRequestDispatched = true;
        const result = await sendStkPush(payload, accessToken);
        const accepted = String(result.ResponseCode) === "0";

        if (!accepted) {
            await markInitiationFailed(
                transaction._id,
                result.ResponseDescription ?? "Daraja rejected the STK request",
                result
            );

            return res.status(502).json({
                message: "Daraja did not accept the STK push request",
                transactionId: transaction._id.toString(),
                status: "FAILED",
                daraja: result
            });
        }

        await saveStkResponse(transaction._id, result);

        return res.status(202).json({
            message: "STK push accepted; payment outcome will arrive through the callback",
            transactionId: transaction._id.toString(),
            paymentId: transaction.paymentId,
            accountReference,
            status: "PENDING",
            daraja: result
        });
    } catch (error) {
        if (error instanceof IdempotencyConflictError) {
            return res.status(409).json({ message: error.message });
        }
        const details = error.response?.data;
        if (transaction && (!stkRequestDispatched || error.response)) {
            try {
                await markInitiationFailed(
                    transaction._id,
                    details?.errorMessage ?? error.message,
                    details
                );
            } catch (persistenceError) {
                console.error("Could not update failed STK transaction:", persistenceError.message);
            }
        }

        console.error("STK Push Error:", details ?? error.message);

        return res.status(details ? 502 : 500).json({
            message: "Failed to initiate STK Push",
            ...(transaction ? {
                transactionId: transaction._id.toString(),
                status: stkRequestDispatched && !error.response ? "PENDING" : "FAILED"
            } : {}),
            ...(details ? { details } : {})
        });
    }
}

export function initiateStkPush(req, res) {
    return initiatePayment(req, res, { merchantId: req.auth.merchantId });
}

export function initiatePaymentLinkPayment(req, res, link) {
    const clientKey = req.get("Idempotency-Key")?.trim();
    if (clientKey && !/^[\x21-\x7E]{1,128}$/.test(clientKey)) {
        return res.status(400).json({ message: "Idempotency-Key must be 1-128 visible ASCII characters" });
    }

    return initiatePayment(req, res, {
        merchantId: link.merchant_id,
        amount: link.amount,
        description: link.description,
        paymentLinkId: link.id,
        invoiceId: link.invoice_id,
        idempotencyKey: clientKey ? `link:${link.id}:${clientKey}` : undefined
    });
}

export async function listPayments(req, res) {
    try {
        const query = req.validatedQuery;
        const result = await listMerchantPayments(req.auth.merchantId, query);
        return res.json({
            success: true,
            payments: result.items,
            pagination: {
                page: query.page,
                limit: query.limit,
                total: result.total,
                pages: Math.ceil(result.total / query.limit)
            }
        });
    } catch (error) {
        console.error("Could not list payments:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve payments" });
    }
}

export async function getPayment(req, res) {
    try {
        const payment = await getMerchantPayment(req.auth.merchantId, req.params.paymentId);
        if (!payment) {
            return res.status(404).json({ success: false, message: "Payment not found" });
        }
        return res.json({ success: true, payment });
    } catch (error) {
        console.error("Could not get payment:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve payment" });
    }
}

export async function getTransaction(req, res) {
    try {
        const transaction = await getMerchantTransaction(req.auth.merchantId, req.params.transactionId);
        if (!transaction) {
            return res.status(404).json({ success: false, message: "Transaction not found" });
        }
        return res.json({ success: true, transaction });
    } catch (error) {
        console.error("Could not get transaction:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve transaction" });
    }
}

export async function reconcileTransaction(req, res) {
    try {
        const pendingTransaction = await markReconciliationRequested(
            req.params.transactionId,
            req.auth.merchantId
        );
        if (!pendingTransaction) {
            return res.status(404).json({
                success: false,
                message: "Pending transaction with a Daraja checkout ID not found"
            });
        }

        const accessToken = await getAccessToken();
        const result = await queryStkStatus({
            shortCode: process.env.MPESA_SHORTCODE,
            passkey: process.env.MPESA_PASSKEY,
            timestamp: generateTimestamp(),
            checkoutRequestId: pendingTransaction.checkout_request_id
        }, accessToken);
        const stored = await recordReconciliationResponse(
            req.params.transactionId,
            req.auth.merchantId,
            result
        );

        return res.json({
            success: true,
            message: "Daraja status response recorded; transaction status changes only through the callback",
            transactionId: req.params.transactionId,
            response: result,
            recorded: stored
        });
    } catch (error) {
        console.error("Transaction reconciliation failed:", error.response?.data ?? error.message);
        return res.status(502).json({ success: false, message: "Could not query Daraja transaction status" });
    }
}

export async function receiveMpesaCallback(req, res) {
    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
        return res.status(200).json({
            ResultCode: 0,
            ResultDesc: "Callback received"
        });
    }

    try {
        const metadata = extractCallbackMetadata(callback.CallbackMetadata);
        const result = await enqueueMpesaCallback(callback, metadata, req.body);

        if (!result.accepted) {
            console.warn("Invalid M-Pesa callback ignored:", result.reason);
        } else if (result.duplicate) {
            console.info("Duplicate M-Pesa callback acknowledged:", result.status);
        } else {
            console.info("M-Pesa callback queued:", result.eventId);
        }

        return res.status(200).json({
            ResultCode: 0,
            ResultDesc: "Callback received"
        });
    } catch (error) {
        console.error("Could not persist M-Pesa callback:", error.message);
        return res.status(500).json({
            ResultCode: 1,
            ResultDesc: "Callback could not be processed"
        });
    }
}