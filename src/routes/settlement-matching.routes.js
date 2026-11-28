import { Router } from "express";

import {
    listSettlementExceptions,
    listSettlementMatches,
    runSettlementMatching
} from "../controllers/settlement-matching.controller.js";
import { authenticateAccessToken, authorizeRoles } from "../middleware/authentication.js";
import { validateRequest } from "../middleware/validate-request.js";
import { settlementMatchingRequestSchema } from "../validators/settlement-matching.schemas.js";

const router = Router();
const merchantAccess = [authenticateAccessToken, authorizeRoles("MERCHANT")];

router.post(
    "/api/settlement-matching/run",
    ...merchantAccess,
    validateRequest(settlementMatchingRequestSchema),
    runSettlementMatching
);
router.get(
    "/api/settlement-matching/matches",
    ...merchantAccess,
    listSettlementMatches
);
router.get(
    "/api/settlement-matching/exceptions",
    ...merchantAccess,
    listSettlementExceptions
);

export default router;
