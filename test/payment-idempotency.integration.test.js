import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import axios from "axios";
import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "payment-idempotency-integration-secret-at-least-32";
process.env.MPESA_CALLBACK_URL = "https://sandbox-callback.example.test/api/mpesa/callback";
process.env.MPESA_SHORTCODE = "174379";
process.env.MPESA_PASSKEY = "test-passkey";
process.env.API_RATE_LIMIT = "1000";
process.env.PAYMENT_RATE_LIMIT = "1000";
process.env.PUBLIC_PAYMENT_RATE_LIMIT = "1000";
delete process.env.RATE_LIMIT_REDIS_URL;

test("payment initiation and retries are idempotent across legacy and versioned routes", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const auth = await import("../src/services/auth.service.js");
    const { default: app } = await import("../src/app.js");

    const email = `payment-idempotency-${randomUUID()}@example.test`;
    const originalAdapter = axios.defaults.adapter;
    const originalConsoleInfo = console.info;
    const originalGraceStart = process.env.PAYMENT_IDEMPOTENCY_LEGACY_GRACE_START;
    let server;
    let merchantId;
    let stkRequestCount = 0;
    let legacyWarningCount = 0;

    axios.defaults.adapter = async (config) => {
        if (config.url.includes("oauth")) {
            return {
                data: { access_token: "integration-test-access-token" },
                status: 200,
                statusText: "OK",
                headers: {},
                config
            };
        }

        if (config.url.includes("processrequest")) {
            stkRequestCount += 1;
            return {
                data: {
                    ResponseCode: "0",
                    ResponseDescription: "Accepted",
                    MerchantRequestID: `merchant-${randomUUID()}`,
                    CheckoutRequestID: `checkout-${randomUUID()}`
                },
                status: 200,
                statusText: "OK",
                headers: {},
                config
            };
        }

        throw new Error(`Unexpected Daraja request: ${config.url}`);
    };
    console.info = (...args) => {
        if (args[0] === "Legacy keyless payment request observed") {
            legacyWarningCount += 1;
            return;
        }
        originalConsoleInfo(...args);
    };

    try {
        const registered = await auth.registerUser({
            name: "Idempotency Merchant",
            businessName: "Idempotency Shop",
            email,
            password: "IdempotencyPassword!123",
            phoneNumber: "254700001234"
        });
        await auth.verifyEmail(registered.verificationToken);
        merchantId = (await pool.query(
            "SELECT id FROM merchants WHERE user_id = $1",
            [registered.user.id]
        )).rows[0].id;
        const session = await auth.authenticateUser({ email, password: "IdempotencyPassword!123" });
        assert.equal(session.authenticated, true);

        server = app.listen(0);
        await new Promise((resolve) => server.once("listening", resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const headers = {
            authorization: `Bearer ${session.accessToken}`,
            "content-type": "application/json"
        };
        const sendPayment = (path, body, key) => fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: {
                ...headers,
                ...(key ? { "Idempotency-Key": key } : {})
            },
            body: JSON.stringify(body)
        });

        let response = await fetch(`${baseUrl}/api/v1/payment-links`, {
            method: "POST",
            headers,
            body: JSON.stringify({ description: "Idempotency link", amount: 125 })
        });
        assert.equal(response.status, 201);
        const link = (await response.json()).paymentLink;

        const paymentsBeforeMissingKey = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM payments WHERE merchant_id = $1",
            [merchantId]
        );
        response = await sendPayment("/api/v1/payments", {
            amount: 125,
            phoneNumber: "254700001234"
        });
        assert.equal(response.status, 400);
        assert.equal(stkRequestCount, 0);
        response = await sendPayment(
            `/api/v1/public/payment-links/${link.reference}/pay`,
            { phoneNumber: "254700001234" }
        );
        assert.equal(response.status, 400);
        assert.equal(stkRequestCount, 0);
        const paymentsAfterMissingKey = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM payments WHERE merchant_id = $1",
            [merchantId]
        );
        assert.equal(paymentsAfterMissingKey.rows[0].count, paymentsBeforeMissingKey.rows[0].count);

        process.env.PAYMENT_IDEMPOTENCY_LEGACY_GRACE_START = new Date(
            Date.now() - 30 * 24 * 60 * 60 * 1000
        ).toISOString().slice(0, 10);
        response = await sendPayment("/api/payments", {
            amount: 125,
            phoneNumber: "254700001234"
        });
        assert.equal(response.status, 202);
        const legacyPayment = await response.json();
        assert.equal(legacyWarningCount, 1);
        assert.equal(stkRequestCount, 1);

        process.env.PAYMENT_IDEMPOTENCY_LEGACY_GRACE_START = new Date(
            Date.now() - 91 * 24 * 60 * 60 * 1000
        ).toISOString().slice(0, 10);
        response = await sendPayment("/api/payments", {
            amount: 125,
            phoneNumber: "254700001234"
        });
        assert.equal(response.status, 400);
        assert.equal(legacyWarningCount, 2);
        assert.equal(stkRequestCount, 1);
        delete process.env.PAYMENT_IDEMPOTENCY_LEGACY_GRACE_START;

        const initialKey = `initial-${randomUUID()}`;
        const initialBody = {
            amount: 420,
            phoneNumber: "254711112222",
            description: "Idempotency test"
        };
        const initialResponses = await Promise.all([
            sendPayment("/api/v1/payments", initialBody, initialKey),
            sendPayment("/api/v1/payments", initialBody, initialKey)
        ]);
        assert.deepEqual(initialResponses.map((item) => item.status).sort(), [200, 202]);
        const initialBodies = await Promise.all(initialResponses.map((item) => item.json()));
        const originalPayment = initialBodies.find((item) => item.status === "PENDING");
        const replayedPayment = initialBodies.find((item) => item.reused);
        assert.ok(originalPayment?.paymentId);
        assert.equal(replayedPayment?.paymentId, originalPayment.paymentId);
        assert.equal(stkRequestCount, 2);

        await pool.query(
            `UPDATE payment_idempotency_operations SET request_hash = NULL
             WHERE merchant_id = $1 AND idempotency_key = $2`,
            [merchantId, initialKey]
        );
        response = await sendPayment("/api/v1/payments", initialBody, initialKey);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).reused, true);
        const restoredLegacyHash = await pool.query(
            `SELECT request_hash FROM payment_idempotency_operations
             WHERE merchant_id = $1 AND idempotency_key = $2`,
            [merchantId, initialKey]
        );
        assert.ok(restoredLegacyHash.rows[0].request_hash);
        assert.equal(stkRequestCount, 2);

        response = await sendPayment("/api/v1/payments", {
            ...initialBody,
            amount: 421
        }, initialKey);
        assert.equal(response.status, 409);
        assert.equal(stkRequestCount, 2);
        response = await sendPayment("/api/v1/payments", {
            ...initialBody,
            phoneNumber: "254722223333"
        }, initialKey);
        assert.equal(response.status, 409);
        assert.equal(stkRequestCount, 2);

        response = await sendPayment(`/api/v1/payments/${originalPayment.paymentId}/retry`, {}, initialKey);
        assert.equal(response.status, 409);
        assert.match((await response.json()).message, /Idempotency key/);
        response = await sendPayment(`/api/v1/payments/${originalPayment.paymentId}/retry`, {});
        assert.equal(response.status, 400);
        assert.equal(stkRequestCount, 2);

        await pool.query(
            `UPDATE payments SET status = 'FAILED' WHERE id = $1 AND merchant_id = $2`,
            [originalPayment.paymentId, merchantId]
        );
        await pool.query(
            `UPDATE transactions SET status = 'FAILED'
             WHERE payment_id = $1 AND merchant_id = $2`,
            [originalPayment.paymentId, merchantId]
        );

        const retryKey = `retry-${randomUUID()}`;
        const retryPath = `/api/v1/payments/${originalPayment.paymentId}/retry`;
        const retryResponses = await Promise.all([
            sendPayment(retryPath, {}, retryKey),
            sendPayment(retryPath, {}, retryKey)
        ]);
        assert.deepEqual(retryResponses.map((item) => item.status).sort(), [200, 202]);
        const retryBodies = await Promise.all(retryResponses.map((item) => item.json()));
        assert.equal(
            retryBodies.find((item) => item.status === "PENDING")?.paymentId,
            originalPayment.paymentId
        );
        assert.equal(retryBodies.filter((item) => item.reused).length, 1);
        assert.equal(stkRequestCount, 3);

        response = await sendPayment(
            `/api/v1/payments/${legacyPayment.paymentId}/retry`,
            {},
            retryKey
        );
        assert.equal(response.status, 409);
        assert.match((await response.json()).message, /Idempotency key/);
        assert.equal(stkRequestCount, 3);

        await pool.query(
            `UPDATE payments SET status = 'TIMEOUT' WHERE id = $1 AND merchant_id = $2`,
            [originalPayment.paymentId, merchantId]
        );
        await pool.query(
            `UPDATE transactions SET status = 'TIMEOUT'
             WHERE payment_id = $1 AND merchant_id = $2
               AND id = (
                   SELECT id FROM transactions
                   WHERE payment_id = $1 AND merchant_id = $2
                   ORDER BY created_at DESC LIMIT 1
               )`,
            [originalPayment.paymentId, merchantId]
        );
        response = await sendPayment(
            `/api/v1/payments/${originalPayment.paymentId}/retry`,
            {},
            `after-timeout-${randomUUID()}`
        );
        assert.equal(response.status, 409);
        assert.match((await response.json()).message, /timed-out payment attempt must be resolved/);
        assert.equal(stkRequestCount, 3);

        const attemptCount = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM transactions WHERE payment_id = $1",
            [originalPayment.paymentId]
        );
        assert.equal(attemptCount.rows[0].count, 2);

        const operations = await pool.query(
            `SELECT operation_type, COUNT(*)::integer AS count
             FROM payment_idempotency_operations
             WHERE merchant_id = $1
             GROUP BY operation_type`,
            [merchantId]
        );
        assert.deepEqual(
            Object.fromEntries(operations.rows.map((row) => [row.operation_type, row.count])),
            { INITIAL: 1, RETRY: 1 }
        );

        assert.ok(legacyPayment.paymentId);
    } finally {
        axios.defaults.adapter = originalAdapter;
        console.info = originalConsoleInfo;
        if (originalGraceStart === undefined) {
            delete process.env.PAYMENT_IDEMPOTENCY_LEGACY_GRACE_START;
        } else {
            process.env.PAYMENT_IDEMPOTENCY_LEGACY_GRACE_START = originalGraceStart;
        }
        if (server) {
            if (typeof server.closeAllConnections === "function") {
                server.closeAllConnections();
            }
            await new Promise((resolve) => server.close(resolve));
        }
        if (merchantId) {
            await pool.query(
                "DELETE FROM payment_idempotency_operations WHERE merchant_id = $1",
                [merchantId]
            );
            await pool.query("DELETE FROM payment_links WHERE merchant_id = $1", [merchantId]);
            await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]);
            await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]);
            await pool.query("DELETE FROM audit_logs WHERE merchant_id = $1", [merchantId]);
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]);
        }
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
        await closeDatabase();
    }
});
