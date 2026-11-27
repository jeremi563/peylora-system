import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "phase-reconciliation-test-secret-at-least-32";

test("reconciliation evidence is append-only and merchant-scoped", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const email = `reconciliation-${suffix}@example.test`;
    let merchantId;
    let paymentId;
    let attemptId;

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
            [paymentId, merchantId, `ACC-RECON-${suffix}`, `254700${suffix.replace(/-/g, "").slice(0, 6)}`, `CHECKOUT-${suffix}`]
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
        await pool.query("DELETE FROM reconciliation_events WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM users WHERE email = $1", [email]).catch(() => {});
        await closeDatabase();
    }
});
