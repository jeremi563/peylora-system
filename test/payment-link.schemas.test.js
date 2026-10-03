import assert from "node:assert/strict";
import test from "node:test";

import {
    createPaymentLinkSchema,
    payPaymentLinkSchema,
    paymentLinkReferenceSchema
} from "../src/validators/payment-link.schemas.js";

test("payment links require a positive bounded amount and description", () => {
    assert.equal(createPaymentLinkSchema.safeParse({ description: "Invoice 105", amount: 500 }).success, true);
    assert.equal(createPaymentLinkSchema.safeParse({ description: "", amount: 500 }).success, false);
    assert.equal(createPaymentLinkSchema.safeParse({ description: "Invoice", amount: 0 }).success, false);
    assert.equal(createPaymentLinkSchema.safeParse({ description: "Invoice", amount: 250_001 }).success, false);
    assert.equal(createPaymentLinkSchema.safeParse({
        description: "Invoice",
        amount: 500,
        expiresAt: "not-a-date"
    }).success, false);
});

test("public references and customer phone numbers are validated", () => {
    assert.equal(paymentLinkReferenceSchema.safeParse("aB_9-123456789012345678901").success, true);
    assert.equal(paymentLinkReferenceSchema.safeParse("short").success, false);
    assert.equal(payPaymentLinkSchema.safeParse({ phoneNumber: "254700000001" }).success, true);
    assert.equal(payPaymentLinkSchema.safeParse({ phoneNumber: "0700000001" }).success, false);
});