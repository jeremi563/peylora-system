import { Router } from "express";

import { getMerchant } from "../controllers/merchant.controller.js";
import {
    authenticateAccessToken,
    authorizeRoles,
    requireMerchantOwnership
} from "../middleware/authentication.js";

const router = Router();

router.get(
    "/:merchantId",
    authenticateAccessToken,
    authorizeRoles("MERCHANT", "ADMIN"),
    requireMerchantOwnership(),
    getMerchant
);

export default router;