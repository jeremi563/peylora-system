import { z } from "zod";

export const analyticsQuerySchema = z.object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    interval: z.enum(["day", "week", "month"]).default("day")
}).superRefine((query, context) => {
    if (query.from && query.to) {
        const from = new Date(`${query.from}T00:00:00Z`);
        const to = new Date(`${query.to}T00:00:00Z`);
        const days = Math.floor((to - from) / 86_400_000);

        if (days < 0) {
            context.addIssue({ code: "custom", path: ["from"], message: "from must be on or before to" });
        } else if (days > 365) {
            context.addIssue({ code: "custom", path: ["from"], message: "Date range cannot exceed 366 calendar days" });
        }
    }
});

export const reportQuerySchema = z.object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    format: z.enum(["csv", "xlsx", "pdf"]).default("csv")
}).superRefine((query, context) => {
    if (query.from && query.to) {
        const from = new Date(`${query.from}T00:00:00Z`);
        const to = new Date(`${query.to}T00:00:00Z`);
        const days = Math.floor((to - from) / 86_400_000);

        if (days < 0) {
            context.addIssue({ code: "custom", path: ["from"], message: "from must be on or before to" });
        } else if (days > 365) {
            context.addIssue({ code: "custom", path: ["from"], message: "Date range cannot exceed 366 calendar days" });
        }
    }
});