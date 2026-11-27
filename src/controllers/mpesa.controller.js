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
    createPaymentAttempt,
    createPendingTransaction,
    findIdempotentRetry,
    getMerchantPayment,
    getMerchantTransaction,
    getRetryableMerchantPayment,
    listMerchantPayments,
    markInitiationFailed,
    markReconciliationRequested,
    IdempotencyConflictError,
    PaymentRequestFulfilledError,
    listReconciliationEvents,
    recordReconciliationResponse,
    saveStkResponse
} from "../services/transaction.service.js";
import { enqueueMpesaCallback } from "../services/webhook.service.js";

const LEGACY_IDEMPOTENCY_GRACE_MS = 90 * 24 * 60 * 60 * 1000;

function getPaymentIdempotencyKey(req, res) {
    const key = req.get("Idempotency-Key")?.trim();
    if (key && !/^[\x21-\x7E]{1,128}$/.test(key)) {
        res.status(400).json({ message: "Idempotency-Key must be 1-128 visible ASCII characters" });
        return { rejected: true };
    }

    if (key) {
        return { key };
    }

    const requestPath = req.originalUrl?.split("?")[0] ?? req.url;
    if (/^\/api\/v1(?:\/|$)/.test(requestPath)) {
        res.status(400).json({ message: "Idempotency-Key is required for versioned payment requests" });
        return { rejected: true };
    }

    console.info("Legacy keyless payment request observed", {
        route: req.route?.path ?? "payment initiation"
    });
    const graceStart = process.env.PAYMENT_IDEMPOTENCY_LEGACY_GRACE_START;
    if (graceStart) {
        const start = Date.parse(`${graceStart}T00:00:00.000Z`);
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(graceStart)
            || !Number.isFinite(start)
            || new Date(start).toISOString().slice(0, 10) !== graceStart
        ) {
            throw new Error("PAYMENT_IDEMPOTENCY_LEGACY_GRACE_START must be a valid YYYY-MM-DD date");
        }

        if (Date.now() >= start + LEGACY_IDEMPOTENCY_GRACE_MS) {
            res.status(400).json({ message: "Idempotency-Key is required for payment requests" });
            return { rejected: true };
        }
    }

    return { key: null };
}

function sendReusedPaymentResponse(res, transaction) {
    return res.status(200).json({
        message: "Existing payment operation returned; no additional STK push was sent",
        transactionId: transaction._id?.toString(),
        paymentId: transaction.paymentId,
        accountReference: transaction.accountReference,
        checkoutRequestId: transaction.checkoutRequestId,
        status: transaction.status,
        reused: true
    });
}

export function getHome(req, res) {
    res.json({
        message: "Welcome to the homepage"
    });
}

async function initiatePayment(req, res, {
    merchantId,
    amount: fixedAmount,
    description: fixedDescription,
    phoneNumber: fixedPhoneNumber,
    paymentLinkId,
    invoiceId,
    existingPaymentId,
    idempotencyKey
}) {
    const requestBody = req.validatedBody ?? req.body ?? {};
    const amount = fixedAmount ?? requestBody.amount;
    const phoneNumber = fixedPhoneNumber ?? requestBody.phoneNumber;
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
    let transaction;
    let stkRequestDispatched = false;

    try {
        transaction = existingPaymentId
            ? await createPaymentAttempt({
                merchantId,
                paymentId: existingPaymentId,
                accountReference,
                phoneNumber,
                requestedAmount: amount,
                description,
                idempotencyKey
            })
            : await createPendingTransaction({
                merchantId,
                accountReference,
                phoneNumber,
                requestedAmount: amount,
                description,
                paymentLinkId,
                invoiceId,
                idempotencyKey
            });

        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: "Payment request not found"
            });
        }

        if (transaction.reused) {
            return sendReusedPaymentResponse(res, transaction);
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
        if (error instanceof PaymentRequestFulfilledError) {
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
    const idempotency = getPaymentIdempotencyKey(req, res);
    if (idempotency.rejected) return undefined;
    return initiatePayment(req, res, {
        merchantId: req.auth.merchantId,
        idempotencyKey: idempotency.key
    });
}

export function initiatePaymentLinkPayment(req, res, link) {
    const idempotency = getPaymentIdempotencyKey(req, res);
    if (idempotency.rejected) return undefined;

    return initiatePayment(req, res, {
        merchantId: link.merchant_id,
        amount: link.amount,
        description: link.description,
        paymentLinkId: link.id,
        invoiceId: link.invoice_id,
        idempotencyKey: idempotency.key ? `link:${link.id}:${idempotency.key}` : null
    });
}

export async function retryPayment(req, res) {
    const idempotency = getPaymentIdempotencyKey(req, res);
    if (idempotency.rejected) return undefined;

    const payment = await getRetryableMerchantPayment(
        req.auth.merchantId,
        req.params.paymentId
    );
    if (!payment) {
        return res.status(404).json({
            success: false,
            message: "Payment request not found"
        });
    }

    if (idempotency.key) {
        try {
            const reused = await findIdempotentRetry({
                merchantId: req.auth.merchantId,
                paymentId: payment.id,
                idempotencyKey: idempotency.key,
                amount: Number(payment.amount),
                phoneNumber: payment.phone_number,
                description: payment.description,
                paymentLinkId: payment.payment_link_id,
                invoiceId: payment.invoice_id
            });
            if (reused) {
                return sendReusedPaymentResponse(res, reused);
            }
        } catch (error) {
            if (error instanceof IdempotencyConflictError) {
                return res.status(409).json({ message: error.message });
            }
            throw error;
        }
    }

    if (payment.status === "PENDING") {
        return res.status(409).json({
            success: false,
            message: "A pending attempt already exists for this payment request"
        });
    }
    if (payment.fulfillment.status === "FULFILLED") {
        return res.status(409).json({
            success: false,
            message: "A fulfilled payment request cannot accept another collection"
        });
    }
    if (payment.status === "TIMEOUT") {
        return res.status(409).json({
            success: false,
            message: "A timed-out payment attempt must be resolved before retry"
        });
    }

    return initiatePayment(req, res, {
        merchantId: req.auth.merchantId,
        amount: Number(payment.amount),
        description: payment.description,
        phoneNumber: payment.phone_number,
        paymentLinkId: payment.payment_link_id,
        invoiceId: payment.invoice_id,
        existingPaymentId: payment.id,
        idempotencyKey: idempotency.key
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

export async function listTransactionReconciliation(req, res) {
    try {
        const transaction = await getMerchantTransaction(
            req.auth.merchantId,
            req.params.transactionId
        );
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: "Transaction not found"
            });
        }
        const events = await listReconciliationEvents(
            req.auth.merchantId,
            req.params.transactionId
        );
        return res.json({
            success: true,
            reconciliation: {
                transactionId: req.params.transactionId,
                settlementStatus: "NOT_ASSESSED",
                lastResponse: transaction.reconciliation_response,
                lastRequestedAt: transaction.reconciliation_requested_at,
                events
            }
        });
    } catch (error) {
        console.error("Could not list reconciliation evidence:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not retrieve reconciliation evidence"
        });
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