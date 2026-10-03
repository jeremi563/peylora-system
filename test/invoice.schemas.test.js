import assert from "node:assert/strict";
import test from "node:test";

import {
    createInvoiceSchema,
    invoiceIdSchema,
    invoiceListSchema,
    invoiceStatusSchema
} from "../src/validators/invoice.schemas.js";

const validInvoice = {
    customer: { name: "John Doe", phoneNumber: "254700000001", email: "john@example.test" },
    items: [
        { description: "Website development", quantity: 1, unitAmount: 20_000 },
        { description: "Hosting", quantity: 2, unitAmount: 1_500 }
    ]
};

test("invoice creation validates customer and line items, not a client total", () => {
    assert.equal(createInvoiceSchema.safeParse(validInvoice).success, true);
    assert.equal(createInvoiceSchema.safeParse({ ...validInvoice, items: [] }).success, false);
    assert.equal(createInvoiceSchema.safeParse({
        ...validInvoice,
        items: [{ description: "Bad quantity", quantity: 0, unitAmount: 10 }]
    }).success, false);
    assert.equal(createInvoiceSchema.safeParse({
        ...validInvoice,
        items: [{ description: "Too precise", quantity: 1, unitAmount: 1.001 }]
    }).success, false);
    assert.equal(createInvoiceSchema.safeParse({
        ...validInvoice,
        items: [{ description: "Fractional total", quantity: 1, unitAmount: 10.25 }]
    }).success, false);
});

test("invoice totals are bounded by database numeric precision", () => {
    assert.equal(createInvoiceSchema.safeParse({
        customer: validInvoice.customer,
        items: [{ description: "Within limit", quantity: 1, unitAmount: 9_999_999_999 }]
    }).success, true);
    assert.equal(createInvoiceSchema.safeParse({
        customer: validInvoice.customer,
        items: [{ description: "Over limit", quantity: 2, unitAmount: 9_999_999_999 }]
    }).success, false);
});

test("invoice totals must be whole KES and due dates must be valid timestamps", () => {
    assert.equal(createInvoiceSchema.safeParse({
        customer: validInvoice.customer,
        items: [{ description: "Fractional", quantity: 1, unitAmount: 10.25 }]
    }).success, false);
    assert.equal(createInvoiceSchema.safeParse({
        customer: validInvoice.customer,
        items: [{ description: "Whole total", quantity: 4, unitAmount: 10.25 }]
    }).success, true);
    assert.equal(createInvoiceSchema.safeParse({
        ...validInvoice,
        dueAt: "tomorrow"
    }).success, false);
});

test("invoice list, identifier, and lifecycle values are constrained", () => {
    assert.deepEqual(invoiceListSchema.parse({}), { page: 1, limit: 25 });
    assert.equal(invoiceListSchema.safeParse({ status: "UNKNOWN" }).success, false);
    assert.equal(invoiceIdSchema.safeParse("not-a-uuid").success, false);
    assert.equal(invoiceStatusSchema.safeParse({ status: "PAID" }).success, false);
    assert.equal(invoiceStatusSchema.safeParse({ status: "CANCELLED" }).success, true);
});