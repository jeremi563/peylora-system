import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import axios from "axios";
import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "phase-thirteen-e2e-test-secret-at-least-32-characters";
process.env.MPESA_CALLBACK_URL = "https://sandbox-callback.example.test/api/mpesa/callback";
process.env.MPESA_SHORTCODE = "174379";
process.env.MPESA_PASSKEY = "test-passkey";
process.env.API_RATE_LIMIT = "1000";
process.env.PAYMENT_RATE_LIMIT = "1000";
process.env.PUBLIC_PAYMENT_RATE_LIMIT = "1000";
delete process.env.RATE_LIMIT_REDIS_URL;

test("merchant payment flows through link, Daraja callback, webhook, notification, and analytics", async (context) => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const auth = await import("../src/services/auth.service.js");
    const webhook = await import("../src/services/webhook.service.js");
    const transaction = await import("../src/services/transaction.service.js");
    const analytics = await import("../src/services/analytics.service.js");
    const { default: app } = await import("../src/app.js");

    const email = `payment-e2e-${randomUUID()}@example.test`;
    let server;
    let merchantId;
    let paymentId;
    let transactionId;
    let paymentLinkId;
    let checkoutRequestId;
    let eventKey;
    const originalAdapter = axios.defaults.adapter;
    let stkRequestCount = 0;
    let requestedStkPayload;

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
            requestedStkPayload = JSON.parse(config.data);
            checkoutRequestId = `checkout-${randomUUID()}`;
            return {
                data: {
                    ResponseCode: "0",
                    ResponseDescription: "Accepted",
                    MerchantRequestID: `merchant-${randomUUID()}`,
                    CheckoutRequestID: checkoutRequestId
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
        const registered = await auth.registerUser({
            name: "Integration Merchant",
            businessName: "Integration Shop",
            email,
            password: "IntegrationPassword!123",
            phoneNumber: "254700001234"
        });
        await auth.verifyEmail(registered.verificationToken);
        merchantId = (await pool.query(
            "SELECT id FROM merchants WHERE user_id = $1",
            [registered.user.id]
        )).rows[0].id;
        const session = await auth.authenticateUser({ email, password: "IntegrationPassword!123" });
        assert.equal(session.authenticated, true);

        server = app.listen(0);
        await new Promise((resolve) => server.once("listening", resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;

        let response = await fetch(`${baseUrl}/api/payment-links`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${session.accessToken}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ description: "Integration order", amount: 245 })
        });
        assert.equal(response.status, 201);
        const link = (await response.json()).paymentLink;
        paymentLinkId = link.id;

        response = await fetch(`${baseUrl}/api/public/payment-links/${link.reference}/pay`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "Idempotency-Key": "integration-order-1"
            },
            body: JSON.stringify({ phoneNumber: "254700001234", amount: 1 })
        });
        assert.equal(response.status, 202);
        const initiated = await response.json();
        paymentId = initiated.paymentId;
        transactionId = initiated.transactionId;
        assert.equal(initiated.status, "PENDING");
        assert.equal(requestedStkPayload.Amount, 245);
        assert.equal(stkRequestCount, 1);

        response = await fetch(`${baseUrl}/api/public/payment-links/${link.reference}/pay`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "Idempotency-Key": "integration-order-1"
            },
            body: JSON.stringify({ phoneNumber: "254700001234", amount: 999 })
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).reused, true);
        assert.equal(stkRequestCount, 1);

        const callbackBody = {
            Body: {
                stkCallback: {
                    CheckoutRequestID: checkoutRequestId,
                    ResultCode: 0,
                    ResultDesc: "The service request is processed successfully.",
                    CallbackMetadata: {
                        Item: [
                            { Name: "Amount", Value: 245 },
                            { Name: "MpesaReceiptNumber", Value: "E2ERECEIPT" },
                            { Name: "PhoneNumber", Value: 254700001234 }
                        ]
                    }
                }
            }
        };
        response = await fetch(`${baseUrl}/api/mpesa/callback`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(callbackBody)
        });
        assert.equal(response.status, 200);
        eventKey = `mpesa:${checkoutRequestId}`;

        const queued = await pool.query(
            "SELECT id, status, payload FROM webhook_events WHERE event_key = $1",
            [eventKey]
        );
        assert.equal(queued.rowCount, 1);
        assert.equal(queued.rows[0].status, "RECEIVED");
        assert.deepEqual(queued.rows[0].payload.rawPayload, callbackBody);

        const claimedEvents = await webhook.claimWebhookEvents(10, 300);
        const claimed = claimedEvents.find((event) => event.id === queued.rows[0].id);
        assert.ok(claimed);
        const processed = await transaction.applyMpesaCallback(
            claimed.payload.callback,
            claimed.payload.metadata
        );
        assert.equal(processed.status, "SUCCESS");

        const finalState = await pool.query(
            `SELECT p.status AS payment_status, p.amount, t.status AS transaction_status,
                    t.paid_amount, t.mpesa_receipt_number, pl.status AS link_status
             FROM payments p
             JOIN transactions t ON t.payment_id = p.id
             JOIN payment_links pl ON pl.id = p.payment_link_id
             WHERE p.id = $1`,
            [paymentId]
        );
        assert.equal(finalState.rows[0].payment_status, "SUCCESS");
        assert.equal(finalState.rows[0].transaction_status, "SUCCESS");
        assert.equal(Number(finalState.rows[0].amount), 245);
        assert.equal(Number(finalState.rows[0].paid_amount), 245);
        assert.equal(finalState.rows[0].mpesa_receipt_number, "E2ERECEIPT");
        assert.equal(finalState.rows[0].link_status, "ACTIVE");

        const notificationCount = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM notifications WHERE event_key = $1",
            [eventKey]
        );
        assert.equal(notificationCount.rows[0].count, 2);
        const auditActions = await pool.query(
            "SELECT action FROM audit_logs WHERE event_key = ANY($1::text[]) ORDER BY action",
            [[eventKey, `payment-created:${paymentId}`]]
        );
        assert.deepEqual(auditActions.rows.map((row) => row.action), ["PAYMENT_CREATED", "PAYMENT_SUCCESS"]);

        await webhook.markWebhookProcessed(claimed.id);
        response = await fetch(`${baseUrl}/api/payments/${paymentId}`, {
            headers: { authorization: `Bearer ${session.accessToken}` }
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).payment.status, "SUCCESS");

        const dashboard = await analytics.getMerchantDashboard(merchantId, {
            from: new Date().toISOString().slice(0, 10),
            to: new Date().toISOString().slice(0, 10),
            interval: "day"
        });
        assert.equal(dashboard.summary.revenue, 245);
        assert.equal(dashboard.summary.successfulPayments, 1);
        assert.equal(dashboard.summary.transactionVolume, 1);

        const duplicate = await webhook.enqueueMpesaCallback(
            callbackBody.Body.stkCallback,
            { Amount: 245, MpesaReceiptNumber: "E2ERECEIPT" },
            callbackBody
        );
        assert.equal(duplicate.duplicate, true);
        assert.equal(duplicate.eventId, queued.rows[0].id);
        const afterDuplicate = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM notifications WHERE event_key = $1",
            [eventKey]
        );
        assert.equal(afterDuplicate.rows[0].count, 2);
    } finally {
        axios.defaults.adapter = originalAdapter;
        if (server) await new Promise((resolve) => server.close(resolve));
        if (eventKey) {
            await pool.query("DELETE FROM notifications WHERE event_key = $1", [eventKey]);
            await pool.query("DELETE FROM audit_logs WHERE event_key = $1", [eventKey]);
            await pool.query("DELETE FROM webhook_events WHERE event_key = $1", [eventKey]);
        }
        if (paymentId) {
            await pool.query("DELETE FROM audit_logs WHERE event_key = $1", [`payment-created:${paymentId}`]);
            await pool.query("DELETE FROM transactions WHERE payment_id = $1", [paymentId]);
            await pool.query("DELETE FROM payments WHERE id = $1", [paymentId]);
        }
        if (paymentLinkId) await pool.query("DELETE FROM payment_links WHERE id = $1", [paymentLinkId]);
        if (merchantId) await pool.query("DELETE FROM customers WHERE merchant_id = $1", [merchantId]);
        if (merchantId) await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]);
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
        await closeDatabase();
    }
});