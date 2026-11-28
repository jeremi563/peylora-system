import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import "dotenv/config";

process.env.NODE_ENV = "test";

test("payment admission is serialized for same-key replay and distinct concurrent keys", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const email = `payment-admission-${suffix}@example.test`;
    let merchantId;
    let paymentId;

    try {
        const user = await pool.query(
            `INSERT INTO users (name, email, password_hash, email_verified)
             VALUES ('Admission Merchant', $1, 'test-password-hash', true)
             RETURNING id`,
            [email]
        );
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Admission Shop', $2)
             RETURNING id`,
            [user.rows[0].id, email]
        )).rows[0].id;
        paymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, reference, amount, phone_number, description, status)
             VALUES ($1, $2, 100, '254700001234', 'Admission test', 'PENDING')
             RETURNING id`,
            [merchantId, `PAY-ADMISSION-${suffix}`]
        )).rows[0].id;

        const transactionService = await import("../src/services/transaction.service.js");
        const sameKey = `admission-same-${suffix}`;
        const sameKeyArgs = (accountReference) => ({
            merchantId,
            paymentId,
            accountReference,
            phoneNumber: "254700001234",
            requestedAmount: 100,
            description: "Admission test",
            idempotencyKey: sameKey
        });

        const sameKeyResults = await Promise.allSettled([
            transactionService.createPaymentAttempt(sameKeyArgs(`ACC-SAME-A-${suffix}`)),
            transactionService.createPaymentAttempt(sameKeyArgs(`ACC-SAME-B-${suffix}`))
        ]);
        assert.equal(sameKeyResults.filter((result) => result.status === "fulfilled").length, 2);
        const attempts = await pool.query(
            `SELECT id, status
             FROM transactions
             WHERE payment_id = $1`,
            [paymentId]
        );
        assert.equal(attempts.rowCount, 1);
        assert.equal(attempts.rows[0].status, "PENDING");

        await pool.query(
            `UPDATE transactions
             SET status = 'FAILED', dispatch_state = 'REJECTED', updated_at = NOW()
             WHERE payment_id = $1`,
            [paymentId]
        );

        const distinctKeys = await Promise.allSettled([
            transactionService.createPaymentAttempt({
                merchantId,
                paymentId,
                accountReference: `ACC-DISTINCT-A-${suffix}`,
                phoneNumber: "254700001234",
                requestedAmount: 100,
                description: "Admission test",
                idempotencyKey: `admission-distinct-a-${suffix}`
            }),
            transactionService.createPaymentAttempt({
                merchantId,
                paymentId,
                accountReference: `ACC-DISTINCT-B-${suffix}`,
                phoneNumber: "254700001234",
                requestedAmount: 100,
                description: "Admission test",
                idempotencyKey: `admission-distinct-b-${suffix}`
            })
        ]);
        assert.equal(distinctKeys.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(distinctKeys.filter((result) => result.status === "rejected").length, 1);

        const pendingCount = await pool.query(
            `SELECT COUNT(*)::integer AS count
             FROM transactions
             WHERE payment_id = $1 AND status = 'PENDING'`,
            [paymentId]
        );
        assert.equal(pendingCount.rows[0].count, 1);

        await pool.query(
            `UPDATE transactions
             SET status = 'TIMEOUT', dispatch_state = 'UNCERTAIN', updated_at = NOW()
             WHERE payment_id = $1
             AND id = (
                 SELECT id FROM transactions
                 WHERE payment_id = $1
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1
             )`,
            [paymentId]
        );

        await assert.rejects(
            transactionService.createPaymentAttempt({
                merchantId,
                paymentId,
                accountReference: `ACC-TIMEOUT-NO-DISPOSITION-${suffix}`,
                phoneNumber: "254700001234",
                requestedAmount: 100,
                description: "Admission test",
                idempotencyKey: `admission-timeout-no-disposition-${suffix}`
            }),
            /timed-out|resolved|unresolved/i
        );

        const attemptToRecover = await pool.query(
            `SELECT id FROM transactions
             WHERE payment_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT 1`,
            [paymentId]
        );
        const disposition = await transactionService.createPaymentAttemptRecoveryDisposition({
            transactionId: attemptToRecover.rows[0].id,
            operatorUserId: user.rows[0].id,
            reason: "Operator reviewed provider evidence",
            supportingEvidence: "No CheckoutRequestID was returned and provider records were inconclusive"
        });
        assert.ok(disposition);

        const recoveredRetry = await transactionService.createPaymentAttempt({
            merchantId,
            paymentId,
            accountReference: `ACC-TIMEOUT-RECOVERED-${suffix}`,
            phoneNumber: "254700001234",
            requestedAmount: 100,
            description: "Admission test",
            idempotencyKey: `admission-timeout-recovered-${suffix}`
        });
        assert.ok(recoveredRetry);
        assert.equal(recoveredRetry.paymentId, paymentId);

        const finalPendingCount = await pool.query(
            `SELECT COUNT(*)::integer AS count
             FROM transactions
             WHERE payment_id = $1 AND status = 'PENDING'`,
            [paymentId]
        );
        assert.equal(finalPendingCount.rows[0].count, 1);

        const paymentLinkService = await import("../src/services/payment-link.service.js");
        const concurrentLink = await paymentLinkService.createPaymentLink(merchantId, {
            description: "Concurrent link admission",
            amount: 100,
            useMode: "SINGLE_USE"
        });
        const linkRequestId = (await pool.query(
            "SELECT payment_id FROM payment_links WHERE id = $1",
            [concurrentLink.id]
        )).rows[0].payment_id;
        const linkAttempts = await Promise.allSettled([
            transactionService.createPaymentAttempt({
                merchantId,
                paymentId: linkRequestId,
                accountReference: `ACC-LINK-A-${suffix}`,
                phoneNumber: "254700001234",
                requestedAmount: 100,
                description: "Concurrent link admission",
                paymentLinkId: concurrentLink.id,
                idempotencyKey: `admission-link-a-${suffix}`
            }),
            transactionService.createPaymentAttempt({
                merchantId,
                paymentId: linkRequestId,
                accountReference: `ACC-LINK-B-${suffix}`,
                phoneNumber: "254700001234",
                requestedAmount: 100,
                description: "Concurrent link admission",
                paymentLinkId: concurrentLink.id,
                idempotencyKey: `admission-link-b-${suffix}`
            })
        ]);
        assert.equal(linkAttempts.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(linkAttempts.filter((result) => result.status === "rejected").length, 1);
        const linkPendingCount = await pool.query(
            `SELECT COUNT(*)::integer AS count
             FROM transactions
             WHERE payment_id = $1 AND status = 'PENDING'`,
            [linkRequestId]
        );
        assert.equal(linkPendingCount.rows[0].count, 1);
    } finally {
        if (merchantId) {
            await pool.query("DELETE FROM payment_attempt_recovery_dispositions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM payment_idempotency_operations WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM audit_logs WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM payment_links WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        }
        await pool.query("DELETE FROM users WHERE email = $1", [email]).catch(() => {});
        await closeDatabase();
    }
});
