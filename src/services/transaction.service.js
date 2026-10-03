import { getDatabasePool } from "../database.js";
import { createHash } from "node:crypto";
import { recordPaymentNotifications } from "./notification.service.js";

export class IdempotencyConflictError extends Error {
    constructor() {
        super("Idempotency key was already used for a different payment request");
        this.name = "IdempotencyConflictError";
    }
}

export async function createPendingTransaction({
    merchantId,
    accountReference,
    phoneNumber,
    requestedAmount,
    description,
    paymentLinkId,
    invoiceId,
    idempotencyKey
}) {
    const pool = getDatabasePool();
    const client = await pool.connect();
    const requestHash = createHash("sha256")
        .update(JSON.stringify({
            amount: requestedAmount,
            phoneNumber,
            description: description ?? null,
            paymentLinkId: paymentLinkId ?? null,
            invoiceId: invoiceId ?? null
        }))
        .digest("hex");

    try {
        await client.query("BEGIN");
        const payment = await client.query(
            `INSERT INTO payments (
                    merchant_id, payment_link_id, invoice_id, reference, amount, currency, phone_number, description, status,
                idempotency_key, idempotency_request_hash
             )
                 VALUES ($1, $2, $3, $4, $5, 'KES', $6, $7, 'PENDING', $8, $9)
             ON CONFLICT (merchant_id, idempotency_key) DO NOTHING
             RETURNING id, amount`,
                [merchantId, paymentLinkId ?? null, invoiceId ?? null, accountReference, requestedAmount,
                    phoneNumber, description ?? null, idempotencyKey ?? null, idempotencyKey ? requestHash : null]
        );

        if (!payment.rowCount) {
            const existing = await client.query(
                `SELECT p.id AS payment_id, p.amount, p.status AS payment_status,
                        p.reference, p.idempotency_request_hash, t.id AS transaction_id,
                        t.status AS transaction_status, t.checkout_request_id,
                        t.stk_response_code, t.stk_response_description
                 FROM payments p
                 LEFT JOIN LATERAL (
                     SELECT * FROM transactions WHERE payment_id = p.id
                     ORDER BY created_at DESC LIMIT 1
                 ) t ON true
                 WHERE p.merchant_id = $1 AND p.idempotency_key = $2`,
                [merchantId, idempotencyKey]
            );
            if (!existing.rowCount || existing.rows[0].idempotency_request_hash !== requestHash) {
                throw new IdempotencyConflictError();
            }

            const row = existing.rows[0];
            await client.query("COMMIT");
            return {
                _id: row.transaction_id,
                paymentId: row.payment_id,
                requestedAmount: Number(row.amount),
                status: row.transaction_status ?? row.payment_status,
                accountReference: row.reference,
                checkoutRequestId: row.checkout_request_id,
                stkResponseCode: row.stk_response_code,
                stkResponseDescription: row.stk_response_description,
                reused: true
            };
        }

        const transaction = await client.query(
            `INSERT INTO transactions (
                payment_id, merchant_id, account_reference, amount, currency, phone_number, provider, status
             )
             VALUES ($1, $2, $3, $4, 'KES', $5, 'MPESA', 'PENDING')
             RETURNING id, payment_id, amount, status, created_at`,
            [payment.rows[0].id, merchantId, accountReference, payment.rows[0].amount, phoneNumber]
        );
        const merchant = await client.query(
            "SELECT user_id FROM merchants WHERE id = $1",
            [merchantId]
        );
        await client.query(
            `INSERT INTO audit_logs (user_id, merchant_id, action, entity_type, entity_id, details, event_key)
             VALUES ($1, $2, 'PAYMENT_CREATED', 'PAYMENT', $3, $4, $5)
             ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
            [
                merchant.rows[0]?.user_id ?? null,
                merchantId,
                payment.rows[0].id,
                JSON.stringify({ reference: accountReference, amount: Number(payment.rows[0].amount), currency: "KES" }),
                `payment-created:${payment.rows[0].id}`
            ]
        );
        await client.query("COMMIT");

        return {
            _id: transaction.rows[0].id,
            paymentId: transaction.rows[0].payment_id,
            requestedAmount: Number(transaction.rows[0].amount),
            status: transaction.rows[0].status,
            accountReference,
            reused: false,
            createdAt: transaction.rows[0].created_at
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function recordReconciliationResponse(transactionId, merchantId, response) {
    const result = await getDatabasePool().query(
        `UPDATE transactions
         SET reconciliation_response = $3,
             reconciliation_requested_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND merchant_id = $2
         RETURNING id`,
        [transactionId, merchantId, JSON.stringify(response)]
    );
    return result.rowCount > 0;
}

export async function markReconciliationRequested(transactionId, merchantId) {
        const result = await getDatabasePool().query(
                `UPDATE transactions
                 SET reconciliation_requested_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND merchant_id = $2 AND status = 'PENDING'
                     AND checkout_request_id IS NOT NULL
                 RETURNING checkout_request_id`,
                [transactionId, merchantId]
        );
        return result.rows[0] ?? null;
}

export async function listMerchantPayments(merchantId, { status, paymentLinkId, search, page, limit }) {
    const values = [merchantId];
    const filters = ["p.merchant_id = $1"];

    if (status) {
        values.push(status);
        filters.push(`p.status = $${values.length}`);
    }
    if (paymentLinkId) {
        values.push(paymentLinkId);
        filters.push(`p.payment_link_id = $${values.length}`);
    }
    if (search) {
        values.push(`%${search}%`);
        filters.push(`(p.reference ILIKE $${values.length} OR p.phone_number ILIKE $${values.length} OR p.description ILIKE $${values.length} OR t.mpesa_receipt_number ILIKE $${values.length})`);
    }

    const where = filters.join(" AND ");
    const offset = (page - 1) * limit;
    const pool = getDatabasePool();
    const result = await pool.query(
        `SELECT p.id, p.payment_link_id, p.reference, p.amount, p.currency, p.phone_number, p.description,
                p.status, p.created_at, p.updated_at,
                t.id AS transaction_id, t.mpesa_receipt_number, t.checkout_request_id
         FROM payments p
         LEFT JOIN LATERAL (
             SELECT id, mpesa_receipt_number, checkout_request_id
             FROM transactions WHERE payment_id = p.id
             ORDER BY created_at DESC LIMIT 1
         ) t ON true
         WHERE ${where}
         ORDER BY p.created_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
    );

    const count = await pool.query(
        `SELECT COUNT(*)::integer AS total
         FROM payments p
         LEFT JOIN LATERAL (
             SELECT mpesa_receipt_number
             FROM transactions WHERE payment_id = p.id
             ORDER BY created_at DESC LIMIT 1
         ) t ON true
         WHERE ${where}`,
        values
    );

    return {
        items: result.rows.map(({ amount, ...payment }) => ({
            ...payment,
            amount: Number(amount)
        })),
        total: count.rows[0].total
    };
}

export async function getMerchantPayment(merchantId, paymentId) {
    const result = await getDatabasePool().query(
        `SELECT p.id, p.reference, p.amount, p.currency, p.phone_number, p.description,
                p.status, p.completed_at, p.created_at, p.updated_at,
                COALESCE(
                    jsonb_agg(jsonb_build_object(
                        'id', t.id,
                        'status', t.status,
                        'amount', t.amount,
                        'paidAmount', t.paid_amount,
                        'merchantRequestId', t.merchant_request_id,
                        'checkoutRequestId', t.checkout_request_id,
                        'mpesaReceiptNumber', t.mpesa_receipt_number,
                        'transactionDate', t.provider_transaction_date,
                        'resultCode', t.result_code,
                        'resultDescription', t.result_description,
                        'failureReason', t.failure_reason,
                        'createdAt', t.created_at
                    )) FILTER (WHERE t.id IS NOT NULL), '[]'::jsonb
                ) AS transactions
         FROM payments p
         LEFT JOIN transactions t ON t.payment_id = p.id
         WHERE p.id = $1 AND p.merchant_id = $2
         GROUP BY p.id`,
        [paymentId, merchantId]
    );

    if (!result.rowCount) return null;
    return { ...result.rows[0], amount: Number(result.rows[0].amount) };
}

export async function getMerchantTransaction(merchantId, transactionId) {
    const result = await getDatabasePool().query(
        `SELECT t.id, t.payment_id, t.account_reference, t.provider, t.amount,
                t.paid_amount, t.currency, t.amount_matches, t.phone_number,
                t.paid_from_phone_number, t.status, t.merchant_request_id,
                t.checkout_request_id, t.mpesa_receipt_number,
                t.provider_transaction_date, t.result_code, t.result_description,
                t.failure_reason, t.reconciliation_response,
                t.reconciliation_requested_at, t.created_at, t.updated_at
         FROM transactions t
         WHERE t.id = $1 AND t.merchant_id = $2`,
        [transactionId, merchantId]
    );
    return result.rows[0] ?? null;
}

export async function getPendingMerchantTransaction(merchantId, transactionId) {
    const result = await getDatabasePool().query(
        `SELECT id, checkout_request_id, merchant_request_id
         FROM transactions
         WHERE id = $1 AND merchant_id = $2 AND status = 'PENDING'`,
        [transactionId, merchantId]
    );
    return result.rows[0] ?? null;
}

export async function saveStkResponse(transactionId, response) {
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        if (typeof response.CheckoutRequestID === "string") {
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [response.CheckoutRequestID]);
        }
        const result = await client.query(
            `UPDATE transactions
             SET merchant_request_id = $2,
                 checkout_request_id = $3,
                 stk_response_code = $4,
                 stk_response_description = $5,
                 stk_response = $6,
                 updated_at = NOW()
             WHERE id = $1 AND status = 'PENDING'
             RETURNING payment_id, checkout_request_id`,
            [transactionId, response.MerchantRequestID ?? null,
                response.CheckoutRequestID ?? null, response.ResponseCode ?? null,
                response.ResponseDescription ?? null, JSON.stringify(response)]
        );

        if (result.rowCount) {
            await client.query(
                `UPDATE payments SET status = 'PENDING', updated_at = NOW() WHERE id = $1`,
                [result.rows[0].payment_id]
            );
                await client.query(
                    `UPDATE invoices SET status = 'PENDING', updated_at = NOW()
                     WHERE id = (SELECT invoice_id FROM payments WHERE id = $1)
                                     AND status IN ('SENT', 'OVERDUE')`,
                    [result.rows[0].payment_id]
                );

            if (result.rows[0].checkout_request_id) {
                const pendingCallback = await client.query(
                    `SELECT id, payload
                     FROM webhook_events
                     WHERE event_key = $1 AND status = 'RECEIVED'
                     FOR UPDATE`,
                    [`mpesa:${result.rows[0].checkout_request_id}`]
                );
                if (pendingCallback.rowCount) {
                    const payload = pendingCallback.rows[0].payload;
                    const transaction = await client.query(
                        `SELECT t.id, t.payment_id, p.amount, p.reference,
                                m.user_id AS owner_user_id, m.business_name, u.email AS owner_email
                         FROM transactions t
                         JOIN payments p ON p.id = t.payment_id
                         LEFT JOIN merchants m ON m.id = p.merchant_id
                         LEFT JOIN users u ON u.id = m.user_id
                         WHERE t.checkout_request_id = $1
                         FOR UPDATE OF t`,
                        [result.rows[0].checkout_request_id]
                    );
                    if (transaction.rowCount) {
                        await updateTransactionFromCallback(
                            client,
                            transaction.rows[0],
                            payload.callback,
                            payload.metadata
                        );
                        await client.query(
                            `UPDATE webhook_events
                             SET status = 'PROCESSED', processed_at = NOW(), claimed_at = NULL,
                                 last_error = NULL, updated_at = NOW()
                             WHERE id = $1`,
                            [pendingCallback.rows[0].id]
                        );
                    }
                }
            }
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function markInitiationFailed(transactionId, reason, darajaResponse) {
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE transactions
             SET status = 'FAILED', failure_reason = $2, stk_response = $3, updated_at = NOW()
             WHERE id = $1 AND status = 'PENDING'
             RETURNING payment_id`,
            [transactionId, reason, darajaResponse ? JSON.stringify(darajaResponse) : null]
        );

        if (result.rowCount) {
            await client.query(
                "UPDATE payments SET status = 'FAILED', updated_at = NOW() WHERE id = $1 AND status = 'PENDING'",
                [result.rows[0].payment_id]
            );
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export function determineCallbackOutcome(resultCode, metadata, requestedAmount) {
    if (resultCode === 0) {
        const paidAmount = Number(metadata.Amount);
        const hasValidAmount = Number.isFinite(paidAmount) && paidAmount > 0;

        return {
            status: hasValidAmount ? "SUCCESS" : "FAILED",
            ...(hasValidAmount ? { paidAmount, amountMatches: paidAmount === requestedAmount } : {
                failureReason: "SUCCESS_CALLBACK_MISSING_VALID_AMOUNT"
            })
        };
    }

    return {
        status: resultCode === 1032 ? "CANCELLED" : "FAILED"
    };
}

function parseResultCode(value) {
    if (Number.isInteger(value)) {
        return value;
    }
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
        return Number(value);
    }
    return null;
}

async function updateTransactionFromCallback(client, transaction, callback, metadata) {
    const resultCode = parseResultCode(callback.ResultCode);
    if (resultCode === null) {
        throw new Error("Daraja callback has an invalid ResultCode");
    }

    const outcome = determineCallbackOutcome(resultCode, metadata, Number(transaction.amount));
    const update = await client.query(
        `UPDATE transactions
         SET status = $2, result_code = $3, result_description = $4,
             callback_metadata = $5, callback_received_at = NOW(),
             paid_amount = $6, amount_matches = $7, mpesa_receipt_number = $8,
             provider_transaction_date = $9, paid_from_phone_number = $10,
             failure_reason = $11, updated_at = NOW()
         WHERE id = $1 AND status = 'PENDING'
             RETURNING payment_id, amount_matches`,
        [transaction.id, outcome.status, resultCode, callback.ResultDesc ?? null,
            JSON.stringify(metadata), outcome.paidAmount ?? null,
            outcome.amountMatches ?? null, metadata.MpesaReceiptNumber ?? null,
            metadata.TransactionDate == null ? null : String(metadata.TransactionDate),
            metadata.PhoneNumber == null ? null : String(metadata.PhoneNumber),
            outcome.failureReason ?? null]
    );

    if (!update.rowCount) {
        const current = await client.query("SELECT status FROM transactions WHERE id = $1", [transaction.id]);
        return { matched: true, duplicate: true, status: current.rows[0]?.status };
    }

    await client.query(
        `UPDATE payments SET status = $2, completed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'PENDING'`,
        [update.rows[0].payment_id, outcome.status]
    );
    if (outcome.status === "SUCCESS" && update.rows[0].amount_matches === true) {
        await client.query(
            `UPDATE invoices SET status = 'PAID', updated_at = NOW()
             WHERE id = (SELECT invoice_id FROM payments WHERE id = $1)
               AND status IN ('PENDING', 'SENT', 'OVERDUE')`,
            [update.rows[0].payment_id]
        );
        await client.query(
            `UPDATE payment_links SET status = 'INACTIVE', updated_at = NOW()
             WHERE invoice_id = (SELECT invoice_id FROM payments WHERE id = $1)
               AND status = 'ACTIVE'
               AND EXISTS (
                   SELECT 1 FROM invoices
                   WHERE id = payment_links.invoice_id AND status = 'PAID'
               )`,
            [update.rows[0].payment_id]
        );
    }
    await recordPaymentNotifications(client, {
        eventKey: `mpesa:${callback.CheckoutRequestID}`,
        userId: transaction.owner_user_id,
        email: transaction.owner_email,
        businessName: transaction.business_name,
        status: outcome.status,
        reference: transaction.reference,
        requestedAmount: Number(transaction.amount),
        paidAmount: outcome.paidAmount,
        amountMatches: outcome.amountMatches,
        receiptNumber: metadata.MpesaReceiptNumber
    });
    await client.query(
        `INSERT INTO audit_logs (user_id, merchant_id, action, entity_type, entity_id, details, event_key)
         VALUES ($1, $2, $3, 'TRANSACTION', $4, $5, $6)
         ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
        [
            transaction.owner_user_id,
            transaction.merchant_id,
            `PAYMENT_${outcome.status}`,
            transaction.id,
            JSON.stringify({
                paymentReference: transaction.reference,
                resultCode,
                paidAmount: outcome.paidAmount ?? null,
                amountMatches: outcome.amountMatches ?? null,
                receiptNumber: metadata.MpesaReceiptNumber ?? null
            }),
            `mpesa:${callback.CheckoutRequestID}`
        ]
    );
    return { matched: true, duplicate: false, status: outcome.status };
}

export async function applyMpesaCallback(callback, metadata) {
    const checkoutRequestId = callback?.CheckoutRequestID;
    const resultCode = parseResultCode(callback?.ResultCode);

    if (typeof checkoutRequestId !== "string" || !checkoutRequestId || resultCode === null || !metadata || typeof metadata !== "object") {
        return { matched: false, reason: "INVALID_CALLBACK" };
    }

    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [checkoutRequestId]);
        const eventKey = `mpesa:${checkoutRequestId}`;
        await client.query(
            `INSERT INTO webhook_events (provider, event_type, event_key, payload, status, next_attempt_at)
             VALUES ('MPESA', 'STK_CALLBACK', $1, $2, 'RECEIVED', NOW())
             ON CONFLICT (event_key) DO NOTHING`,
            [eventKey, JSON.stringify({ callback, metadata })]
        );
        const event = await client.query(
            "SELECT id, status FROM webhook_events WHERE event_key = $1 FOR UPDATE",
            [eventKey]
        );
        const existing = await client.query(
            `SELECT t.id, t.payment_id, t.status, t.merchant_id, p.amount, p.reference,
                    m.user_id AS owner_user_id, m.business_name, u.email AS owner_email
             FROM transactions t
             JOIN payments p ON p.id = t.payment_id
             LEFT JOIN merchants m ON m.id = t.merchant_id
             LEFT JOIN users u ON u.id = m.user_id
             WHERE t.checkout_request_id = $1
             FOR UPDATE OF t`,
            [checkoutRequestId]
        );

        if (!existing.rowCount) {
            await client.query(
                `UPDATE webhook_events
                 SET status = 'RECEIVED', last_error = 'Awaiting transaction association',
                     next_attempt_at = GREATEST(next_attempt_at, NOW()), claimed_at = NULL,
                     updated_at = NOW()
                 WHERE event_key = $1`,
                [eventKey]
            );
            await client.query("COMMIT");
            return { matched: false, reason: "TRANSACTION_NOT_FOUND", storedForRetry: true };
        }

        const transaction = existing.rows[0];
        if (transaction.status !== "PENDING") {
            await client.query(
                `UPDATE webhook_events
                 SET status = 'PROCESSED', processed_at = COALESCE(processed_at, NOW()),
                     claimed_at = NULL, last_error = NULL, updated_at = NOW()
                 WHERE id = $1`,
                [event.rows[0].id]
            );
            await client.query("COMMIT");
            return { matched: true, duplicate: true, status: transaction.status };
        }

        const outcome = await updateTransactionFromCallback(client, transaction, callback, metadata);
        await client.query(
            `UPDATE webhook_events
             SET status = 'PROCESSED', processed_at = NOW(), claimed_at = NULL,
                 last_error = NULL, updated_at = NOW()
             WHERE id = $1`,
            [event.rows[0].id]
        );
        await client.query("COMMIT");
        return outcome;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}