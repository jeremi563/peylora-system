import assert from "node:assert/strict";
import test from "node:test";

import {
    createPaymentSchema,
    paymentIdSchema,
    paymentListSchema
} from "../src/validators/payment.schemas.js";

test("payment creation validates amount, phone, and description", () => {
    assert.equal(createPaymentSchema.safeParse({
        amount: 120,
        phoneNumber: "254700000001",
        description: "Invoice 102"
    }).success, true);
    assert.equal(createPaymentSchema.safeParse({ amount: 0, phoneNumber: "254700000001" }).success, false);
    assert.equal(createPaymentSchema.safeParse({ amount: 1, phoneNumber: "0700000001" }).success, false);
    assert.equal(createPaymentSchema.safeParse({
        amount: 1,
        phoneNumber: "254700000001",
        description: "x".repeat(501)
    }).success, false);
});

test("payment list query applies defaults and rejects invalid filters", () => {
    assert.deepEqual(paymentListSchema.parse({}), { page: 1, limit: 25 });
    assert.deepEqual(paymentListSchema.parse({ status: "SUCCESS", page: "2", limit: "50" }), {
        status: "SUCCESS",
        page: 2,
        limit: 50
    });
    assert.equal(paymentListSchema.safeParse({ status: "UNKNOWN" }).success, false);
    assert.equal(paymentListSchema.safeParse({ limit: "101" }).success, false);
});

test("payment identifiers must be UUIDs", () => {
    assert.equal(paymentIdSchema.safeParse("0ea8d1ee-9d81-4e9f-89f1-5e77a49370c5").success, true);
    assert.equal(paymentIdSchema.safeParse("not-a-uuid").success, false);
});