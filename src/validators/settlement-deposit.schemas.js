import { z } from "zod";

export const bankAccountSchema = z.object({
    accountAlias: z.string().trim().min(2).max(100),
    bankReference: z.string().trim().min(1).max(100).optional(),
    accountLast4: z.string().regex(/^\d{4}$/).optional()
});

export const bankDepositSchema = z.object({
    accountAlias: z.string().trim().min(2).max(100),
    bankReference: z.string().trim().min(1).max(100).optional(),
    depositDate: z.string().trim().min(8).max(40),
    valueDate: z.string().trim().min(8).max(40).optional(),
    depositedAmount: z.union([z.number(), z.string()]),
    evidenceImportId: z.string().uuid().optional(),
    evidenceRowId: z.string().uuid().optional()
});

export const batchDepositReconciliationSchema = z.object({
    settlementBatchId: z.string().uuid(),
    bankDepositId: z.string().uuid()
});
