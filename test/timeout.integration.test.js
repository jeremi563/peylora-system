import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import axios from "axios";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "phase-ten-timeout-test-secret-at-least-32";
process.env.MPESA_CONSUMER_KEY = "test-key";
process.env.MPESA_CONSUMER_SECRET = "test-secret";
process.env.MPESA_SHORTCODE = "174379";
process.env.MPESA_PASSKEY = "test-passkey";

test("pending attempts become TIMEOUT once and late callbacks remain eligible", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const email = `timeout-${suffix}@example.test`;
    let merchantId;
    let paymentId;
    let attemptId;
    const originalAdapter = axios.defaults.adapter;
    axios.defaults.adapter = async (config) => {
        if (config.url.includes("oauth")) {
            return {
                data: { access_token: "timeout-test-access-token" },
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
                    ResponseDescription: "The service request has been processed successfully",
                    MerchantRequestID: "timeout-test-merchant",
                    CheckoutRequestID: request.CheckoutRequestID,
                    ResultCode: 1032,
                    ResultDesc: "Request cancelled by user"
                },
                status: 200,
                statusText: "OK",
                headers: {},
                config
            };
        }
        throw new Error(`Unexpected Daraja request: ${config.url}`);
    };

    try {
        const user = await pool.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES ('Timeout Merchant', $1, 'test-password-hash')
             RETURNING id`,
            [email]
        );
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Timeout Shop', $2)
             RETURNING id`,
            [user.rows[0].id, email]
        )).rows[0].id;
        paymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, reference, amount, phone_number, status)
             VALUES ($1, $2, 100, $3, 'PENDING')
             RETURNING id`,
            [merchantId, `PAY-TIMEOUT-${suffix}`, `254700${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;
        attemptId = (await pool.query(
            `INSERT INTO transactions (
                payment_id, merchant_id, account_reference, amount,
                currency, phone_number, provider, status, dispatch_state, created_at
             )
             VALUES ($1, $2, $3, 100, 'KES', $4, 'MPESA', 'PENDING', 'ACKNOWLEDGED',
                     NOW() - INTERVAL '20 minutes')
             RETURNING id`,
            [paymentId, merchantId, `ACC-TIMEOUT-${suffix}`, `254700${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;

        const transactionService = await import("../src/services/transaction.service.js");
        const timedOut = await transactionService.markExpiredPendingAttempts({
            timeoutSeconds: 900,
            limit: 100
        });
        assert.ok(timedOut >= 1);

        const state = await pool.query(
            `SELECT t.status AS attempt_status, p.status AS payment_status
             FROM transactions t
             JOIN payments p ON p.id = t.payment_id
             WHERE t.id = $1`,
            [attemptId]
        );
        assert.equal(state.rows[0].attempt_status, "TIMEOUT");
        assert.equal(state.rows[0].payment_status, "TIMEOUT");

        const secondPass = await transactionService.markExpiredPendingAttempts({
            timeoutSeconds: 900,
            limit: 100
        });
        assert.equal(await pool.query(
            "SELECT COUNT(*)::integer AS count FROM transactions WHERE id = $1 AND status = 'TIMEOUT'",
            [attemptId]
        ).then((result) => result.rows[0].count), 1);
        assert.equal(typeof secondPass, "number");

        const callback = {
            CheckoutRequestID: `late-checkout-${suffix}`,
            ResultCode: 1032,
            ResultDesc: "Request cancelled by user"
        };
        await pool.query(
            `UPDATE transactions
             SET checkout_request_id = $2, updated_at = NOW()
             WHERE id = $1`,
            [attemptId, callback.CheckoutRequestID]
        );
        const result = await transactionService.applyMpesaCallback(callback, {});
        assert.equal(result.status, "CANCELLED");

        const finalState = await pool.query(
            "SELECT status FROM transactions WHERE id = $1",
            [attemptId]
        );
        assert.equal(finalState.rows[0].status, "CANCELLED");
    } finally {
        axios.defaults.adapter = originalAdapter;
        await pool.query(
            "DELETE FROM reconciliation_events WHERE transaction_id = $1",
            [attemptId]
        ).catch(() => {});
        await pool.query(
            "DELETE FROM webhook_events WHERE event_key LIKE $1",
            [`mpesa:late-checkout-${suffix}%`]
        ).catch(() => {});
        await pool.query(
            "DELETE FROM notifications WHERE user_id = (SELECT user_id FROM merchants WHERE id = $1)",
            [merchantId]
        ).catch(() => {});
        await pool.query("DELETE FROM audit_logs WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM provider_transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM users WHERE email = $1", [email]).catch(() => {});
        await closeDatabase();
    }
});
