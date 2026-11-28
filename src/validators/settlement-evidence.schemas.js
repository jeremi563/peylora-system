import { z } from "zod";

export const settlementImportIdSchema = z.string().uuid();
