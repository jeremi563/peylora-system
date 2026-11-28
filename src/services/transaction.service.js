import { getDatabasePool } from "../database.js";
import { createHash } from "node:crypto";
import { recordPaymentNotifications } from "./notification.service.js";
import { processSuccessfulProviderTransaction } from "./accounting.service.js";
import {
    compareCallbackWithDarajaStatus,
    extractCallbackMetadata,
    getAccessToken,
    generateTimestamp,
    generateStkPassword,
    queryStkStatus
} from "./mpesa.service.js";
import { enqueueMpesaCallback } from "./webhook.service.js";

export class IdempotencyConflictError extends Error {
    constructor() {
        super("Idempotency key was already used for a different payment operation or request");
        this.name = "IdempotencyConflictError";
    }
}

export class PaymentRequestFulfilledError extends Error {
    constructor() {
        super("A fulfilled payment request cannot accept another collection");
        this.name = "PaymentRequestFulfilledError";
    }
}

export class UnresolvedPaymentAttemptError extends Error {
    constructor() {
        super("The previous payment attempt must be resolved before another attempt can be created");
        this.name = "UnresolvedPaymentAttemptError";
    }
}

export class PaymentLinkUnavailableError extends Error {
    constructor() {
        super("The payment link is unavailable");
        this.name = "PaymentLinkUnavailableError";
    }
}

export class RecoveryDispositionConflictError extends Error {
    constructor() {
        super("A different recovery disposition already exists for this payment attempt");
        this.name = "RecoveryDispositionConflictError";
    }
}

export class PaymentAttemptNotRecoverableError extends Error {
    constructor() {
        super("Only a timed-out attempt without a CheckoutRequestID can be authorized for retry");
        this.name = "PaymentAttemptNotRecoverableError";
    }
}

const PAYMENT_FULFILLMENT_JOIN = `
    LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(pt.received_amount), 0) AS amount_received
        FROM transactions payment_attempt
        JOIN provider_transactions pt
          ON pt.attempt_transaction_id = payment_attempt.id
         AND pt.merchant_id = payment_attempt.merchant_id
        WHERE (
            payment_attempt.payment_id = p.id
            OR (
                p.payment_link_id IS NOT NULL
                AND payment_attempt.payment_id IN (
                    SELECT historical_payment.id
                    FROM payments historical_payment
                    WHERE historical_payment.payment_link_id = p.payment_link_id
                      AND historical_payment.merchant_id = p.merchant_id
                )
            )
        )
          AND payment_attempt.merchant_id = p.merchant_id
          AND pt.outcome = 'SUCCESS'
    ) payment_fulfillment ON true
`;

const PAYMENT_FULFILLMENT_SELECT = `
    jsonb_build_object(
        'status', CASE
            WHEN payment_fulfillment.amount_received >= p.amount THEN 'FULFILLED'
            WHEN payment_fulfillment.amount_received > 0 THEN 'PARTIALLY_FULFILLED'
            ELSE 'UNFULFILLED'
        END,
        'amountReceived', payment_fulfillment.amount_received
    ) AS fulfillment
`;

function hashPaymentRequest({
    amount,
    phoneNumber,
    description,
    paymentLinkId,
    invoiceId
}) {
    return createHash("sha256")
        .update(JSON.stringify({
            amount,
            phoneNumber,
            description: description ?? null,
            paymentLinkId: paymentLinkId ?? null,
            invoiceId: invoiceId ?? null
        }))
        .digest("hex");
}

function hashRetryRequest({
    paymentId,
    amount,
    phoneNumber,
    description,
    paymentLinkId,
    invoiceId
}) {
    return createHash("sha256")
        .update(JSON.stringify({
            paymentId,
            amount,
            phoneNumber,
            description: description ?? null,
            paymentLinkId: paymentLinkId ?? null,
            invoiceId: invoiceId ?? null
        }))
        .digest("hex");
}

async function getIdempotentOperation(client, merchantId, idempotencyKey) {
    const result = await client.query(
        `SELECT o.operation_type, o.request_hash, o.payment_id, o.attempt_id,
                p.reference, p.amount, p.phone_number, p.description,
                p.payment_link_id, p.invoice_id, p.status AS payment_status,
                t.id AS transaction_id, t.account_reference, t.status AS transaction_status,
                t.checkout_request_id, t.stk_response_code, t.stk_response_description
         FROM payment_idempotency_operations o
         JOIN payments p
           ON p.id = o.payment_id AND p.merchant_id = o.merchant_id
         LEFT JOIN transactions t
           ON t.id = o.attempt_id
          AND t.payment_id = o.payment_id
          AND t.merchant_id = o.merchant_id
         WHERE o.merchant_id = $1 AND o.idempotency_key = $2`,
        [merchantId, idempotencyKey]
    );
    return result.rows[0] ?? null;
}

function hashRecoveryRequest({ operatorUserId, reason, supportingEvidence }) {
    return createHash("sha256")
        .update(JSON.stringify({ operatorUserId, reason, supportingEvidence }))
        .digest("hex");
}

