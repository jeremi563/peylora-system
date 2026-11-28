import { Router } from "express";

import {
    authorizePaymentAttemptRetry,
    getAuditLogs,
    getOperations,
    getWebhookEvents,
    retryWebhook
} from "../controllers/webhook.controller.js";
import { authenticateAccessToken, authorizeRoles } from "../middleware/authentication.js";
import { validateParam, validateQuery, validateRequest } from "../middleware/validate-request.js";
import {
    auditLogListSchema,
    paymentAttemptIdSchema,
    paymentAttemptRecoverySchema,
    webhookRetrySchema,
    webhookEventIdSchema,
    webhookListSchema
} from "../validators/webhook.schemas.js";

const router = Router();
const adminAccess = [authenticateAccessToken, authorizeRoles("ADMIN")];

router.get("/api/admin/webhook-events", ...adminAccess, validateQuery(webhookListSchema), getWebhookEvents);
router.post(
    "/api/admin/webhook-events/:eventId/retry",
    ...adminAccess,
    validateParam(webhookEventIdSchema, "eventId"),
    validateRequest(webhookRetrySchema),
    retryWebhook
);
router.post(
    "/api/admin/payment-attempts/:transactionId/recovery-dispositions",
    ...adminAccess,
    validateParam(paymentAttemptIdSchema, "transactionId"),
    validateRequest(paymentAttemptRecoverySchema),
    authorizePaymentAttemptRetry
);
router.get("/api/admin/operations", ...adminAccess, getOperations);
router.get("/api/admin/audit-logs", ...adminAccess, validateQuery(auditLogListSchema), getAuditLogs);

export default router;