import { Router } from "express";

import { getAuditLogs, getWebhookEvents, retryWebhook } from "../controllers/webhook.controller.js";
import { authenticateAccessToken, authorizeRoles } from "../middleware/authentication.js";
import { validateParam, validateQuery } from "../middleware/validate-request.js";
import { auditLogListSchema, webhookEventIdSchema, webhookListSchema } from "../validators/webhook.schemas.js";

const router = Router();
const adminAccess = [authenticateAccessToken, authorizeRoles("ADMIN")];

router.get("/api/admin/webhook-events", ...adminAccess, validateQuery(webhookListSchema), getWebhookEvents);
router.post(
    "/api/admin/webhook-events/:eventId/retry",
    ...adminAccess,
    validateParam(webhookEventIdSchema, "eventId"),
    retryWebhook
);
router.get("/api/admin/audit-logs", ...adminAccess, validateQuery(auditLogListSchema), getAuditLogs);

export default router;