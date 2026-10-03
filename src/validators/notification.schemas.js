import { z } from "zod";

export const notificationListSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    unreadOnly: z.enum(["true", "false"]).default("false").transform((value) => value === "true")
});

export const notificationIdSchema = z.string().uuid();