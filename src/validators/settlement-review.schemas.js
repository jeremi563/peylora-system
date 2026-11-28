import { z } from "zod";

export const settlementExceptionIdSchema = z.string().uuid();
export const settlementMatchIdSchema = z.string().uuid();

export const settlementExceptionResolutionSchema = z.object({
    merchantId: z.string().uuid(),
    resolution: z.enum(["RESOLVED", "DISMISSED"]),
    reason: z.string().trim().min(8).max(1000),
    supportingEvidence: z.string().trim().min(1).max(4000)
});

export const settlementMatchResolutionSchema = z.object({
    merchantId: z.string().uuid(),
    resolution: z.enum(["CONFIRMED", "DISMISSED"]),
    reason: z.string().trim().min(8).max(1000),
    supportingEvidence: z.string().trim().min(1).max(4000)
});

export const settlementSnapshotSchema = z.object({
    merchantId: z.string().uuid(),
    runType: z.enum([
        "PROVIDER_MATCH",
        "BATCH_DEPOSIT",
        "FULL_RECONCILIATION"
    ])
});