async function recordDispatchAudit(client, {
    merchantId,
    userId = null,
    transactionId,
    action,
    details,
    eventKey
}) {
    await client.query(
        `INSERT INTO audit_logs (user_id, merchant_id, action, entity_type, entity_id, details, event_key)
         VALUES ($1, $2, $3, 'TRANSACTION', $4, $5, $6)
         ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
        [userId, merchantId, action, transactionId, JSON.stringify(details), eventKey]
    );
}

function idempotentOperationMatches(operation, operationType, requestHash) {
    if (!operation || operation.operation_type !== operationType) {
        return false;
    }

    const storedHash = operation.request_hash ?? (
        operationType === "INITIAL"
            ? hashPaymentRequest({
                amount: Number(operation.amount),
                phoneNumber: operation.phone_number,
                description: operation.description,
                paymentLinkId: operation.payment_link_id,
                invoiceId: operation.invoice_id
            })
            : null
    );
    return storedHash === requestHash;
}

async function persistLegacyRequestHash(client, operation, merchantId, idempotencyKey, requestHash) {
    if (operation.request_hash === null) {
        await client.query(
            `UPDATE payment_idempotency_operations
             SET request_hash = $3
             WHERE merchant_id = $1 AND idempotency_key = $2 AND request_hash IS NULL`,
            [merchantId, idempotencyKey, requestHash]
        );
    }
}

function reusedTransaction(operation) {
    return {
        _id: operation.transaction_id ?? operation.attempt_id,
        paymentId: operation.payment_id,
        requestedAmount: Number(operation.amount),
        status: operation.transaction_status ?? operation.payment_status,
        accountReference: operation.account_reference ?? operation.reference,
        checkoutRequestId: operation.checkout_request_id,
        stkResponseCode: operation.stk_response_code,
        stkResponseDescription: operation.stk_response_description,
        reused: true
    };
}

export async function findIdempotentRetry({
    merchantId,
    paymentId,
    idempotencyKey,
    amount,
    phoneNumber,
    description,
    paymentLinkId,
    invoiceId
}) {
    const operation = await getIdempotentOperation(
        getDatabasePool(),
        merchantId,
        idempotencyKey
    );
    if (!operation) {
        return null;
    }

    const requestHash = hashRetryRequest({
        paymentId,
        amount,
        phoneNumber,
        description,
        paymentLinkId,
        invoiceId
    });
    if (
        operation.payment_id !== paymentId
        || !idempotentOperationMatches(operation, "RETRY", requestHash)
    ) {
        throw new IdempotencyConflictError();
    }

    if (operation.request_hash === null) {
        await getDatabasePool().query(
            `UPDATE payment_idempotency_operations
             SET request_hash = $3
             WHERE merchant_id = $1 AND idempotency_key = $2 AND request_hash IS NULL`,
            [merchantId, idempotencyKey, requestHash]
        );
    }

    return reusedTransaction(operation);
}

export async function createPendingTransaction({
    merchantId,
    accountReference,
    phoneNumber,
    requestedAmount,
    description,
    paymentLinkId,
    invoiceId,
    idempotencyKey,
    existingPaymentId
}) {
    const pool = getDatabasePool();
    const client = await pool.connect();
    const requestHash = hashPaymentRequest({
        amount: requestedAmount,
        phoneNumber,
        description,
        paymentLinkId,
        invoiceId
    });

    try {
        await client.query("BEGIN");
        if (idempotencyKey) {
            const existing = await getIdempotentOperation(client, merchantId, idempotencyKey);
            if (existing) {
                if (!idempotentOperationMatches(existing, "INITIAL", requestHash)) {
                    throw new IdempotencyConflictError();
                }

                await persistLegacyRequestHash(
                    client,
                    existing,
                    merchantId,
                    idempotencyKey,
                    requestHash
                );
                await client.query("COMMIT");
                return reusedTransaction(existing);
            }
        }

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
            const existing = await getIdempotentOperation(client, merchantId, idempotencyKey);
            if (!idempotentOperationMatches(existing, "INITIAL", requestHash)) {
                throw new IdempotencyConflictError();
            }

            await persistLegacyRequestHash(
                client,
                existing,
                merchantId,
                idempotencyKey,
                requestHash
            );
            await client.query("COMMIT");
            return reusedTransaction(existing);
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

        if (idempotencyKey) {
            const operation = await client.query(
                `INSERT INTO payment_idempotency_operations (
                    merchant_id, idempotency_key, operation_type, request_hash,
                    payment_id, attempt_id
                 )
                 VALUES ($1, $2, 'INITIAL', $3, $4, $5)
                 ON CONFLICT (merchant_id, idempotency_key) DO NOTHING
                 RETURNING attempt_id`,
                [
                    merchantId,
                    idempotencyKey,
                    requestHash,
                    payment.rows[0].id,
                    transaction.rows[0].id
                ]
            );

            if (!operation.rowCount) {
                const existing = await getIdempotentOperation(client, merchantId, idempotencyKey);
                if (!idempotentOperationMatches(existing, "INITIAL", requestHash)) {
                    throw new IdempotencyConflictError();
                }

                await client.query("ROLLBACK");
                return reusedTransaction(existing);
            }
        }

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

export async function getRetryableMerchantPayment(merchantId, paymentId) {
    const result = await getDatabasePool().query(
        `SELECT p.id, p.amount, p.phone_number, p.description,
                p.payment_link_id, p.invoice_id, p.status,
                latest_attempt.status AS latest_attempt_status,
                latest_attempt.dispatch_state AS latest_dispatch_state,
                recovery.id AS retry_recovery_disposition_id,
                ${PAYMENT_FULFILLMENT_SELECT}
         FROM payments p
         ${PAYMENT_FULFILLMENT_JOIN}
         LEFT JOIN LATERAL (
             SELECT t.id, t.status, t.dispatch_state
             FROM transactions t
             WHERE t.payment_id = p.id AND t.merchant_id = p.merchant_id
             ORDER BY t.created_at DESC, t.id DESC
             LIMIT 1
         ) latest_attempt ON true
         LEFT JOIN payment_attempt_recovery_dispositions recovery
           ON recovery.attempt_transaction_id = latest_attempt.id
          AND recovery.merchant_id = p.merchant_id
         WHERE p.id = $1 AND p.merchant_id = $2`,
        [paymentId, merchantId]
    );
    return result.rows[0] ?? null;
}

export async function createPaymentAttempt({
    merchantId,
    paymentId,
    accountReference,
    phoneNumber,
    requestedAmount,
    description,
    paymentLinkId,
    invoiceId,
    idempotencyKey
}) {
    const client = await getDatabasePool().connect();
    try {
        await client.query("BEGIN");
        const payment = await client.query(
            `SELECT id, merchant_id, payment_link_id, invoice_id
             FROM payments
             WHERE id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [paymentId, merchantId]
        );
        if (!payment.rowCount) {
            await client.query("ROLLBACK");
            return null;
        }

        await client.query(
            `UPDATE payments
             SET phone_number = $2, updated_at = NOW()
             WHERE id = $1 AND merchant_id = $3`,
            [paymentId, phoneNumber, merchantId]
        );

        const boundLinkId = payment.rows[0].payment_link_id ?? paymentLinkId;
        if (boundLinkId) {
            const link = await client.query(
                `SELECT id, status, use_mode, expires_at, consumed_at
                 FROM payment_links
                 WHERE id = $1 AND merchant_id = $2
                 FOR UPDATE`,
                [boundLinkId, merchantId]
            );
            if (
                !link.rowCount
                || link.rows[0].status !== "ACTIVE"
                || link.rows[0].consumed_at
                || (
                    link.rows[0].expires_at
                    && new Date(link.rows[0].expires_at).getTime() <= Date.now()
                )
            ) {
                await client.query("ROLLBACK");
                throw new PaymentLinkUnavailableError();
            }
        }

        const requestHash = hashRetryRequest({
            paymentId,
            amount: requestedAmount,
            phoneNumber,
            description,
            paymentLinkId: payment.rows[0].payment_link_id ?? paymentLinkId,
            invoiceId: payment.rows[0].invoice_id ?? invoiceId
        });

        if (idempotencyKey) {
            const existing = await getIdempotentOperation(client, merchantId, idempotencyKey);
            if (existing) {
                if (
                    existing.payment_id !== paymentId
                    || !idempotentOperationMatches(existing, "RETRY", requestHash)
                ) {
                    throw new IdempotencyConflictError();
                }

                await persistLegacyRequestHash(client, existing, merchantId, idempotencyKey, requestHash);
                await client.query("COMMIT");
                return reusedTransaction(existing);
            }
        }

        const fulfillment = await client.query(
            `SELECT COALESCE(SUM(pt.received_amount), 0) >= p.amount AS is_fulfilled
             FROM payments p
             LEFT JOIN transactions payment_attempt
               ON (
                   payment_attempt.payment_id = p.id
                   OR (
                       p.payment_link_id IS NOT NULL
                       AND payment_attempt.payment_id IN (
                           SELECT historical_payment.id
                           FROM payments historical_payment
                           WHERE historical_payment.payment_link_id = p.payment_link_id
                             AND historical_payment.merchant_id = p.merchant_id
                       )
                   )
               )
              AND payment_attempt.merchant_id = p.merchant_id
             LEFT JOIN provider_transactions pt
               ON pt.attempt_transaction_id = payment_attempt.id
              AND pt.merchant_id = payment_attempt.merchant_id
              AND pt.outcome = 'SUCCESS'
             WHERE p.id = $1 AND p.merchant_id = $2
             GROUP BY p.id`,
            [paymentId, merchantId]
        );
        if (fulfillment.rows[0]?.is_fulfilled) {
            throw new PaymentRequestFulfilledError();
        }

        const latestAttempt = await client.query(
            `SELECT id, status
             FROM transactions
             WHERE payment_id = $1 AND merchant_id = $2
             ORDER BY created_at DESC, id DESC
             LIMIT 1
             FOR UPDATE`,
            [paymentId, merchantId]
        );
        let recoveryDispositionId = null;
        if (latestAttempt.rowCount) {
            const previous = latestAttempt.rows[0];
            if (previous.status === "TIMEOUT") {
                const recovery = await client.query(
                    `SELECT id
                     FROM payment_attempt_recovery_dispositions
                     WHERE attempt_transaction_id = $1 AND merchant_id = $2
                       AND NOT EXISTS (
                           SELECT 1 FROM transactions recovered_attempt
                           WHERE recovered_attempt.recovery_disposition_id =
                               payment_attempt_recovery_dispositions.id
                       )
                     FOR UPDATE`,
                    [previous.id, merchantId]
                );
                if (!recovery.rowCount) throw new UnresolvedPaymentAttemptError();
                recoveryDispositionId = recovery.rows[0].id;
            } else if (!["SUCCESS", "FAILED", "CANCELLED"].includes(previous.status)) {
                throw new UnresolvedPaymentAttemptError();
            }
        }

        const attempt = await client.query(
            `INSERT INTO transactions (
                payment_id, merchant_id, account_reference, amount,
                currency, phone_number, provider, status, recovery_disposition_id
             )
             VALUES ($1, $2, $3, $4, 'KES', $5, 'MPESA', 'PENDING', $6)
             RETURNING id, payment_id, amount, status, created_at`,
            [paymentId, merchantId, accountReference, requestedAmount, phoneNumber, recoveryDispositionId]
        );
        const merchant = await client.query(
            "SELECT user_id FROM merchants WHERE id = $1",
            [merchantId]
        );
        await client.query(
            `INSERT INTO audit_logs (
                user_id, merchant_id, action, entity_type, entity_id, details, event_key
             )
             VALUES ($1, $2, 'PAYMENT_CREATED', 'PAYMENT', $3, $4, $5)
             ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
            [
                merchant.rows[0]?.user_id ?? null,
                merchantId,
                paymentId,
                JSON.stringify({
                    attemptId: attempt.rows[0].id,
                    reference: accountReference,
                    amount: Number(attempt.rows[0].amount),
                    currency: "KES"
                }),
                `payment-created:${paymentId}`
            ]
        );

        await client.query(
            `UPDATE payments
             SET status = 'PENDING', completed_at = NULL, updated_at = NOW()
             WHERE id = $1 AND merchant_id = $2`,
            [paymentId, merchantId]
        );
        await client.query(
            `UPDATE invoices
             SET status = 'PENDING', updated_at = NOW()
             WHERE id = (SELECT invoice_id FROM payments WHERE id = $1)
               AND status IN ('SENT', 'OVERDUE', 'PARTIALLY_PAID')`,
            [paymentId]
        );

        if (idempotencyKey) {
            const operation = await client.query(
                `INSERT INTO payment_idempotency_operations (
                    merchant_id, idempotency_key, operation_type, request_hash,
                    payment_id, attempt_id
                 )
                 VALUES ($1, $2, 'RETRY', $3, $4, $5)
                 ON CONFLICT (merchant_id, idempotency_key) DO NOTHING
                 RETURNING attempt_id`,
                [merchantId, idempotencyKey, requestHash, paymentId, attempt.rows[0].id]
            );

            if (!operation.rowCount) {
                const existing = await getIdempotentOperation(client, merchantId, idempotencyKey);
                if (
                    existing?.payment_id !== paymentId
                    || !idempotentOperationMatches(existing, "RETRY", requestHash)
                ) {
                    throw new IdempotencyConflictError();
                }

                await client.query("ROLLBACK");
                return reusedTransaction(existing);
            }
        }

        await client.query("COMMIT");

        return {
            _id: attempt.rows[0].id,
            paymentId,
            requestedAmount: Number(attempt.rows[0].amount),
            status: attempt.rows[0].status,
            accountReference,
            idempotencyKey: idempotencyKey ?? null,
            reused: false,
            createdAt: attempt.rows[0].created_at
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

function compareStatusResponseWithTransaction(transaction, providerEvidence, response, priorEvidence) {
    const conflictFields = [];
    const unverifiedFields = [];
    const callbackEvidence = priorEvidence
        .filter((evidence) => evidence.evidence_type === "CALLBACK_VERIFICATION")
        .map((evidence) => evidence.response_payload);
    const storedCallback = providerEvidence?.evidence_payload?.callback ?? callbackEvidence[0]?.callback ?? {};
    const statusCode = parseResultCode(response?.ResultCode ?? response?.resultCode);
    const callbackResultCode = transaction.result_code ?? parseResultCode(storedCallback.ResultCode);
    const responseCode = response?.ResponseCode == null
        ? null
        : parseResultCode(response.ResponseCode);

    if (
        statusCode != null
        && [0, 1032].includes(statusCode)
        && callbackResultCode != null
        && [0, 1032].includes(callbackResultCode)
        && statusCode !== callbackResultCode
    ) {
        conflictFields.push("resultCode");
    }

    for (const [field, conflictField, expected] of [
        ["CheckoutRequestID", "checkoutRequestId", transaction.checkout_request_id],
        ["MerchantRequestID", "merchantRequestId", transaction.merchant_request_id]
    ]) {
        if (response?.[field] != null && expected != null) {
            if (!evidenceValueEquals(field, response[field], expected)) conflictFields.push(conflictField);
        } else {
            unverifiedFields.push(conflictField);
        }
    }

    const responseMetadata = extractCallbackMetadata(response?.CallbackMetadata);
    for (const evidence of callbackEvidence) {
        const callback = evidence?.callback ?? {};
        const metadata = evidence?.metadata ?? {};
        const resultCode = parseResultCode(callback.ResultCode);
        if (
            statusCode != null
            && [0, 1032].includes(statusCode)
            && resultCode != null
            && [0, 1032].includes(resultCode)
            && statusCode !== resultCode
        ) {
            conflictFields.push("resultCode");
        }
        for (const [field, conflictField] of [
            ["CheckoutRequestID", "checkoutRequestId"],
            ["MerchantRequestID", "merchantRequestId"]
        ]) {
            if (
                response?.[field] != null
                && callback[field] != null
                && !evidenceValueEquals(field, response[field], callback[field])
            ) {
                conflictFields.push(conflictField);
            }
        }
        for (const [field, conflictField] of [
            ["Amount", "amount"],
            ["MpesaReceiptNumber", "receipt"],
            ["PhoneNumber", "phoneNumber"],
            ["TransactionDate", "transactionDate"]
        ]) {
            if (
                Object.hasOwn(responseMetadata, field)
                && Object.hasOwn(metadata, field)
                && !evidenceValueEquals(field, responseMetadata[field], metadata[field])
            ) {
                conflictFields.push(conflictField);
            }
        }
    }

    const latestCallbackMetadata = callbackEvidence[0]?.metadata ?? {};
    const callbackMetadata = providerEvidence?.evidence_payload?.metadata
        ?? transaction.callback_metadata
        ?? latestCallbackMetadata;
    const storedFields = [
        ["Amount", "amount", providerEvidence?.received_amount ?? transaction.paid_amount ?? callbackMetadata.Amount],
        ["MpesaReceiptNumber", "receipt", providerEvidence?.provider_reference ?? transaction.mpesa_receipt_number ?? callbackMetadata.MpesaReceiptNumber],
        ["PhoneNumber", "phoneNumber", transaction.paid_from_phone_number ?? callbackMetadata.PhoneNumber],
        ["TransactionDate", "transactionDate", transaction.provider_transaction_date ?? callbackMetadata.TransactionDate]
    ];
    for (const [field, conflictField, expected] of storedFields) {
        if (Object.hasOwn(responseMetadata, field) && expected != null) {
            if (!evidenceValueEquals(field, responseMetadata[field], expected)) {
                conflictFields.push(conflictField);
            }
        } else {
            unverifiedFields.push(conflictField);
        }
    }

    const responseIsTerminal = [0, 1032].includes(statusCode);
    if (responseIsTerminal) {
        for (const evidence of priorEvidence) {
            const previousResponse = statusResponseFromEvidence(evidence);
            const previousCode = parseResultCode(
                previousResponse?.ResultCode ?? previousResponse?.resultCode
            );
            if (previousCode != null && [0, 1032].includes(previousCode)) {
                conflictFields.push(...providerResponseDifferences(previousResponse, response));
            }
        }
    }

    const unverified = statusCode === null
        || !responseIsTerminal
        || (response?.ResponseCode != null && responseCode !== 0);
    const agreement = conflictFields.length
        ? "MISMATCH"
        : unverified
            ? "UNVERIFIED"
            : callbackResultCode == null
                ? "NO_CALLBACK"
                : "MATCH";
    return {
        agreement,
        callbackResultCode,
        statusResultCode: statusCode,
        conflictFields: [...new Set(conflictFields)],
        unverifiedFields: [...new Set(unverifiedFields)]
    };
}

async function applyTerminalStatusQuery(client, transaction, response, verification, eventKey) {
    const resultCode = verification.statusResultCode;
    const responseCode = parseResultCode(response?.ResponseCode);
    if (
        transaction.status !== "PENDING" && transaction.status !== "TIMEOUT"
        || !["NO_CALLBACK", "MATCH"].includes(verification.agreement)
        || responseCode !== 0
        || response?.CheckoutRequestID !== transaction.checkout_request_id
        || ![0, 1032].includes(resultCode)
    ) {
        return false;
    }

    const metadata = extractCallbackMetadata(response.CallbackMetadata);
    const receivedAmount = Number(metadata.Amount);
    if (resultCode === 0 && (!Number.isFinite(receivedAmount) || receivedAmount <= 0)) {
        return false;
    }

    const status = resultCode === 1032 ? "CANCELLED" : "SUCCESS";
    const amountMatches = status === "SUCCESS"
        ? receivedAmount === Number(transaction.amount)
        : null;
    await client.query("SAVEPOINT terminal_status_query");
    try {
        const update = await client.query(
            `UPDATE transactions
             SET status = $2, result_code = $3, result_description = $4,
                 paid_amount = $5, amount_matches = $6,
                 mpesa_receipt_number = $7, provider_transaction_date = $8,
                 paid_from_phone_number = $9, reconciliation_response = $10,
                 failure_reason = NULL, updated_at = NOW()
             WHERE id = $1 AND status IN ('PENDING', 'TIMEOUT')
             RETURNING payment_id`,
            [
                transaction.id,
                status,
                resultCode,
                response.ResultDesc ?? null,
                status === "SUCCESS" ? receivedAmount : null,
                amountMatches,
                status === "SUCCESS" && metadata.MpesaReceiptNumber != null
                    ? String(metadata.MpesaReceiptNumber)
                    : null,
                metadata.TransactionDate == null ? null : String(metadata.TransactionDate),
                metadata.PhoneNumber == null ? null : String(metadata.PhoneNumber),
                JSON.stringify(response)
            ]
        );
        if (!update.rowCount) {
            await client.query("ROLLBACK TO SAVEPOINT terminal_status_query");
            await client.query("RELEASE SAVEPOINT terminal_status_query");
            return false;
        }

        const providerTransaction = await client.query(
            `INSERT INTO provider_transactions (
                merchant_id, attempt_transaction_id, provider, outcome,
                provider_reference, received_amount, currency,
                evidence_type, evidence_event_key, evidence_payload
             )
             VALUES ($1, $2, 'MPESA', $3, $4, $5, 'KES', 'STATUS_QUERY', $6, $7)
             ON CONFLICT (attempt_transaction_id) DO NOTHING
             RETURNING id`,
            [
                transaction.merchant_id,
                transaction.id,
                status,
                status === "SUCCESS" && metadata.MpesaReceiptNumber != null
                    ? String(metadata.MpesaReceiptNumber)
                    : null,
                status === "SUCCESS" ? receivedAmount : null,
                eventKey,
                JSON.stringify(response)
            ]
        );
        if (!providerTransaction.rowCount) {
            await client.query("ROLLBACK TO SAVEPOINT terminal_status_query");
            await client.query("RELEASE SAVEPOINT terminal_status_query");
            return false;
        }

        await client.query(
            `UPDATE payments
             SET status = $2, completed_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND status IN ('PENDING', 'TIMEOUT')`,
            [update.rows[0].payment_id, status]
        );
        if (status === "SUCCESS") {
            await processSuccessfulProviderTransaction(client, {
                merchantId: transaction.merchant_id,
                providerTransactionId: providerTransaction.rows[0].id,
                receivedAmount,
                paymentId: update.rows[0].payment_id
            });
            await consumeSingleUsePaymentLink(
                client,
                transaction,
                `payment-link-consumed:${transaction.checkout_request_id}`
            );
            if (amountMatches === true) {
                await client.query(
                    `UPDATE payment_links
                     SET status = 'INACTIVE', updated_at = NOW()
                     WHERE invoice_id = (SELECT invoice_id FROM payments WHERE id = $1)
                       AND status = 'ACTIVE'
                       AND EXISTS (
                           SELECT 1 FROM invoices
                           WHERE id = payment_links.invoice_id
                             AND merchant_id = $2 AND status = 'PAID'
                       )`,
                    [update.rows[0].payment_id, transaction.merchant_id]
                );
            }
        }
        await recordPaymentNotifications(client, {
            eventKey: `mpesa-status:${transaction.checkout_request_id}`,
            userId: transaction.owner_user_id,
            email: transaction.owner_email,
            businessName: transaction.business_name,
            status,
            reference: transaction.reference,
            requestedAmount: Number(transaction.amount),
            paidAmount: status === "SUCCESS" ? receivedAmount : null,
            amountMatches,
            receiptNumber: metadata.MpesaReceiptNumber
        });
        await client.query(
            `INSERT INTO audit_logs (
                user_id, merchant_id, action, entity_type, entity_id, details, event_key
             )
             VALUES ($1, $2, $3, 'TRANSACTION', $4, $5, $6)
             ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
            [
                transaction.owner_user_id,
                transaction.merchant_id,
                `PAYMENT_${status}`,
                transaction.id,
                JSON.stringify({
                    paymentReference: transaction.reference,
                    resultCode,
                    paidAmount: status === "SUCCESS" ? receivedAmount : null,
                    amountMatches,
                    receiptNumber: metadata.MpesaReceiptNumber ?? null,
                    evidenceType: "STATUS_QUERY"
                }),
                `mpesa-status:${transaction.checkout_request_id}`
            ]
        );
        await client.query("RELEASE SAVEPOINT terminal_status_query");
        return true;
    } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT terminal_status_query");
        await client.query("RELEASE SAVEPOINT terminal_status_query");
        if (error.code === "23505" && error.constraint === "provider_transactions_reference_unique") {
            const conflict = {
                agreement: "MISMATCH",
                conflictFields: ["receiptAlreadyAssociated"]
            };
            await client.query(
                `UPDATE reconciliation_events
                 SET agreement = 'MISMATCH',
                     response_payload = jsonb_set(response_payload, '{verification}', $2::jsonb)
                 WHERE event_key = $1`,
                [eventKey, JSON.stringify(conflict)]
            );
            return false;
        }
        throw error;
    }
}

