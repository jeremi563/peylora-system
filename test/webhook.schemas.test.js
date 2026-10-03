import assert from "node:assert/strict";
import test from "node:test";

import {
    auditLogListSchema,
    webhookEventIdSchema,
    webhookListSchema
} from "../src/validators/webhook.schemas.js";

test("webhook event list validates status and pagination", () => {
    assert.deepEqual(webhookListSchema.parse({}), { page: 1, limit: 25 });
    assert.deepEqual(webhookListSchema.parse({ status: "FAILED", page: "2", limit: "10" }), {
        status: "FAILED",
        page: 2,
        limit: 10
    });
    assert.equal(webhookListSchema.safeParse({ status: "UNKNOWN" }).success, false);
    assert.equal(webhookListSchema.safeParse({ limit: "101" }).success, false);
});

test("audit log filters and webhook event IDs are constrained", () => {
    assert.deepEqual(auditLogListSchema.parse({ action: "PAYMENT_SUCCESS" }), {
        action: "PAYMENT_SUCCESS",
        page: 1,
        limit: 25
    });
    assert.equal(auditLogListSchema.safeParse({ action: "" }).success, false);
    assert.equal(webhookEventIdSchema.safeParse("c9f6b41c-40a4-42e3-b9b4-6f344435de32").success, true);
    assert.equal(webhookEventIdSchema.safeParse("not-an-id").success, false);
});