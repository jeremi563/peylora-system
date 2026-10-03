import { Router } from "express";

import {
    listNotifications,
    markAllAsRead,
    markNotificationAsRead
} from "../controllers/notification.controller.js";
import { authenticateAccessToken } from "../middleware/authentication.js";
import { validateParam, validateQuery } from "../middleware/validate-request.js";
import { notificationIdSchema, notificationListSchema } from "../validators/notification.schemas.js";

const router = Router();

router.get("/api/notifications", authenticateAccessToken, validateQuery(notificationListSchema), listNotifications);
router.patch("/api/notifications/read-all", authenticateAccessToken, markAllAsRead);
router.patch(
    "/api/notifications/:notificationId/read",
    authenticateAccessToken,
    validateParam(notificationIdSchema, "notificationId"),
    markNotificationAsRead
);

export default router;