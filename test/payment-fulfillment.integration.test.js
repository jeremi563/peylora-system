import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import "dotenv/config";

process.env.NODE_ENV = "test";

test("Payment Request fulfillment is cumulative, additive, and blocks further collection only when fulfilled", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const email = `payment-fulfillment-${suffix}@example.test`;
    let merchantId;

    try {
        const user = await pool.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES ('Fulfillment Merchant', $1, 'test-password-hash')
             RETURNING id`,
            [email]
        );
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Fulfillment Shop', $2)
             RETURNING id`,
            [user.rows[0].id, email]
        )).rows[0].id;

        const {
            createPaymentAttempt,
            getMerchantPayment,
            getRetryableMerchantPayment,
            listMerchantPayments,
            PaymentRequestFulfilledError
        } = await import("../src/services/transaction.service.js");

        async function createPayment(amount, status = "SUCCESS") {
            const result = await pool.query(
                `INSERT INTO payments (merchant_id, reference, amount, phone_number, status)
                 VALUES ($1, $2, $3, '254700001234', $4)
                 RETURNING id`,
                [merchantId, `PAY-FULFILL-${randomUUID()}`, amount, status]
            );
            return result.rows[0].id;
        }

        async function createAttempt(paymentId, amount, status = "SUCCESS") {
            const result = await pool.query(
                `INSERT INTO transactions (
                    payment_id, merchant_id, account_reference, amount, phone_number, provider, status
                 )
                 VALUES ($1, $2, $3, $4, '254700001234', 'MPESA', $5)
                 RETURNING id`,
                [paymentId, merchantId, `ATT-FULFILL-${randomUUID()}`, amount, status]
            );
            return result.rows[0].id;
        }

        async function recordProviderTransaction(attemptId, outcome, amount, eventKey = randomUUID()) {
            return pool.query(
                `INSERT INTO provider_transactions (
                    merchant_id, attempt_transaction_id, provider, outcome,
                    provider_reference, received_amount, evidence_type, evidence_event_key
                 )
                 VALUES ($1, $2, 'MPESA', $3, $4, $5, 'CALLBACK', $6)
                 ON CONFLICT (attempt_transaction_id) DO NOTHING
                 RETURNING id`,
                [
                    merchantId,
                    attemptId,
                    outcome,
                    outcome === "SUCCESS" ? `RECEIPT-${eventKey}` : null,
                    amount,
                    `evidence-${eventKey}`
                ]
            );
        }

        const cumulativePaymentId = await createPayment(100);
        const earlierAttemptId = await createAttempt(cumulativePaymentId, 100);
        const laterAttemptId = await createAttempt(cumulativePaymentId, 100);

        await recordProviderTransaction(laterAttemptId, "SUCCESS", 40);
        let payment = await getMerchantPayment(merchantId, cumulativePaymentId);
        assert.equal(payment.status, "SUCCESS");
        assert.deepEqual(payment.fulfillment, {
            status: "PARTIALLY_FULFILLED",
            amountReceived: 40
        });

        const listed = await listMerchantPayments(merchantId, { page: 1, limit: 100 });
        const listedPayment = listed.items.find(({ id }) => id === cumulativePaymentId);
        assert.equal(listedPayment.status, "SUCCESS");
        assert.deepEqual(listedPayment.fulfillment, payment.fulfillment);

        await recordProviderTransaction(earlierAttemptId, "SUCCESS", 60);
        payment = await getMerchantPayment(merchantId, cumulativePaymentId);
        assert.deepEqual(payment.fulfillment, {
            status: "FULFILLED",
            amountReceived: 100
        });

        const duplicateEvidence = await recordProviderTransaction(earlierAttemptId, "SUCCESS", 60);
        assert.equal(duplicateEvidence.rowCount, 0);

        const excessAttemptId = await createAttempt(cumulativePaymentId, 100);
        await recordProviderTransaction(excessAttemptId, "SUCCESS", 25);
        const failedAttemptId = await createAttempt(cumulativePaymentId, 100, "FAILED");
        await recordProviderTransaction(failedAttemptId, "FAILED", null);
        payment = await getMerchantPayment(merchantId, cumulativePaymentId);
        assert.deepEqual(payment.fulfillment, {
            status: "FULFILLED",
            amountReceived: 125
        });

        const unfulfilledPaymentId = await createPayment(100, "PENDING");
        payment = await getMerchantPayment(merchantId, unfulfilledPaymentId);
        assert.deepEqual(payment.fulfillment, {
            status: "UNFULFILLED",
            amountReceived: 0
        });

        const retryPaymentId = await createPayment(100);
        const partialAttemptId = await createAttempt(retryPaymentId, 100);
        await recordProviderTransaction(partialAttemptId, "SUCCESS", 25);
        const retryable = await getRetryableMerchantPayment(merchantId, retryPaymentId);
        assert.deepEqual(retryable.fulfillment, {
            status: "PARTIALLY_FULFILLED",
            amountReceived: 25
        });

        const retry = await createPaymentAttempt({
            merchantId,
            paymentId: retryPaymentId,
            accountReference: `RETRY-FULFILL-${randomUUID()}`,
            phoneNumber: "254700001234",
            requestedAmount: 100
        });
        assert.equal(retry.requestedAmount, 100);
        await recordProviderTransaction(retry._id, "SUCCESS", 75);
        await pool.query(
            "UPDATE payments SET status = 'SUCCESS' WHERE id = $1",
            [retryPaymentId]
        );
        payment = await getMerchantPayment(merchantId, retryPaymentId);
        assert.deepEqual(payment.fulfillment, {
            status: "FULFILLED",
            amountReceived: 100
        });

        await assert.rejects(
            createPaymentAttempt({
                merchantId,
                paymentId: retryPaymentId,
                accountReference: `RETRY-FULFILL-${randomUUID()}`,
                phoneNumber: "254700001234",
                requestedAmount: 100
            }),
            PaymentRequestFulfilledError
        );

        const rollbackPaymentId = await createPayment(100);
        const rollbackBaseAttemptId = await createAttempt(rollbackPaymentId, 100);
        await recordProviderTransaction(rollbackBaseAttemptId, "SUCCESS", 20);
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const rolledBackAttempt = await client.query(
                `INSERT INTO transactions (
                    payment_id, merchant_id, account_reference, amount, phone_number, provider, status
                 )
                 VALUES ($1, $2, $3, 100, '254700001234', 'MPESA', 'SUCCESS')
                 RETURNING id`,
                [rollbackPaymentId, merchantId, `ROLLBACK-FULFILL-${randomUUID()}`]
            );
            await client.query(
                `INSERT INTO provider_transactions (
                    merchant_id, attempt_transaction_id, provider, outcome,
                    provider_reference, received_amount, evidence_type, evidence_event_key
                 )
                 VALUES ($1, $2, 'MPESA', 'SUCCESS', $3, 80, 'CALLBACK', $4)`,
                [
                    merchantId,
                    rolledBackAttempt.rows[0].id,
                    `RECEIPT-ROLLBACK-${randomUUID()}`,
                    `evidence-rollback-${randomUUID()}`
                ]
            );
            await client.query("ROLLBACK");
        } finally {
            client.release();
        }

        payment = await getMerchantPayment(merchantId, rollbackPaymentId);
        assert.deepEqual(payment.fulfillment, {
            status: "PARTIALLY_FULFILLED",
            amountReceived: 20
        });
    } finally {
        if (merchantId) {
            await pool.query("DELETE FROM provider_transactions WHERE merchant_id = $1", [merchantId]);
            await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]);
            await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]);
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]);
        }
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
        await closeDatabase();
    }
});
