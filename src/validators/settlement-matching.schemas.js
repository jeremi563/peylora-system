import { z } from "zod";

export const settlementMatchingRequestSchema = z.object({
    lineId: z.string().uuid().optional(),
    importId: z.string().uuid().optional()
}).refine(
    (value) => value.lineId || value.importId,
    { message: "lineId or importId is required" }
);
