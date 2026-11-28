import { Router } from "express";

import {
    createSnapshot,
    listMerchantSnapshots,
    resolveException,
    resolveMatch
} from "../controllers/settlement-review.controller.js";
import { authenticateAccessToken, authorizeRoles } from "../middleware/authentication.js";
import { validateParam, validateRequest } from "../middleware/validate-request.js";
import {
    settlementExceptionIdSchema,
    settlementMatchIdSchema,
    settlementExceptionResolutionSchema,
    settlementMatchResolutionSchema,
    settlementSnapshotSchema
} from "../validators/settlement-review.schemas.js";

const router = Router();
const adminAccess = [authenticateAccessToken, authorizeRoles("ADMIN")];
const merchantAccess = [authenticateAccessToken, authorizeRoles("MERCHANT")];

router.post(
    "/api/admin/settlement-exceptions/:exceptionId/resolve",
    ...adminAccess,
    validateParam(settlementExceptionIdSchema, "exceptionId"),
    validateRequest(settlementExceptionResolutionSchema),
    resolveException
);
router.post(
    "/api/admin/settlement-matches/:matchId/resolve",
    ...adminAccess,
    validateParam(settlementMatchIdSchema, "matchId"),
    validateRequest(settlementMatchResolutionSchema),
    resolveMatch
);
router.post(
    "/api/admin/settlement-reconciliation-runs",
    ...adminAccess,
    validateRequest(settlementSnapshotSchema),
    createSnapshot
);
router.get(
    "/api/settlement-reconciliation-runs",
    ...merchantAccess,
    listMerchantSnapshots
);

export default router;