export async function recordReconciliationResponse(transactionId, merchantId, response) {
    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const transaction = await client.query(
            `SELECT t.id, t.status, t.payment_id, t.merchant_id, t.amount,
                    t.result_code, t.checkout_request_id, t.merchant_request_id,
                    t.callback_metadata, t.paid_amount, t.mpesa_receipt_number,
                    t.paid_from_phone_number, t.provider_transaction_date,
                    p.reference, p.payment_link_id, m.user_id AS owner_user_id, m.business_name,
                    u.email AS owner_email
             FROM transactions t
             JOIN payments p ON p.id = t.payment_id
             LEFT JOIN merchants m ON m.id = t.merchant_id
             LEFT JOIN users u ON u.id = m.user_id
             WHERE t.id = $1 AND t.merchant_id = $2
             `,
            [transactionId, merchantId]
        );
        if (!transaction.rowCount) {
            await client.query("ROLLBACK");
            return false;
        }
        await client.query(
            `SELECT id FROM payments
             WHERE id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [transaction.rows[0].payment_id, merchantId]
        );
        await client.query(
            `SELECT id FROM transactions
             WHERE id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [transactionId, merchantId]
        );

        const providerTransaction = await client.query(
            `SELECT evidence_payload, received_amount, provider_reference
             FROM provider_transactions
             WHERE attempt_transaction_id = $1 AND merchant_id = $2`,
            [transactionId, merchantId]
        );
        const priorEvidence = await client.query(
            `SELECT evidence_type, response_payload
             FROM reconciliation_events
             WHERE merchant_id = $1 AND transaction_id = $2
               AND evidence_type IN ('STATUS_QUERY', 'CALLBACK_VERIFICATION')
             ORDER BY created_at DESC, id DESC`,
            [merchantId, transactionId]
        );
        const verification = compareStatusResponseWithTransaction(
            transaction.rows[0],
            providerTransaction.rows[0],
            response,
            priorEvidence.rows
        );
        const responsePayload = {
            ...response,
            verification: {
                agreement: verification.agreement,
                conflictFields: verification.conflictFields,
                unverifiedFields: verification.unverifiedFields
            }
        };
        const eventKey = `reconciliation:${transactionId}:${createHash("sha256")
            .update(JSON.stringify(responsePayload))
            .digest("hex")}`;

        await client.query(
            `UPDATE transactions
             SET reconciliation_response = $3,
                 reconciliation_requested_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1 AND merchant_id = $2
             RETURNING id`,
            [transactionId, merchantId, JSON.stringify(response)]
        );
        await client.query(
            `INSERT INTO reconciliation_events (
                merchant_id, transaction_id, evidence_type, result_code,
                callback_result_code, agreement, response_payload, event_key
             )
             VALUES ($1, $2, 'STATUS_QUERY', $3, $4, $5, $6, $7)
             ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
            [
                merchantId,
                transactionId,
                verification.statusResultCode,
                verification.callbackResultCode,
                verification.agreement,
                JSON.stringify(responsePayload),
                eventKey
            ]
        );
        if (!providerTransaction.rowCount) {
            await applyTerminalStatusQuery(
                client,
                transaction.rows[0],
                response,
                verification,
                eventKey
            );
        }
        await client.query("COMMIT");
        return true;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function listReconciliationEvents(merchantId, transactionId) {
    const result = await getDatabasePool().query(
        `SELECT re.id, re.transaction_id, re.evidence_type, re.result_code,
                re.callback_result_code, re.agreement, re.response_payload,
                re.created_at
         FROM reconciliation_events re
         JOIN transactions t ON t.id = re.transaction_id AND t.merchant_id = re.merchant_id
         WHERE re.merchant_id = $1 AND re.transaction_id = $2
         ORDER BY re.created_at DESC, re.id`,
        [merchantId, transactionId]
    );
    return result.rows;
}


export async function markReconciliationRequested(transactionId, merchantId) {
        const result = await getDatabasePool().query(
                `UPDATE transactions
                 SET reconciliation_requested_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND merchant_id = $2 AND status IN ('PENDING', 'TIMEOUT')
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
                p.status, ${PAYMENT_FULFILLMENT_SELECT}, p.created_at, p.updated_at,
                t.id AS transaction_id, t.mpesa_receipt_number, t.checkout_request_id
         FROM payments p
         LEFT JOIN LATERAL (
             SELECT id, mpesa_receipt_number, checkout_request_id
             FROM transactions WHERE payment_id = p.id
             ORDER BY created_at DESC LIMIT 1
         ) t ON true
         ${PAYMENT_FULFILLMENT_JOIN}
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
                p.status, ${PAYMENT_FULFILLMENT_SELECT},
                p.completed_at, p.created_at, p.updated_at,
                COALESCE(
                    jsonb_agg(jsonb_build_object(
                        'id', t.id,
                        'status', t.status,
                        'dispatchState', t.dispatch_state,
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
         ${PAYMENT_FULFILLMENT_JOIN}
         WHERE p.id = $1 AND p.merchant_id = $2
         GROUP BY p.id, payment_fulfillment.amount_received`,
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
                t.dispatch_state,
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

export async function markStkDispatching(transactionId, merchantId) {
    const client = await getDatabasePool().connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE transactions
             SET dispatch_state = 'DISPATCHING', updated_at = NOW()
             WHERE id = $1 AND merchant_id = $2
               AND status = 'PENDING' AND dispatch_state = 'PREPARED'
             RETURNING id`,
            [transactionId, merchantId]
        );
        if (result.rowCount) {
            await recordDispatchAudit(client, {
                merchantId,
                transactionId,
                action: "PAYMENT_STK_DISPATCHING",
                details: { dispatchState: "DISPATCHING" },
                eventKey: `stk-dispatching:${transactionId}`
            });
        }
        await client.query("COMMIT");
        return result.rowCount > 0;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
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
                 dispatch_state = 'ACKNOWLEDGED',
                 updated_at = NOW()
             WHERE id = $1 AND status = 'PENDING'
               AND dispatch_state = 'DISPATCHING'
             RETURNING payment_id, merchant_id, checkout_request_id`,
            [transactionId, response.MerchantRequestID ?? null,
                response.CheckoutRequestID ?? null, response.ResponseCode ?? null,
                response.ResponseDescription ?? null, JSON.stringify(response)]
        );

        if (result.rowCount) {
            await recordDispatchAudit(client, {
                merchantId: result.rows[0].merchant_id,
                transactionId,
                action: "PAYMENT_STK_ACKNOWLEDGED",
                details: {
                    dispatchState: "ACKNOWLEDGED",
                    responseCode: response.ResponseCode ?? null,
                    merchantRequestId: response.MerchantRequestID ?? null,
                    checkoutRequestId: response.CheckoutRequestID ?? null
                },
                eventKey: `stk-acknowledged:${transactionId}`
            });
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
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function markInitiationFailed(
    transactionId,
    reason,
    darajaResponse,
    dispatchState = "REJECTED"
) {
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE transactions
             SET status = 'FAILED', dispatch_state = $4,
                 failure_reason = $2, stk_response = $3, updated_at = NOW()
             WHERE id = $1 AND status = 'PENDING'
               AND dispatch_state IN ('PREPARED', 'DISPATCHING')
             RETURNING payment_id, merchant_id`,
            [
                transactionId,
                reason,
                dispatchState === "REJECTED" && darajaResponse
                    ? JSON.stringify(darajaResponse)
                    : null,
                dispatchState
            ]
        );

        if (result.rowCount) {
            await recordDispatchAudit(client, {
                merchantId: result.rows[0].merchant_id,
                transactionId,
                action: dispatchState === "REJECTED"
                    ? "PAYMENT_STK_REJECTED"
                    : "PAYMENT_STK_PRE_DISPATCH_FAILED",
                details: {
                    dispatchState,
                    reason,
                    ...(darajaResponse ? { providerResponse: darajaResponse } : {})
                },
                eventKey: `stk-${dispatchState.toLowerCase()}:${transactionId}`
            });
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

export async function markDispatchUncertain(transactionId, error) {
    const client = await getDatabasePool().connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE transactions
             SET dispatch_state = 'UNCERTAIN', updated_at = NOW()
             WHERE id = $1 AND status = 'PENDING' AND dispatch_state = 'DISPATCHING'
             RETURNING merchant_id`,
            [transactionId]
        );
        if (result.rowCount) {
            await recordDispatchAudit(client, {
                merchantId: result.rows[0].merchant_id,
                transactionId,
                action: "PAYMENT_STK_UNCERTAIN",
                details: {
                    dispatchState: "UNCERTAIN",
                    errorMessage: String(error?.message ?? "STK dispatch response was not received").slice(0, 1000),
                    ...(error?.code ? { errorCode: String(error.code).slice(0, 100) } : {})
                },
                eventKey: `stk-uncertain:${transactionId}`
            });
        }
        await client.query("COMMIT");
        return result.rowCount > 0;
    } catch (markError) {
        await client.query("ROLLBACK");
        throw markError;
    } finally {
        client.release();
    }
}

export async function markExpiredPendingAttempts({ timeoutSeconds, limit = 100 }) {
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) {
        throw new Error("timeoutSeconds must be a positive integer");
    }
    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const expired = await client.query(
            `SELECT t.id, t.payment_id, t.merchant_id, t.dispatch_state
             FROM transactions t
             WHERE t.status = 'PENDING'
               AND t.created_at <= NOW() - ($1 * INTERVAL '1 second')
             ORDER BY t.created_at
             LIMIT $2
             FOR UPDATE OF t SKIP LOCKED`,
            [timeoutSeconds, limit]
        );

        for (const attempt of expired.rows) {
            const wasNotDispatched = attempt.dispatch_state === "PREPARED";
            const status = wasNotDispatched ? "FAILED" : "TIMEOUT";
            const dispatchState = wasNotDispatched
                ? "PRE_DISPATCH_FAILED"
                : attempt.dispatch_state === "DISPATCHING"
                    ? "UNCERTAIN"
                    : attempt.dispatch_state;
            await client.query(
                `UPDATE transactions
                 SET status = $2, dispatch_state = $3,
                     failure_reason = $4,
                     updated_at = NOW()
                 WHERE id = $1 AND status = 'PENDING'`,
                [
                    attempt.id,
                    status,
                    dispatchState,
                    wasNotDispatched
                        ? "Dispatch did not begin before the configured timeout"
                        : "Awaited outcome exceeded the configured timeout"
                ]
            );
            await client.query(
                `UPDATE payments
                 SET status = $2, completed_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND status = 'PENDING'`,
                [attempt.payment_id, status]
            );
            await recordDispatchAudit(client, {
                merchantId: attempt.merchant_id,
                transactionId: attempt.id,
                action: wasNotDispatched
                    ? "PAYMENT_STK_PRE_DISPATCH_FAILED"
                    : "PAYMENT_ATTEMPT_TIMEOUT",
                details: {
                    dispatchState,
                    attemptStatus: status
                },
                eventKey: `attempt-timeout:${attempt.id}`
            });
        }
        await client.query("COMMIT");
        return expired.rows.length;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function createPaymentAttemptRecoveryDisposition({
    transactionId,
    operatorUserId,
    reason,
    supportingEvidence
}) {
    const client = await getDatabasePool().connect();
    try {
        await client.query("BEGIN");
        const attempt = await client.query(
            `SELECT id, merchant_id, status, dispatch_state, checkout_request_id
             FROM transactions
             WHERE id = $1
             FOR UPDATE`,
            [transactionId]
        );
        if (!attempt.rowCount) {
            await client.query("ROLLBACK");
            return null;
        }

        const current = attempt.rows[0];
        const requestHash = hashRecoveryRequest({
            operatorUserId,
            reason,
            supportingEvidence
        });
        const existing = await client.query(
            `SELECT id, attempt_transaction_id, merchant_id, operator_user_id,
                    disposition, reason, supporting_evidence, created_at, request_hash
             FROM payment_attempt_recovery_dispositions
             WHERE attempt_transaction_id = $1
             FOR UPDATE`,
            [transactionId]
        );
        if (existing.rowCount) {
            if (existing.rows[0].request_hash.trim() !== requestHash) {
                throw new RecoveryDispositionConflictError();
            }
            await client.query("COMMIT");
            const { request_hash, ...disposition } = existing.rows[0];
            return disposition;
        }

        if (
            current.status !== "TIMEOUT"
            || current.checkout_request_id
            || !["UNCERTAIN", "ACKNOWLEDGED", "LEGACY_UNKNOWN"].includes(current.dispatch_state)
        ) {
            throw new PaymentAttemptNotRecoverableError();
        }

        const providerEvidence = await client.query(
            `SELECT 1
             FROM provider_transactions
             WHERE attempt_transaction_id = $1 AND merchant_id = $2
             LIMIT 1`,
            [transactionId, current.merchant_id]
        );
        if (providerEvidence.rowCount) {
            throw new PaymentAttemptNotRecoverableError();
        }

        const inserted = await client.query(
            `INSERT INTO payment_attempt_recovery_dispositions (
                attempt_transaction_id, merchant_id, operator_user_id,
                disposition, reason, supporting_evidence, request_hash
             )
             VALUES ($1, $2, $3, 'RETRY_AUTHORIZED', $4, $5, $6)
             RETURNING id, attempt_transaction_id, merchant_id, operator_user_id,
                       disposition, reason, supporting_evidence, created_at`,
            [
                transactionId,
                current.merchant_id,
                operatorUserId,
                reason,
                supportingEvidence,
                requestHash
            ]
        );
        const disposition = inserted.rows[0];
        await recordDispatchAudit(client, {
            merchantId: current.merchant_id,
            userId: operatorUserId,
            transactionId,
            action: "PAYMENT_ATTEMPT_RETRY_AUTHORIZED",
            details: {
                recoveryDispositionId: disposition.id,
                reason,
                supportingEvidence
            },
            eventKey: `payment-attempt-recovery:${disposition.id}`
        });
        await client.query("COMMIT");
        return disposition;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export function determineCallbackOutcome(resultCode, metadata, requestedAmount) {
    if (resultCode === 1032) {
        return { status: "CANCELLED" };
    }
    if (resultCode !== 0) {
        return {
            status: "UNVERIFIED",
            unverifiedReason: "UNRECOGNIZED_DARAJA_RESULT_CODE"
        };
    }

    const paidAmount = Number(metadata.Amount);
    const hasValidAmount = Number.isFinite(paidAmount) && paidAmount > 0;

    return {
        status: hasValidAmount ? "SUCCESS" : "UNVERIFIED",
        ...(hasValidAmount ? { paidAmount, amountMatches: paidAmount === requestedAmount } : {
            unverifiedReason: "SUCCESS_CALLBACK_MISSING_VALID_AMOUNT"
        })
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

function evidenceValueEquals(field, left, right) {
    if (left == null && right == null) return true;
    if (left == null || right == null) return false;
    if (field === "Amount" || field === "ResultCode") {
        const leftNumber = Number(left);
        const rightNumber = Number(right);
        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            return leftNumber === rightNumber;
        }
    }
    return String(left) === String(right);
}

function callbackEvidenceDifferences(existingEvidence, callback, metadata) {
    const previousCallback = existingEvidence?.callback ?? {};
    const previousMetadata = existingEvidence?.metadata ?? {};
    const differences = [];
    for (const [field, conflictField] of [
        ["CheckoutRequestID", "checkoutRequestId"],
        ["MerchantRequestID", "merchantRequestId"],
        ["ResultCode", "resultCode"]
    ]) {
        if (!evidenceValueEquals(field, previousCallback[field], callback[field])) {
            differences.push(conflictField);
        }
    }
    for (const [field, conflictField] of [
        ["Amount", "amount"],
        ["MpesaReceiptNumber", "receipt"],
        ["PhoneNumber", "phoneNumber"],
        ["TransactionDate", "transactionDate"]
    ]) {
        if (!evidenceValueEquals(field, previousMetadata[field], metadata[field])) {
            differences.push(conflictField);
        }
    }
    return differences;
}

function statusResponseFromEvidence(evidence) {
    if (evidence.evidence_type === "CALLBACK_VERIFICATION") {
        return evidence.response_payload?.statusResponse ?? null;
    }
    return evidence.response_payload;
}

function providerResponseDifferences(previousResponse, currentResponse) {
    if (!previousResponse || !currentResponse) return [];
    const differences = [];
    const previousResultCode = parseResultCode(previousResponse.ResultCode ?? previousResponse.resultCode);
    const currentResultCode = parseResultCode(currentResponse.ResultCode ?? currentResponse.resultCode);
    if (
        previousResultCode != null
        && currentResultCode != null
        && previousResultCode !== currentResultCode
    ) {
        differences.push("providerResultCode");
    }

    for (const [field, conflictField] of [
        ["CheckoutRequestID", "providerCheckoutRequestId"],
        ["MerchantRequestID", "providerMerchantRequestId"]
    ]) {
        if (
            previousResponse[field] != null
            && currentResponse[field] != null
            && !evidenceValueEquals(field, previousResponse[field], currentResponse[field])
        ) {
            differences.push(conflictField);
        }
    }

    const previousMetadata = extractCallbackMetadata(previousResponse.CallbackMetadata);
    const currentMetadata = extractCallbackMetadata(currentResponse.CallbackMetadata);
    for (const [field, conflictField] of [
        ["Amount", "providerAmount"],
        ["MpesaReceiptNumber", "providerReceipt"],
        ["PhoneNumber", "providerPhoneNumber"],
        ["TransactionDate", "providerTransactionDate"]
    ]) {
        if (
            Object.hasOwn(previousMetadata, field)
            && Object.hasOwn(currentMetadata, field)
            && !evidenceValueEquals(field, previousMetadata[field], currentMetadata[field])
        ) {
            differences.push(conflictField);
        }
    }
    return differences;
}

async function recordCallbackVerification(client, transaction, callback, metadata, context, verification) {
    const resultCode = verification.statusResultCode ?? null;
    const callbackResultCode = verification.callbackResultCode ?? parseResultCode(callback.ResultCode);
    const responsePayload = {
        callback,
        metadata,
        rawPayload: context.rawPayload ?? { Body: { stkCallback: callback } },
        ...(context.statusResponse === undefined ? {} : { statusResponse: context.statusResponse }),
        ...(context.statusQueryError ? { statusQueryError: context.statusQueryError } : {}),
        verification: {
            agreement: verification.agreement,
            conflictFields: verification.conflictFields ?? [],
            unverifiedFields: verification.unverifiedFields ?? []
        }
    };
    const eventKey = `callback-verification:${transaction.id}:${createHash("sha256")
        .update(JSON.stringify(responsePayload))
        .digest("hex")}`;

    await client.query(
        `INSERT INTO reconciliation_events (
            merchant_id, transaction_id, evidence_type, result_code,
            callback_result_code, agreement, response_payload, event_key
         )
         VALUES ($1, $2, 'CALLBACK_VERIFICATION', $3, $4, $5, $6, $7)
         ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
        [
            transaction.merchant_id,
            transaction.id,
            resultCode,
            callbackResultCode,
            verification.agreement,
            JSON.stringify(responsePayload),
            eventKey
        ]
    );
}

async function markCallbackEventProcessed(client, eventId) {
    await client.query(
        `UPDATE webhook_events
         SET status = 'PROCESSED', processed_at = COALESCE(processed_at, NOW()),
             claimed_at = NULL, last_error = NULL, updated_at = NOW()
         WHERE id = $1`,
        [eventId]
    );
}

async function consumeSingleUsePaymentLink(client, transaction, eventKey) {
    if (!transaction.payment_link_id) return false;
    const link = await client.query(
        `SELECT id, use_mode, status
         FROM payment_links
         WHERE id = $1 AND merchant_id = $2
         FOR UPDATE`,
        [transaction.payment_link_id, transaction.merchant_id]
    );
    if (
        !link.rowCount
        || link.rows[0].use_mode !== "SINGLE_USE"
        || link.rows[0].status !== "ACTIVE"
    ) {
        return false;
    }
    await client.query(
        `UPDATE payment_links
         SET status = 'INACTIVE', consumed_at = COALESCE(consumed_at, NOW()), updated_at = NOW()
         WHERE id = $1 AND merchant_id = $2 AND status = 'ACTIVE'
         RETURNING id`,
        [transaction.payment_link_id, transaction.merchant_id]
    );
    await client.query(
        `INSERT INTO audit_logs (
            user_id, merchant_id, action, entity_type, entity_id, details, event_key
         )
         VALUES ($1, $2, 'PAYMENT_LINK_CONSUMED', 'PAYMENT_LINK', $3, $4, $5)
         ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
        [
            transaction.owner_user_id,
            transaction.merchant_id,
            link.rows[0].id,
            JSON.stringify({
                paymentRequestId: transaction.payment_id,
                paymentAttemptId: transaction.id,
                useMode: "SINGLE_USE"
            }),
            eventKey
        ]
    );
    return true;
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
             WHERE id = $1 AND status IN ('PENDING', 'TIMEOUT')
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

    const providerTransaction = await client.query(
        `INSERT INTO provider_transactions (
            merchant_id, attempt_transaction_id, provider, outcome,
            provider_reference, received_amount, currency,
            evidence_type, evidence_event_key, evidence_payload
         )
         VALUES ($1, $2, 'MPESA', $3, $4, $5, 'KES', 'CALLBACK', $6, $7)
         ON CONFLICT (attempt_transaction_id) DO NOTHING
         RETURNING id`,
        [
            transaction.merchant_id,
            transaction.id,
            outcome.status,
            outcome.status === "SUCCESS" ? (metadata.MpesaReceiptNumber ?? null) : null,
            outcome.status === "SUCCESS" ? (outcome.paidAmount ?? null) : null,
            `mpesa:${callback.CheckoutRequestID}`,
            JSON.stringify({ callback, metadata })
        ]
    );

    let providerTransactionId = providerTransaction.rows[0]?.id ?? null;
    if (!providerTransactionId) {
        const existingProviderTransaction = await client.query(
            "SELECT id FROM provider_transactions WHERE attempt_transaction_id = $1",
            [transaction.id]
        );
        providerTransactionId = existingProviderTransaction.rows[0]?.id ?? null;
    }
    if (outcome.status === "SUCCESS" && providerTransactionId) {
        await processSuccessfulProviderTransaction(client, {
            merchantId: transaction.merchant_id,
            providerTransactionId,
            receivedAmount: outcome.paidAmount,
            paymentId: update.rows[0].payment_id
        });
        await consumeSingleUsePaymentLink(
            client,
            transaction,
            `payment-link-consumed:${callback.CheckoutRequestID}`
        );
    }

    await client.query(
        `UPDATE payments SET status = $2, completed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status IN ('PENDING', 'TIMEOUT')`,
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

export async function applyMpesaCallback(callback, metadata, eventContext = {}) {
    const checkoutRequestId = callback?.CheckoutRequestID;
    const resultCode = parseResultCode(callback?.ResultCode);

    if (typeof checkoutRequestId !== "string" || !checkoutRequestId || resultCode === null || !metadata || typeof metadata !== "object") {
        return { matched: false, reason: "INVALID_CALLBACK" };
    }

    let webhookEvent = eventContext;
    if (!webhookEvent.eventId) {
        webhookEvent = await enqueueMpesaCallback(
            callback,
            metadata,
            eventContext.rawPayload ?? { Body: { stkCallback: callback } }
        );
        if (!webhookEvent.accepted) {
            return { matched: false, reason: webhookEvent.reason ?? "INVALID_CALLBACK" };
        }
    }

    const pool = getDatabasePool();
    const associated = await pool.query(
        `SELECT t.id, t.checkout_request_id
         FROM transactions t
         WHERE t.checkout_request_id = $1`,
        [checkoutRequestId]
    );
    if (!associated.rowCount) {
        return {
            matched: false,
            reason: "TRANSACTION_NOT_FOUND",
            storedForRetry: true
        };
    }

    let statusResponse;
    let statusQueryError;
    try {
        const accessToken = await getAccessToken();
        statusResponse = await queryStkStatus({
            shortCode: process.env.MPESA_SHORTCODE,
            passkey: process.env.MPESA_PASSKEY,
            timestamp: generateTimestamp(),
            checkoutRequestId
        }, accessToken);
    } catch (error) {
        statusResponse = error.response?.data ?? null;
        statusQueryError = {
            message: String(error.message ?? "Daraja status query failed").slice(0, 1000),
            ...(error.code ? { code: String(error.code).slice(0, 100) } : {})
        };
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [checkoutRequestId]);
        const event = await client.query(
            "SELECT id FROM webhook_events WHERE id = $1 FOR UPDATE",
            [webhookEvent.eventId]
        );
        if (!event.rowCount) {
            throw new Error("Persisted callback event was not found");
        }
        const existing = await client.query(
            `SELECT t.id, t.payment_id, t.status, t.merchant_id, t.checkout_request_id,
                    t.merchant_request_id, t.result_code, t.callback_metadata,
                    p.amount, p.reference, p.payment_link_id,
                    m.user_id AS owner_user_id, m.business_name, u.email AS owner_email
             FROM transactions t
             JOIN payments p ON p.id = t.payment_id
             LEFT JOIN merchants m ON m.id = t.merchant_id
             LEFT JOIN users u ON u.id = m.user_id
             WHERE t.checkout_request_id = $1`,
            [checkoutRequestId]
        );

        if (!existing.rowCount) {
            await client.query(
                `UPDATE webhook_events
                 SET status = 'RECEIVED',
                     payload = jsonb_set(payload, '{statusQueryEvidence}',
                         COALESCE(payload->'statusQueryEvidence', '[]'::jsonb) || $2::jsonb, true),
                     last_error = 'Awaiting transaction association',
                     next_attempt_at = GREATEST(next_attempt_at, NOW()), claimed_at = NULL,
                     updated_at = NOW()
                 WHERE id = $1`,
                [
                    webhookEvent.eventId,
                    JSON.stringify([{
                        statusResponse,
                        ...(statusQueryError ? { statusQueryError } : {})
                    }])
                ]
            );
            await client.query("COMMIT");
            return { matched: false, reason: "TRANSACTION_NOT_FOUND", storedForRetry: true };
        }

        const transaction = existing.rows[0];
        await client.query(
            `SELECT id FROM payments
             WHERE id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [transaction.payment_id, transaction.merchant_id]
        );
        await client.query(
            `SELECT id FROM transactions
             WHERE id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [transaction.id, transaction.merchant_id]
        );
        let verification = statusQueryError
            ? {
                agreement: "UNVERIFIED",
                callbackResultCode: resultCode,
                statusResultCode: null,
                conflictFields: [],
                unverifiedFields: ["resultCode"]
            }
            : compareCallbackWithDarajaStatus(callback, metadata, transaction, statusResponse);

        const providerTransaction = await client.query(
            `SELECT id, outcome, evidence_payload
             FROM provider_transactions
             WHERE attempt_transaction_id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [transaction.id, transaction.merchant_id]
        );
        const conflictFields = [...verification.conflictFields];
        if (providerTransaction.rowCount && providerTransaction.rows[0].evidence_payload?.callback) {
            conflictFields.push(...callbackEvidenceDifferences(
                providerTransaction.rows[0].evidence_payload,
                callback,
                metadata
            ));
        }

        const otherCallbackEvidence = await client.query(
            `SELECT id, payload
             FROM webhook_events
             WHERE provider = 'MPESA'
               AND event_type = 'STK_CALLBACK'
               AND payload->'callback'->>'CheckoutRequestID' = $1
               AND id <> $2`,
            [checkoutRequestId, webhookEvent.eventId]
        );
        for (const evidence of otherCallbackEvidence.rows) {
            conflictFields.push(...callbackEvidenceDifferences(
                evidence.payload,
                callback,
                metadata
            ));
        }

        if (metadata.MpesaReceiptNumber) {
            const receiptUse = await client.query(
                `SELECT EXISTS (
                    SELECT 1 FROM transactions
                    WHERE mpesa_receipt_number = $1 AND id <> $2
                 ) AS already_associated`,
                [String(metadata.MpesaReceiptNumber), transaction.id]
            );
            if (receiptUse.rows[0].already_associated) {
                conflictFields.push("receiptAlreadyAssociated");
            }
        }

        if (
            !statusQueryError
            && verification.agreement !== "UNVERIFIED"
            && verification.statusResultCode !== null
        ) {
            const priorEvidence = await client.query(
                `SELECT evidence_type, result_code, agreement, response_payload
                 FROM reconciliation_events
                 WHERE transaction_id = $1
                   AND evidence_type IN ('STATUS_QUERY', 'CALLBACK_VERIFICATION')
                 ORDER BY created_at DESC, id DESC`,
                [transaction.id]
            );
            for (const evidence of priorEvidence.rows) {
                if (evidence.evidence_type === "CALLBACK_VERIFICATION") {
                    conflictFields.push(...callbackEvidenceDifferences(
                        evidence.response_payload,
                        callback,
                        metadata
                    ));
                }
                const previousStatusResponse = statusResponseFromEvidence(evidence);
                const previousStatusCode = parseResultCode(
                    previousStatusResponse?.ResultCode ?? previousStatusResponse?.resultCode
                );
                if (
                    previousStatusCode != null
                    && [0, 1032].includes(previousStatusCode)
                    && [0, 1032].includes(verification.statusResultCode)
                ) {
                    conflictFields.push(...providerResponseDifferences(
                        previousStatusResponse,
                        statusResponse
                    ));
                }
            }
        }

        if (conflictFields.length) {
            verification = {
                ...verification,
                agreement: "MISMATCH",
                conflictFields: [...new Set(conflictFields)]
            };
        }

        const callbackOutcome = determineCallbackOutcome(
            resultCode,
            metadata,
            Number(transaction.amount)
        );
        const missingSuccessfulAmount = callbackOutcome.unverifiedReason === "SUCCESS_CALLBACK_MISSING_VALID_AMOUNT";
        if (missingSuccessfulAmount && verification.agreement === "MATCH") {
            verification = {
                ...verification,
                agreement: "UNVERIFIED",
                unverifiedFields: [...new Set([...verification.unverifiedFields, "amount"])]
            };
        }

        await recordCallbackVerification(
            client,
            transaction,
            callback,
            metadata,
            {
                ...webhookEvent,
                statusResponse,
                ...(statusQueryError ? { statusQueryError } : {})
            },
            verification
        );

        if (verification.agreement === "MISMATCH") {
            await markCallbackEventProcessed(client, webhookEvent.eventId);
            await client.query("COMMIT");
            return {
                matched: true,
                conflict: true,
                status: transaction.status,
                conflictFields: verification.conflictFields
            };
        }

        if (!statusQueryError && missingSuccessfulAmount) {
            await markCallbackEventProcessed(client, webhookEvent.eventId);
            await client.query("COMMIT");
            return {
                matched: true,
                unverified: true,
                status: transaction.status,
                reason: callbackOutcome.unverifiedReason
            };
        }

        if (statusQueryError || verification.agreement === "UNVERIFIED") {
            await client.query("COMMIT");
            return {
                matched: false,
                reason: statusQueryError ? "DARAJA_STATUS_VERIFICATION_FAILED" : "DARAJA_STATUS_UNVERIFIED",
                storedForRetry: true,
                error: statusQueryError?.message
            };
        }

        if (providerTransaction.rowCount) {
            await markCallbackEventProcessed(client, webhookEvent.eventId);
            await client.query("COMMIT");
            return {
                matched: true,
                duplicate: true,
                status: transaction.status
            };
        }

        if (transaction.status !== "PENDING" && transaction.status !== "TIMEOUT") {
            await markCallbackEventProcessed(client, webhookEvent.eventId);
            await client.query("COMMIT");
            return { matched: true, duplicate: true, status: transaction.status };
        }

        const outcome = await updateTransactionFromCallback(client, transaction, callback, metadata);
        await markCallbackEventProcessed(client, webhookEvent.eventId);
        await client.query("COMMIT");
        return outcome;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}