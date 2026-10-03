import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";

import {
    buildStkPayload,
    extractCallbackMetadata,
    generateStkPassword,
    generateTimestamp,
    getAccessToken,
    sendStkPush
} from "../src/services/mpesa.service.js";
import { determineCallbackOutcome } from "../src/services/transaction.service.js";

test("timestamp and STK password use Daraja's expected formats", () => {
    const timestamp = generateTimestamp();
    assert.match(timestamp, /^\d{14}$/);
    assert.equal(
        generateStkPassword("174379", "test-passkey", "20261002123456"),
        Buffer.from("174379test-passkey20261002123456").toString("base64")
    );
});

test("STK payload includes the payment request fields", () => {
    const payload = buildStkPayload({
        shortCode: "174379",
        password: "encoded-password",
        timestamp: "20261002123456",
        amount: 25,
        phoneNumber: "254700000001",
        callbackUrl: "https://example.test/api/mpesa/callback",
        accountReference: "REFERENCE01",
        transactionDesc: "Test payment"
    });

    assert.equal(payload.Amount, 25);
    assert.equal(payload.PartyA, "254700000001");
    assert.equal(payload.CallBackURL, "https://example.test/api/mpesa/callback");
    assert.equal(payload.AccountReference, "REFERENCE01");
});

test("OAuth and STK requests remain pinned to sandbox and reject redirects", async () => {
    const originalAdapter = axios.defaults.adapter;
    const originalKey = process.env.MPESA_CONSUMER_KEY;
    const originalSecret = process.env.MPESA_CONSUMER_SECRET;
    process.env.MPESA_CONSUMER_KEY = "test-key";
    process.env.MPESA_CONSUMER_SECRET = "test-secret";
    const requests = [];

    axios.defaults.adapter = async (config) => {
        requests.push(config);
        return {
            data: config.method === "get" ? { access_token: "sandbox-token" } : { ResponseCode: "0" },
            status: 200,
            statusText: "OK",
            headers: {},
            config
        };
    };

    try {
        const token = await getAccessToken();
        await sendStkPush({}, token);

        assert.equal(requests.length, 2);
        for (const request of requests) {
            assert.equal(new URL(request.url).origin, "https://sandbox.safaricom.co.ke");
            assert.equal(request.maxRedirects, 0);
            assert.ok(request.timeout > 0);
        }
    } finally {
        axios.defaults.adapter = originalAdapter;
        if (originalKey === undefined) delete process.env.MPESA_CONSUMER_KEY;
        else process.env.MPESA_CONSUMER_KEY = originalKey;
        if (originalSecret === undefined) delete process.env.MPESA_CONSUMER_SECRET;
        else process.env.MPESA_CONSUMER_SECRET = originalSecret;
    }
});

test("metadata extraction and payment outcome use callback amount", () => {
    const metadata = extractCallbackMetadata({
        Item: [
            { Name: "Amount", Value: 27 },
            { Name: "MpesaReceiptNumber", Value: "QRS123" }
        ]
    });

    assert.deepEqual(metadata, { Amount: 27, MpesaReceiptNumber: "QRS123" });
    assert.deepEqual(determineCallbackOutcome(0, metadata, 25), {
        status: "SUCCESS",
        paidAmount: 27,
        amountMatches: false
    });
    assert.equal(determineCallbackOutcome(1032, {}, 25).status, "CANCELLED");
    assert.equal(determineCallbackOutcome(1, {}, 25).status, "FAILED");
    assert.equal(determineCallbackOutcome(0, {}, 25).status, "FAILED");
});