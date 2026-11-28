import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import axios from "axios";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "phase-reconciliation-test-secret-at-least-32";
process.env.MPESA_CONSUMER_KEY = "reconciliation-test-key";
process.env.MPESA_CONSUMER_SECRET = "reconciliation-test-secret";
process.env.MPESA_SHORTCODE = "174379";
process.env.MPESA_PASSKEY = "reconciliation-test-passkey";

test("reconciliation evidence is append-only and merchant-scoped", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const email = `reconciliation-${suffix}@example.test`;
    let merchantId;
    let paymentId;
    let attemptId;
    let incompleteAttemptId;
    const originalAdapter = axios.defaults.adapter;

    try {
        const user = await pool.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES ('Reconciliation Merchant', $1, 'test-password-hash')
             RETURNING id`,
            [email]
        );
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Reconciliation Shop', $2)
             RETURNING id`,
            [user.rows[0].id, email]
        )).rows[0].id;
        paymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, reference, amount, phone_number, status)
             VALUES ($1, $2, 100, $3, 'PENDING')
             RETURNING id`,
            [merchantId, `PAY-RECON-${suffix}`, `254700${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;
        attemptId = (await pool.query(
            `INSERT INTO transactions (
                payment_id, merchant_id, account_reference, amount,
                currency, phone_number, provider, status, checkout_request_id
             )
             VALUES ($1, $2, $3, 100, 'KES', $4, 'MPESA', 'PENDING', $5)
             RETURNING id`,
            [paymentId, merchantId, `ACC-RECON-${suffix}`, `254700${suffix.replace(/-/g, "").slice(0, 6)}`, null]
        )).rows[0].id;
        await pool.query(
            "UPDATE transactions SET result_code = 0 WHERE id = $1",
            [attemptId]
        );

        const transactionService = await import("../src/services/transaction.service.js");
        const recorded = await transactionService.recordReconciliationResponse(
            attemptId,
            merchantId,
            { ResultCode: 0, ResultDesc: "The service request is processed successfully." }
        );
        assert.equal(recorded, true);

        const mismatch = await transactionService.recordReconciliationResponse(
            attemptId,
            merchantId,
            { ResultCode: 1032, ResultDesc: "Request cancelled by user" }
        );
        assert.equal(mismatch, true);

        const events = await transactionService.listReconciliationEvents(merchantId, attemptId);
        assert.equal(events.length, 2);
        assert.deepEqual(
            events.map((event) => event.agreement).sort(),
            ["MATCH", "MISMATCH"].sort()
        );

        const callback = {
            CheckoutRequestID: `CHECKOUT-${suffix}`,
            MerchantRequestID: `MERCHANT-${suffix}`,
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully."
        };
        const rawPayload = { Body: { stkCallback: callback } };
        const webhook = await import("../src/services/webhook.service.js");
        const queuedCallback = await webhook.enqueueMpesaCallback(
            callback,
            { Amount: 100, MpesaReceiptNumber: `RECEIPT-${suffix}` },
            rawPayload
        );
        assert.equal(queuedCallback.duplicate, false);

        const concurrentCheckoutId = `CHECKOUT-CONCURRENT-${suffix}`;
        const concurrentCallback = {
            CheckoutRequestID: concurrentCheckoutId,
            ResultCode: 0
        };
        const concurrentPayload = { Body: { stkCallback: concurrentCallback } };
        const concurrentEnqueues = await Promise.all([
            webhook.enqueueMpesaCallback(concurrentCallback, { Amount: 10 }, concurrentPayload),
            webhook.enqueueMpesaCallback(concurrentCallback, { Amount: 20 }, {
                Body: { stkCallback: { ...concurrentCallback, ResultDesc: "Changed evidence" } }
            }),
            webhook.enqueueMpesaCallback(concurrentCallback, { Amount: 10 }, concurrentPayload)
        ]);
        assert.equal(concurrentEnqueues.filter((item) => !item.duplicate).length, 2);
        assert.equal(new Set(concurrentEnqueues.map((item) => item.eventId)).size, 2);
        assert.equal((await pool.query(
            `SELECT COUNT(*)::integer AS count FROM webhook_events
             WHERE payload->'callback'->>'CheckoutRequestID' = $1`,
            [concurrentCheckoutId]
        )).rows[0].count, 2);

        await transactionService.markStkDispatching(attemptId, merchantId);
        await transactionService.saveStkResponse(attemptId, {
            ResponseCode: "0",
            MerchantRequestID: callback.MerchantRequestID,
            CheckoutRequestID: callback.CheckoutRequestID
        });
        const beforeVerification = await pool.query(
            `SELECT t.status, COUNT(pt.id)::integer AS provider_transaction_count
             FROM transactions t
             LEFT JOIN provider_transactions pt ON pt.attempt_transaction_id = t.id
             WHERE t.id = $1 GROUP BY t.id`,
            [attemptId]
        );
        assert.equal(beforeVerification.rows[0].status, "PENDING");
        assert.equal(beforeVerification.rows[0].provider_transaction_count, 0);

        let statusResultCode = 1032;
        axios.defaults.adapter = async (config) => {
            if (config.url.includes("oauth")) {
                return {
                    data: { access_token: "reconciliation-integration-token" },
                    status: 200,
                    statusText: "OK",
                    headers: {},
                    config
                };
            }
            if (config.url.includes("stkpushquery")) {
                const request = JSON.parse(config.data);
                return {
                    data: {
                        ResponseCode: "0",
                        CheckoutRequestID: request.CheckoutRequestID,
                        MerchantRequestID: request.CheckoutRequestID.replace("CHECKOUT", "MERCHANT"),
                        ResultCode: statusResultCode,
                        ResultDesc: statusResultCode === 1032
                            ? "Request cancelled by user"
                            : "The service request is processed successfully."
                    },
                    status: 200,
                    statusText: "OK",
                    headers: {},
                    config
                };
            }
            throw new Error(`Unexpected Daraja request: ${config.url}`);
        };
        const conflict = await transactionService.applyMpesaCallback(
            callback,
            { Amount: 100, MpesaReceiptNumber: `RECEIPT-${suffix}` },
            { eventId: queuedCallback.eventId, rawPayload }
        );
        assert.equal(conflict.conflict, true);
        assert.ok(conflict.conflictFields.includes("resultCode"));
        const unresolved = await pool.query(
            `SELECT t.status, COUNT(pt.id)::integer AS provider_transaction_count
             FROM transactions t
             LEFT JOIN provider_transactions pt ON pt.attempt_transaction_id = t.id
             WHERE t.id = $1 GROUP BY t.id`,
            [attemptId]
        );
        assert.equal(unresolved.rows[0].status, "PENDING");
        assert.equal(unresolved.rows[0].provider_transaction_count, 0);
        const callbackEvidence = await transactionService.listReconciliationEvents(merchantId, attemptId);
        const verification = callbackEvidence.find((event) => event.evidence_type === "CALLBACK_VERIFICATION");
        assert.equal(verification.agreement, "MISMATCH");
        assert.equal(verification.result_code, 1032);
        assert.equal(verification.callback_result_code, 0);
        assert.deepEqual(verification.response_payload.rawPayload, rawPayload);
        assert.equal(verification.response_payload.statusResponse.ResultCode, 1032);
        assert.equal(await transactionService.recordReconciliationResponse(
            attemptId,
            merchantId,
            {
                ResponseCode: "0",
                CheckoutRequestID: "OTHER-CHECKOUT",
                MerchantRequestID: callback.MerchantRequestID,
                ResultCode: 0,
                CallbackMetadata: {
                    Item: [
                        { Name: "Amount", Value: 101 },
                        { Name: "MpesaReceiptNumber", Value: "OTHER-RECEIPT" }
                    ]
                }
            }
        ), true);
        const manualConflict = (await transactionService.listReconciliationEvents(merchantId, attemptId))
            .find((event) => event.evidence_type === "STATUS_QUERY"
                && event.response_payload.CheckoutRequestID === "OTHER-CHECKOUT");
        assert.equal(manualConflict.agreement, "MISMATCH");
        assert.ok(manualConflict.response_payload.verification.conflictFields.includes("checkoutRequestId"));
        assert.ok(manualConflict.response_payload.verification.conflictFields.includes("amount"));
        assert.ok(manualConflict.response_payload.verification.conflictFields.includes("receipt"));

        const incompletePaymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, reference, amount, phone_number, status)
             VALUES ($1, $2, 100, $3, 'PENDING')
             RETURNING id`,
            [merchantId, `PAY-MISSING-AMOUNT-${suffix}`, `254700${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;
        incompleteAttemptId = (await pool.query(
            `INSERT INTO transactions (
                payment_id, merchant_id, account_reference, amount,
                currency, phone_number, provider, status
             )
             VALUES ($1, $2, $3, 100, 'KES', $4, 'MPESA', 'PENDING')
             RETURNING id`,
            [incompletePaymentId, merchantId, `ACC-MISSING-AMOUNT-${suffix}`, `254700${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;
        const incompleteCallback = {
            CheckoutRequestID: `CHECKOUT-MISSING-${suffix}`,
            MerchantRequestID: `MERCHANT-MISSING-${suffix}`,
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully."
        };
        const incompleteRawPayload = { Body: { stkCallback: incompleteCallback } };
        const incompleteEvent = await webhook.enqueueMpesaCallback(
            incompleteCallback,
            {},
            incompleteRawPayload
        );
        await transactionService.markStkDispatching(incompleteAttemptId, merchantId);
        await transactionService.saveStkResponse(incompleteAttemptId, {
            ResponseCode: "0",
            MerchantRequestID: incompleteCallback.MerchantRequestID,
            CheckoutRequestID: incompleteCallback.CheckoutRequestID
        });
        statusResultCode = 0;
        const unverifiedSuccess = await transactionService.applyMpesaCallback(
            incompleteCallback,
            {},
            { eventId: incompleteEvent.eventId, rawPayload: incompleteRawPayload }
        );
        assert.equal(unverifiedSuccess.unverified, true);
        assert.equal(unverifiedSuccess.status, "PENDING");
        const incompleteState = await pool.query(
            `SELECT t.status, COUNT(pt.id)::integer AS provider_transaction_count
             FROM transactions t
             LEFT JOIN provider_transactions pt ON pt.attempt_transaction_id = t.id
             WHERE t.id = $1 GROUP BY t.id`,
            [incompleteAttemptId]
        );
        assert.equal(incompleteState.rows[0].status, "PENDING");
        assert.equal(incompleteState.rows[0].provider_transaction_count, 0);
        const incompleteEvidence = await transactionService.listReconciliationEvents(merchantId, incompleteAttemptId);
        assert.equal(incompleteEvidence[0].agreement, "UNVERIFIED");
        assert.ok(incompleteEvidence[0].response_payload.verification.unverifiedFields.includes("amount"));

        const statusOnlyPaymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, reference, amount, phone_number, status)
             VALUES ($1, $2, 100, '254700001234', 'TIMEOUT')
             RETURNING id`,
            [merchantId, `PAY-STATUS-ONLY-${suffix}`]
        )).rows[0].id;
        const statusOnlyCheckoutId = `CHECKOUT-STATUS-ONLY-${suffix}`;
        const statusOnlyAttemptId = (await pool.query(
            `INSERT INTO transactions (
                payment_id, merchant_id, account_reference, amount,
                currency, phone_number, provider, status, dispatch_state,
                checkout_request_id, merchant_request_id
             )
             VALUES ($1, $2, $3, 100, 'KES', '254700001234', 'MPESA',
                     'TIMEOUT', 'ACKNOWLEDGED', $4, $5)
             RETURNING id`,
            [
                statusOnlyPaymentId,
                merchantId,
                `ACC-STATUS-ONLY-${suffix}`,
                statusOnlyCheckoutId,
                `MERCHANT-STATUS-ONLY-${suffix}`
            ]
        )).rows[0].id;
        const terminalStatusResponse = {
            ResponseCode: "0",
            CheckoutRequestID: statusOnlyCheckoutId,
            MerchantRequestID: `MERCHANT-STATUS-ONLY-${suffix}`,
            ResultCode: 0,
            ResultDesc: "The service request has been processed successfully",
            CallbackMetadata: {
                Item: [
                    { Name: "Amount", Value: 100 },
                    { Name: "MpesaReceiptNumber", Value: `STATUS-RECEIPT-${suffix}` }
                ]
            }
        };
        await pool.query(
            `INSERT INTO reconciliation_events (
                merchant_id, transaction_id, evidence_type, result_code,
                callback_result_code, agreement, response_payload, event_key
             )
             VALUES ($1, $2, 'CALLBACK_VERIFICATION', 0, 0, 'MATCH', $3, $4)
             ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
            [
                merchantId,
                statusOnlyAttemptId,
                JSON.stringify({
                    callback: {
                        CheckoutRequestID: statusOnlyCheckoutId,
                        MerchantRequestID: `MERCHANT-STATUS-ONLY-${suffix}`,
                        ResultCode: 0
                    },
                    metadata: {
                        Amount: 100,
                        MpesaReceiptNumber: `STATUS-RECEIPT-${suffix}`
                    }
                }),
                `callback-verification-status-only:${statusOnlyAttemptId}`
            ]
        );
        assert.equal(await transactionService.recordReconciliationResponse(
            statusOnlyAttemptId,
            merchantId,
            terminalStatusResponse
        ), true);
        assert.equal(await transactionService.recordReconciliationResponse(
            statusOnlyAttemptId,
            merchantId,
            terminalStatusResponse
        ), true);
        const statusOnlyState = await pool.query(
            `SELECT t.status, t.callback_received_at, p.status AS payment_status,
                    COUNT(pt.id)::integer AS provider_transaction_count,
                    MAX(pt.evidence_type) AS evidence_type,
                    MAX(pt.received_amount)::numeric AS received_amount
             FROM transactions t
             JOIN payments p ON p.id = t.payment_id
             LEFT JOIN provider_transactions pt ON pt.attempt_transaction_id = t.id
             WHERE t.id = $1
             GROUP BY t.id, p.status`,
            [statusOnlyAttemptId]
        );
        assert.equal(statusOnlyState.rows[0].status, "SUCCESS");
        assert.equal(statusOnlyState.rows[0].payment_status, "SUCCESS");
        assert.equal(statusOnlyState.rows[0].callback_received_at, null);
        assert.equal(statusOnlyState.rows[0].provider_transaction_count, 1);
        assert.equal(statusOnlyState.rows[0].evidence_type, "STATUS_QUERY");
        assert.equal(Number(statusOnlyState.rows[0].received_amount), 100);

        const missingAmountPaymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, reference, amount, phone_number, status)
             VALUES ($1, $2, 100, '254700001234', 'TIMEOUT')
             RETURNING id`,
            [merchantId, `PAY-STATUS-MISSING-AMOUNT-${suffix}`]
        )).rows[0].id;
        const missingAmountCheckoutId = `CHECKOUT-STATUS-MISSING-AMOUNT-${suffix}`;
        const missingAmountAttemptId = (await pool.query(
            `INSERT INTO transactions (
                payment_id, merchant_id, account_reference, amount,
                currency, phone_number, provider, status, dispatch_state,
                checkout_request_id
             )
             VALUES ($1, $2, $3, 100, 'KES', '254700001234', 'MPESA',
                     'TIMEOUT', 'UNCERTAIN', $4)
             RETURNING id`,
            [
                missingAmountPaymentId,
                merchantId,
                `ACC-STATUS-MISSING-AMOUNT-${suffix}`,
                missingAmountCheckoutId
            ]
        )).rows[0].id;
        assert.equal(await transactionService.recordReconciliationResponse(
            missingAmountAttemptId,
            merchantId,
            {
                ResponseCode: "0",
                CheckoutRequestID: missingAmountCheckoutId,
                ResultCode: 0,
                ResultDesc: "The service request has been processed successfully"
            }
        ), true);
        const missingAmountState = await pool.query(
            `SELECT t.status, p.status AS payment_status,
                    COUNT(pt.id)::integer AS provider_transaction_count
             FROM transactions t
             JOIN payments p ON p.id = t.payment_id
             LEFT JOIN provider_transactions pt ON pt.attempt_transaction_id = t.id
             WHERE t.id = $1
             GROUP BY t.id, p.status`,
            [missingAmountAttemptId]
        );
        assert.equal(missingAmountState.rows[0].status, "TIMEOUT");
        assert.equal(missingAmountState.rows[0].payment_status, "TIMEOUT");
        assert.equal(missingAmountState.rows[0].provider_transaction_count, 0);

        const secondMerchant = await pool.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES ('Other Merchant', $1, 'test-password-hash')
             RETURNING id`,
            [`other-recon-${suffix}@example.test`]
        );
        const secondMerchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name)
             VALUES ($1, 'Other Shop')
             RETURNING id`,
            [secondMerchant.rows[0].id]
        )).rows[0].id;
        await assert.rejects(
            pool.query(
                `INSERT INTO reconciliation_events (
                    merchant_id, transaction_id, evidence_type, result_code,
                    response_payload
                 )
                 VALUES ($1, $2, 'STATUS_QUERY', 0, '{}')`,
                [secondMerchantId, attemptId]
            ),
            /reconciliation_events_transaction_fk/
        );
    } finally {
        axios.defaults.adapter = originalAdapter;
        await pool.query(
            "DELETE FROM webhook_events WHERE event_key LIKE $1 OR event_key LIKE $2 OR event_key LIKE $3",
            [
                `mpesa:CHECKOUT-${suffix}%`,
                `mpesa:CHECKOUT-MISSING-${suffix}%`,
                `mpesa:CHECKOUT-CONCURRENT-${suffix}%`
            ]
        ).catch(() => {});
        await pool.query(
            "DELETE FROM notifications WHERE user_id = (SELECT user_id FROM merchants WHERE id = $1)",
            [merchantId]
        ).catch(() => {});
        await pool.query("DELETE FROM unassigned_received_funds WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM audit_logs WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM reconciliation_events WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM provider_transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM users WHERE email = $1", [email]).catch(() => {});
        await closeDatabase();
    }
});
