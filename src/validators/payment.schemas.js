import { z } from "zod";

export const createPaymentSchema = z.object({
    amount: z.number().int().positive().max(250_000),
    phoneNumber: z.string().regex(/^254[17]\d{8}$/),
    description: z.string().trim().max(500).optional()
});

export const paymentListSchema = z.object({
    status: z.enum(["CREATED", "PENDING", "SUCCESS", "FAILED", "CANCELLED", "TIMEOUT"]).optional(),
    paymentLinkId: z.string().uuid().optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const paymentIdSchema = z.string().uuid();