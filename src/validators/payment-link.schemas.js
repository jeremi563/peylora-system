import { z } from "zod";

export const createPaymentLinkSchema = z.object({
    description: z.string().trim().min(1).max(500),
    amount: z.number().int().positive().max(250_000),
    expiresAt: z.string().datetime({ offset: true }).optional()
});

export const paymentLinkReferenceSchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);

export const payPaymentLinkSchema = z.object({
    phoneNumber: z.string().regex(/^254[17]\d{8}$/)
});