import { z } from "zod";

const money = z.number().nonnegative().max(9_999_999_999.99).refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
    "Amount must have at most two decimal places"
);

const invoiceItem = z.object({
    description: z.string().trim().min(1).max(300),
    quantity: z.number().int().positive().max(1_000_000),
    unitAmount: money
});

export const createInvoiceSchema = z.object({
    invoiceNumber: z.string().trim().min(1).max(64).optional(),
    customer: z.object({
        name: z.string().trim().min(1).max(120),
        phoneNumber: z.string().regex(/^254[17]\d{8}$/),
        email: z.string().trim().email().max(254).optional()
    }),
    items: z.array(invoiceItem).min(1).max(100),
    dueAt: z.string().datetime({ offset: true }).optional()
}).superRefine((invoice, context) => {
    const totalCents = invoice.items.reduce((total, item) => (
        total + BigInt(Math.round(item.unitAmount * 100)) * BigInt(item.quantity)
    ), 0n);
    if (totalCents > 999_999_999_999n) {
        context.addIssue({
            code: "custom",
            path: ["items"],
            message: "Invoice total exceeds the supported KES amount"
        });
    }
    if (totalCents % 100n !== 0n) {
        context.addIssue({
            code: "custom",
            path: ["items"],
            message: "Invoice total must be a whole KES amount for M-Pesa STK payments"
        });
    }
});

export const invoiceListSchema = z.object({
    status: z.enum(["DRAFT", "SENT", "PENDING", "PAID", "OVERDUE", "CANCELLED"]).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const invoiceIdSchema = z.string().uuid();

export const invoiceStatusSchema = z.object({
    status: z.enum(["SENT", "CANCELLED", "OVERDUE"])
});