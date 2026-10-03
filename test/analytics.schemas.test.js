import assert from "node:assert/strict";
import test from "node:test";

import { analyticsQuerySchema, reportQuerySchema } from "../src/validators/analytics.schemas.js";

test("dashboard analytics validates ranges and bucket interval", () => {
    assert.deepEqual(analyticsQuerySchema.parse({ interval: "month" }), { interval: "month" });
    assert.equal(analyticsQuerySchema.safeParse({ from: "2026-01-01", to: "2026-01-31", interval: "week" }).success, true);
    assert.equal(analyticsQuerySchema.safeParse({ from: "2026-02-01", to: "2026-01-01" }).success, false);
    assert.equal(analyticsQuerySchema.safeParse({ from: "2024-01-01", to: "2026-01-01" }).success, false);
    assert.equal(analyticsQuerySchema.safeParse({ interval: "year" }).success, false);
});

test("transaction report accepts only supported formats and bounded ranges", () => {
    assert.deepEqual(reportQuerySchema.parse({}), { format: "csv" });
    assert.equal(reportQuerySchema.safeParse({ format: "xlsx" }).success, true);
    assert.equal(reportQuerySchema.safeParse({ format: "pdf" }).success, true);
    assert.equal(reportQuerySchema.safeParse({ format: "html" }).success, false);
    assert.equal(reportQuerySchema.safeParse({ from: "2025-01-01", to: "2026-12-31" }).success, false);
});