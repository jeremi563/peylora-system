import { z } from "zod";

export const webhookListSchema = z.object({
    status: z.enum(["RECEIVED", "PROCESSING", "PROCESSED", "FAILED"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const auditLogListSchema = z.object({
    action: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const webhookEventIdSchema = z.string().uuid();