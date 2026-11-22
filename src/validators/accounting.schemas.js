import { z } from "zod";

export const allocationAmountSchema = z.object({
    amount: z.number().positive().max(9_999_999_999.99).refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
        "Amount must have at most two decimal places"
    )
});

export const allocationIdSchema = z.string().uuid();
export const customerIdSchema = z.string().uuid();
export const invoiceIdSchema = z.string().uuid();
