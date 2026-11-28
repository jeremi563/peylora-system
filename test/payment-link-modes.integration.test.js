import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import axios from "axios";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "payment-link-modes-test-secret-at-least-32";
process.env.MPESA_CALLBACK_URL = "https://sandbox-callback.example.test/api/mpesa/callback";
process.env.MPESA_CONSUMER_KEY = "test-key";
process.env.MPESA_CONSUMER_SECRET = "test-secret";
process.env.MPESA_SHORTCODE = "174379";
process.env.MPESA_PASSKEY = "test-passkey";
process.env.API_RATE_LIMIT = "1000";
process.env.PAYMENT_RATE_LIMIT = "1000";
process.env.PUBLIC_PAYMENT_RATE_LIMIT = "1000";
delete process.env.RATE_LIMIT_REDIS_URL;

test("Payment Links bind to stable requests and consume only single-use links after confirmed success", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const auth = await import("../src/services/auth.service.js");
    const { default: app } = await import("../src/app.js");
    const transactionService = await import("../src/services/transaction.service.js");
    const suffix = randomUUID();
    const email = `payment-link-modes-${suffix}@example.test`;
    const originalAdapter = axios.defaults.adapter;
    let server;
    let merchantId;
    let singleUseLinkId;
    let reusableLinkId;

    const statusResponses = new Map();
    axios.defaults.adapter = async (config) => {
        if (config.url.includes("oauth")) {
            return {
                data: { access_token: "payment-link-test-token" },
                status: 200,
                statusText: "OK",
                headers: {},
                config
            };
        }
        if (config.url.includes("processrequest")) {
            const checkoutRequestId = `CHECKOUT-${randomUUID()}`;
            const merchantRequestId = `MERCHANT-${randomUUID()}`;
            statusResponses.set(checkoutRequestId, {
                ResponseCode: "0",
                CheckoutRequestID: checkoutRequestId,
                MerchantRequestID: merchantRequestId,
                ResultCode: 0,
                ResultDesc: "The service request is processed successfully"
            });
            return {
                data: {
                    ResponseCode: "0",
                    ResponseDescription: "Accepted",
                    MerchantRequestID: merchantRequestId,
                    CheckoutRequestID: checkoutRequestId
                },
                status: 200,
                statusText: "OK",
                headers: {},
                config
            };
        }
        if (config.url.includes("stkpushquery")) {
            const request = JSON.parse(config.data);
            const response = statusResponses.get(request.CheckoutRequestID);
            if (!response) throw new Error("Missing test status response");
            return {
                data: response,
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
            name: "Payment Link Merchant",
            businessName: "Payment Link Shop",
            email,
            password: "PaymentLinkPassword!123",
            phoneNumber: "254700001234"
        });
        await auth.verifyEmail(registered.verificationToken);
        merchantId = (await pool.query(
            "SELECT id FROM merchants WHERE user_id = $1",
            [registered.user.id]
        )).rows[0].id;
        const session = await auth.authenticateUser({
            email,
            password: "PaymentLinkPassword!123"
        });

        server = app.listen(0);
        await new Promise((resolve) => server.once("listening", resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const headers = {
            authorization: `Bearer ${session.accessToken}`,
            "content-type": "application/json"
        };

        let response = await fetch(`${baseUrl}/api/payment-links`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                description: "Single-use link",
                amount: 100,
                useMode: "SINGLE_USE"
            })
        });
        assert.equal(response.status, 201);
        const singleUseLink = (await response.json()).paymentLink;
        singleUseLinkId = singleUseLink.id;
        assert.equal(singleUseLink.use_mode ?? singleUseLink.useMode, "SINGLE_USE");
        assert.ok(singleUseLink.payment_id ?? singleUseLink.paymentId);

        const singleUsePublicResponse = await fetch(
            `${baseUrl}/api/public/payment-links/${singleUseLink.reference}/pay`,
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "Idempotency-Key": `single-use-${suffix}`
                },
                body: JSON.stringify({ phoneNumber: "254700001234" })
            }
        );
        assert.equal(singleUsePublicResponse.status, 202);
        const singleUsePayment = await singleUsePublicResponse.json();

        const duplicatePrompt = await fetch(
            `${baseUrl}/api/public/payment-links/${singleUseLink.reference}/pay`,
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "Idempotency-Key": `single-use-duplicate-${suffix}`
                },
                body: JSON.stringify({ phoneNumber: "254700001234" })
            }
        );
        assert.equal(duplicatePrompt.status, 409);

        const attempt = await pool.query(
            "SELECT id, checkout_request_id, merchant_request_id FROM transactions WHERE id = $1",
            [singleUsePayment.transactionId]
        );
        const callback = {
            CheckoutRequestID: attempt.rows[0].checkout_request_id,
            MerchantRequestID: attempt.rows[0].merchant_request_id,
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully"
        };
        const callbackResult = await transactionService.applyMpesaCallback(
            callback,
            {
                Amount: 40,
                MpesaReceiptNumber: `PARTIAL-${suffix}`,
                PhoneNumber: "254700001234"
            },
            { rawPayload: { Body: { stkCallback: callback } } }
        );
        assert.equal(callbackResult.status, "SUCCESS");

        const consumedLink = await pool.query(
            "SELECT status, consumed_at, use_mode FROM payment_links WHERE id = $1",
            [singleUseLinkId]
        );
        assert.equal(consumedLink.rows[0].status, "INACTIVE");
        assert.equal(consumedLink.rows[0].use_mode, "SINGLE_USE");
        assert.ok(consumedLink.rows[0].consumed_at);

        const consumedPublicLink = await fetch(
            `${baseUrl}/api/public/payment-links/${singleUseLink.reference}`
        );
        assert.equal(consumedPublicLink.status, 404);

        response = await fetch(`${baseUrl}/api/payment-links`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                description: "Reusable link",
                amount: 100,
                useMode: "REUSABLE"
            })
        });
        assert.equal(response.status, 201);
        const reusableLink = (await response.json()).paymentLink;
        reusableLinkId = reusableLink.id;
        assert.equal(reusableLink.use_mode ?? reusableLink.useMode, "REUSABLE");

        const reusablePaymentResponse = await fetch(
            `${baseUrl}/api/public/payment-links/${reusableLink.reference}/pay`,
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "Idempotency-Key": `reusable-${suffix}`
                },
                body: JSON.stringify({ phoneNumber: "254700001234" })
            }
        );
        assert.equal(reusablePaymentResponse.status, 202);

        const reusablePublicInfo = await fetch(
            `${baseUrl}/api/public/payment-links/${reusableLink.reference}`
        );
        assert.equal(reusablePublicInfo.status, 200);
        const reusableInfoBody = await reusablePublicInfo.json();
        assert.equal(reusableInfoBody.paymentLink.useMode, "REUSABLE");
    } finally {
        axios.defaults.adapter = originalAdapter;
        if (server) {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
        if (merchantId) {
            await pool.query("DELETE FROM audit_logs WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM reconciliation_events WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM payment_links WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM provider_transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        }
        await pool.query("DELETE FROM users WHERE email = $1", [email]).catch(() => {});
        await closeDatabase();
    }
});
