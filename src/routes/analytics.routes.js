import { Router } from "express";

import { exportTransactionReport, getDashboard } from "../controllers/analytics.controller.js";
import { authenticateAccessToken, authorizeRoles } from "../middleware/authentication.js";
import { validateQuery } from "../middleware/validate-request.js";
import { analyticsQuerySchema, reportQuerySchema } from "../validators/analytics.schemas.js";

const router = Router();
const merchantAccess = [authenticateAccessToken, authorizeRoles("MERCHANT")];

router.get("/api/analytics/dashboard", ...merchantAccess, validateQuery(analyticsQuerySchema), getDashboard);
router.get("/api/analytics/reports/transactions", ...merchantAccess, validateQuery(reportQuerySchema), exportTransactionReport);

export default router;