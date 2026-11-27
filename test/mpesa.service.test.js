import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";

import {
    buildStkPayload,
    callbackMatchesDarajaStatus,
    compareCallbackWithDarajaStatus,
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
    assert.equal(determineCallbackOutcome(1, {}, 25).status, "UNVERIFIED");
    assert.equal(determineCallbackOutcome(1, {}, 25).unverifiedReason, "UNRECOGNIZED_DARAJA_RESULT_CODE");
    assert.equal(determineCallbackOutcome(0, {}, 25).status, "UNVERIFIED");
    assert.equal(determineCallbackOutcome(0, {}, 25).unverifiedReason, "SUCCESS_CALLBACK_MISSING_VALID_AMOUNT");
});

test("callback outcomes must match Daraja status-query results", () => {
    assert.equal(callbackMatchesDarajaStatus(
        { ResultCode: 0 },
        { ResultCode: 0 }
    ), true);
    assert.equal(callbackMatchesDarajaStatus(
        { ResultCode: 1032 },
        { ResultCode: 1032 }
    ), true);
    assert.equal(callbackMatchesDarajaStatus(
        { ResultCode: 0 },
        { ResultCode: 1032 }
    ), false);
    assert.equal(callbackMatchesDarajaStatus(
        { ResultCode: 0 },
        { ResponseCode: "0" }
    ), false);
});

test("callback verification compares provider identifiers and authoritative metadata", () => {
    const callback = {
        CheckoutRequestID: "checkout-1",
        MerchantRequestID: "merchant-1",
        ResultCode: 0
    };
    const metadata = { Amount: 25, MpesaReceiptNumber: "ABC123" };
    const transaction = {
        checkout_request_id: "checkout-1",
        merchant_request_id: "merchant-1"
    };
    const statusResponse = {
        ResponseCode: "0",
        CheckoutRequestID: "checkout-1",
        MerchantRequestID: "merchant-1",
        ResultCode: 0,
        CallbackMetadata: {
            Item: [
                { Name: "Amount", Value: 25 },
                { Name: "MpesaReceiptNumber", Value: "ABC123" }
            ]
        }
    };

    assert.deepEqual(
        compareCallbackWithDarajaStatus(callback, metadata, transaction, statusResponse),
        {
            agreement: "MATCH",
            callbackResultCode: 0,
            statusResultCode: 0,
            conflictFields: [],
            unverifiedFields: ["phoneNumber", "transactionDate"]
        }
    );
    const mismatch = compareCallbackWithDarajaStatus(
        callback,
        { ...metadata, Amount: 26 },
        transaction,
        statusResponse
    );
    assert.equal(mismatch.agreement, "MISMATCH");
    assert.deepEqual(mismatch.conflictFields, ["amount"]);
    const associationMismatch = compareCallbackWithDarajaStatus(
        callback,
        metadata,
        transaction,
        { ...statusResponse, CheckoutRequestID: "different-checkout" }
    );
    assert.equal(associationMismatch.agreement, "MISMATCH");
    assert.deepEqual(associationMismatch.conflictFields, ["checkoutRequestId"]);
});

test("unrecognized Daraja result codes remain unverified", () => {
    const result = compareCallbackWithDarajaStatus(
        { CheckoutRequestID: "checkout-1", ResultCode: 1 },
        {},
        { checkout_request_id: "checkout-1" },
        { ResponseCode: "0", CheckoutRequestID: "checkout-1", ResultCode: 1 }
    );
    assert.equal(result.agreement, "UNVERIFIED");
    assert.ok(result.unverifiedFields.includes("terminalResultCode"));
});