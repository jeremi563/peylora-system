import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import axios from "axios";
import jwt from "jsonwebtoken";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "payment-dispatch-recovery-test-secret-at-least-32";
process.env.API_RATE_LIMIT = "1000";
process.env.PAYMENT_RATE_LIMIT = "1000";
process.env.PAYMENT_IDEMPOTENCY_LEGACY_GRACE_START = "2026-01-01";
process.env.MPESA_CALLBACK_URL = "https://sandbox-callback.example.test/api/mpesa/callback";
process.env.MPESA_CONSUMER_KEY = "recovery-test-key";
process.env.MPESA_CONSUMER_SECRET = "recovery-test-secret";
process.env.MPESA_SHORTCODE = "174379";
process.env.MPESA_PASSKEY = "recovery-test-passkey";
delete process.env.RATE_LIMIT_REDIS_URL;

function accessToken(userId, role = "ADMIN") {
    return jwt.sign(
        { role },
        process.env.AUTH_JWT_SECRET,
        {
            subject: userId,
            issuer: "daraja-payment-platform",
            audience: "daraja-api",
            expiresIn: "5m"
        }
    );
}

test("operator recovery is audited, idempotent, and consumed by at most one retry", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const merchantEmail = `dispatch-recovery-merchant-${suffix}@example.test`;
    const adminEmail = `dispatch-recovery-admin-${suffix}@example.test`;
    let merchantId;
    let merchantUserId;
    let adminUserId;
    let attemptId;
    let paymentId;
    let secondAttemptId;
    let server;

    try {
        merchantUserId = (await pool.query(
            `INSERT INTO users (name, email, password_hash, email_verified)
             VALUES ('Recovery Merchant', $1, 'test-password-hash', true)
             RETURNING id`,
            [merchantEmail]
        )).rows[0].id;
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Recovery Shop', $2)
             RETURNING id`,
            [merchantUserId, merchantEmail]
        )).rows[0].id;
        adminUserId = (await pool.query(
            `INSERT INTO users (name, email, password_hash, role, email_verified)
             VALUES ('Recovery Admin', $1, 'test-password-hash', 'ADMIN', true)
             RETURNING id`,
            [adminEmail]
        )).rows[0].id;
        paymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, reference, amount, phone_number, status)
             VALUES ($1, $2, 100, '254700001234', 'TIMEOUT')
             RETURNING id`,
            [merchantId, `PAY-RECOVERY-${suffix}`]
        )).rows[0].id;
        attemptId = (await pool.query(
            `INSERT INTO transactions (
                payment_id, merchant_id, account_reference, amount,
                currency, phone_number, provider, status, dispatch_state
             )
             VALUES ($1, $2, $3, 100, 'KES', '254700001234', 'MPESA', 'TIMEOUT', 'UNCERTAIN')
             RETURNING id`,
            [paymentId, merchantId, `ACC-RECOVERY-${suffix}`]
        )).rows[0].id;

        const { default: app } = await import("../src/app.js");
        server = app.listen(0);
        await new Promise((resolve) => server.once("listening", resolve));
        const url = `http://127.0.0.1:${server.address().port}/api/admin/payment-attempts/${attemptId}/recovery-dispositions`;
        const recoveryRequest = {
            reason: "Provider outcome cannot be queried",
            supportingEvidence: "Reviewed provider portal; no CheckoutRequestID was returned"
        };
        const submitRecovery = (userId, body = recoveryRequest) => fetch(url, {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken(userId)}`,
                "content-type": "application/json"
            },
            body: JSON.stringify(body)
        });

        const forbidden = await submitRecovery(merchantUserId);
        assert.equal(forbidden.status, 403);

        const firstResponse = await submitRecovery(adminUserId);
        assert.equal(firstResponse.status, 201);
        const firstBody = await firstResponse.json();
        const duplicateResponse = await submitRecovery(adminUserId);
        assert.equal(duplicateResponse.status, 201);
        const duplicateBody = await duplicateResponse.json();
        assert.equal(
            duplicateBody.recoveryDisposition.id,
            firstBody.recoveryDisposition.id
        );

        const conflict = await submitRecovery(adminUserId, {
            ...recoveryRequest,
            reason: "A different operator rationale"
        });
        assert.equal(conflict.status, 409);

        const audit = await pool.query(
            `SELECT user_id, action, entity_id, details
             FROM audit_logs
             WHERE action = 'PAYMENT_ATTEMPT_RETRY_AUTHORIZED'
               AND entity_id = $1`,
            [attemptId]
        );
        assert.equal(audit.rowCount, 1);
        assert.equal(audit.rows[0].user_id, adminUserId);
        assert.equal(audit.rows[0].details.recoveryDispositionId, firstBody.recoveryDisposition.id);

        const transactionService = await import("../src/services/transaction.service.js");
        const retryArgs = (key) => ({
            merchantId,
            paymentId,
            accountReference: `ACC-RETRY-${randomUUID()}`,
            phoneNumber: "254700001234",
            requestedAmount: 100,
            idempotencyKey: key
        });
        const retries = await Promise.allSettled([
            transactionService.createPaymentAttempt(retryArgs(`recovery-${randomUUID()}`)),
            transactionService.createPaymentAttempt(retryArgs(`recovery-${randomUUID()}`))
        ]);
        assert.equal(retries.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(retries.filter((result) => result.status === "rejected").length, 1);
        const successfulRetry = retries.find((result) => result.status === "fulfilled").value;
        secondAttemptId = successfulRetry._id;

        const retryState = await pool.query(
            `SELECT t.status, t.recovery_disposition_id, recovery.operator_user_id
             FROM transactions t
             JOIN payment_attempt_recovery_dispositions recovery
               ON recovery.id = t.recovery_disposition_id
             WHERE t.id = $1`,
            [secondAttemptId]
        );
        assert.equal(retryState.rowCount, 1);
        assert.equal(retryState.rows[0].status, "PENDING");
        assert.equal(retryState.rows[0].recovery_disposition_id, firstBody.recoveryDisposition.id);
        assert.equal(retryState.rows[0].operator_user_id, adminUserId);
        assert.equal(await pool.query(
            "SELECT COUNT(*)::integer AS count FROM transactions WHERE payment_id = $1",
            [paymentId]
        ).then((result) => result.rows[0].count), 2);

        const noCheckoutPaymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, reference, amount, phone_number, status)
             VALUES ($1, $2, 100, '254700001234', 'TIMEOUT')
             RETURNING id`,
            [merchantId, `PAY-UNAUTHORIZED-RETRY-${suffix}`]
        )).rows[0].id;
        const noCheckoutAttemptId = (await pool.query(
            `INSERT INTO transactions (
                payment_id, merchant_id, account_reference, amount,
                currency, phone_number, provider, status, dispatch_state, checkout_request_id
             )
             VALUES ($1, $2, $3, 100, 'KES', '254700001234', 'MPESA', 'TIMEOUT', 'ACKNOWLEDGED', $4)
             RETURNING id`,
            [noCheckoutPaymentId, merchantId, `ACC-ACKED-${suffix}`, `CHECKOUT-${suffix}`]
        )).rows[0].id;
        const queryableRecovery = await fetch(
            `http://127.0.0.1:${server.address().port}/api/admin/payment-attempts/${noCheckoutAttemptId}/recovery-dispositions`,
            {
                method: "POST",
                headers: {
                    authorization: `Bearer ${accessToken(adminUserId)}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify(recoveryRequest)
            }
        );
        assert.equal(queryableRecovery.status, 409);
    } finally {
        if (server) {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
        if (merchantId) {
            await pool.query("DELETE FROM payment_idempotency_operations WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query(
                "DELETE FROM audit_logs WHERE merchant_id = $1",
                [merchantId]
            ).catch(() => {});
            await pool.query(
                "DELETE FROM payment_attempt_recovery_dispositions WHERE merchant_id = $1",
                [merchantId]
            ).catch(() => {});
            await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        }
        await pool.query("DELETE FROM users WHERE email IN ($1, $2)", [merchantEmail, adminEmail]).catch(() => {});
        await closeDatabase();
    }
});

test("lost STK response remains uncertain and blocks a second prompt", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const email = `dispatch-lost-response-${suffix}@example.test`;
    const originalAdapter = axios.defaults.adapter;
    let merchantId;
    let userId;
    let server;
    let paymentId;
    let attemptId;
    let stkRequestCount = 0;

    axios.defaults.adapter = async (config) => {
        if (config.url.includes("oauth")) {
            return {
                data: { access_token: "dispatch-recovery-access-token" },
                status: 200,
                statusText: "OK",
                headers: {},
                config
            };
        }
        if (config.url.includes("processrequest")) {
            stkRequestCount += 1;
            throw new Error("Connection reset after request dispatch");
        }
        throw new Error(`Unexpected Daraja request: ${config.url}`);
    };

    try {
        userId = (await pool.query(
            `INSERT INTO users (name, email, password_hash, email_verified)
             VALUES ('Lost Response Merchant', $1, 'test-password-hash', true)
             RETURNING id`,
            [email]
        )).rows[0].id;
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Lost Response Shop', $2)
             RETURNING id`,
            [userId, email]
        )).rows[0].id;

        const { default: app } = await import("../src/app.js");
        server = app.listen(0);
        await new Promise((resolve) => server.once("listening", resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const headers = {
            authorization: `Bearer ${accessToken(userId, "MERCHANT")}`,
            "content-type": "application/json",
            "Idempotency-Key": `lost-response-${suffix}`
        };
        const response = await fetch(`${baseUrl}/api/v1/payments`, {
            method: "POST",
            headers,
            body: JSON.stringify({ amount: 100, phoneNumber: "254700001234" })
        });
        assert.equal(response.status, 500);
        const responseBody = await response.json();
        assert.equal(responseBody.status, "PENDING");
        attemptId = responseBody.transactionId;

        const persisted = await pool.query(
            `SELECT t.status, t.dispatch_state, p.id AS payment_id,
                    p.status AS payment_status
             FROM transactions t
             JOIN payments p ON p.id = t.payment_id
             WHERE t.id = $1 AND t.merchant_id = $2`,
            [attemptId, merchantId]
        );
        assert.equal(persisted.rows[0].status, "PENDING");
        assert.equal(persisted.rows[0].dispatch_state, "UNCERTAIN");
        assert.equal(persisted.rows[0].payment_status, "PENDING");
        paymentId = persisted.rows[0].payment_id;

        await pool.query("UPDATE transactions SET status = 'TIMEOUT' WHERE id = $1", [attemptId]);
        await pool.query("UPDATE payments SET status = 'TIMEOUT' WHERE id = $1", [paymentId]);
        const retry = await fetch(`${baseUrl}/api/v1/payments/${paymentId}/retry`, {
            method: "POST",
            headers: {
                ...headers,
                "Idempotency-Key": `retry-after-lost-response-${suffix}`
            },
            body: JSON.stringify({})
        });
        const retryBody = await retry.json();
        assert.equal(retry.status, 409, JSON.stringify(retryBody));
        assert.match(retryBody.message, /timed-out payment attempt must be resolved/);
        assert.equal(stkRequestCount, 1);
        assert.equal(await pool.query(
            "SELECT COUNT(*)::integer AS count FROM transactions WHERE payment_id = $1",
            [paymentId]
        ).then((result) => result.rows[0].count), 1);
    } finally {
        axios.defaults.adapter = originalAdapter;
        if (server) {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
        if (merchantId) {
            await pool.query("DELETE FROM payment_idempotency_operations WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM audit_logs WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        }
        if (userId) {
            await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
        }
        await closeDatabase();
    }
});
