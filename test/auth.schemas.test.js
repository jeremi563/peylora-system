import assert from "node:assert/strict";
import test from "node:test";

import {
    loginSchema,
    registerSchema,
    resetPasswordSchema
} from "../src/validators/auth.schemas.js";

test("registration normalizes email and rejects invalid phone or oversized password", () => {
    const result = registerSchema.safeParse({
        name: " Merchant ",
        email: "MERCHANT@example.test",
        password: "ValidIntegrationPassword!123",
        phoneNumber: "254700000001",
        role: "ADMIN"
    });
    assert.equal(result.success, true);
    assert.equal(result.data.email, "merchant@example.test");
    assert.equal("role" in result.data, false);
    assert.equal(registerSchema.safeParse({
        name: "Merchant",
        email: "merchant@example.test",
        password: "a".repeat(73)
    }).success, false);
    assert.equal(registerSchema.safeParse({
        name: "Merchant",
        email: "merchant@example.test",
        password: "ValidIntegrationPassword!123",
        phoneNumber: "0700000001"
    }).success, false);
});

test("login and password reset enforce password byte and token constraints", () => {
    assert.equal(loginSchema.safeParse({ email: "user@example.test", password: "a".repeat(72) }).success, true);
    assert.equal(loginSchema.safeParse({ email: "user@example.test", password: "a".repeat(73) }).success, false);
    assert.equal(resetPasswordSchema.safeParse({ token: "t".repeat(32), password: "NewPassword!123" }).success, true);
    assert.equal(resetPasswordSchema.safeParse({ token: "short", password: "NewPassword!123" }).success, false);
});