import { Router } from "express";
import multer from "multer";

import {
    downloadSettlementEvidence,
    getSettlementImport,
    listSettlementImports,
    listSettlementProfiles,
    uploadSettlementEvidence
} from "../controllers/settlement-evidence.controller.js";
import { authenticateAccessToken, authorizeRoles } from "../middleware/authentication.js";
import { validateParam } from "../middleware/validate-request.js";
import { settlementImportIdSchema } from "../validators/settlement-evidence.schemas.js";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 10
    }
});

const router = Router();
const merchantAccess = [authenticateAccessToken, authorizeRoles("MERCHANT")];

router.get(
    "/api/settlement-evidence/profiles",
    ...merchantAccess,
    listSettlementProfiles
);
router.post(
    "/api/settlement-evidence/imports",
    ...merchantAccess,
    upload.single("file"),
    uploadSettlementEvidence
);
router.get(
    "/api/settlement-evidence/imports",
    ...merchantAccess,
    listSettlementImports
);
router.get(
    "/api/settlement-evidence/imports/:importId",
    ...merchantAccess,
    validateParam(settlementImportIdSchema, "importId"),
    getSettlementImport
);
router.get(
    "/api/settlement-evidence/imports/:importId/download",
    ...merchantAccess,
    validateParam(settlementImportIdSchema, "importId"),
    downloadSettlementEvidence
);

export default router;
