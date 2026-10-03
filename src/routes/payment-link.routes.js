import { Router } from "express";

import {
    createLink,
    deactivateLink,
    getPublicLink,
    getPublicPaymentStatus,
    listLinks,
    payPublicLink
} from "../controllers/payment-link.controller.js";
import {
    authenticateAccessToken,
    authorizeRoles
} from "../middleware/authentication.js";
import { validateParam, validateRequest } from "../middleware/validate-request.js";
import { payPaymentLinkSchema, paymentLinkReferenceSchema, createPaymentLinkSchema } from "../validators/payment-link.schemas.js";
import { paymentIdSchema } from "../validators/payment.schemas.js";
import { publicPaymentRateLimit } from "../middleware/security.js";

const router = Router();

router.post(
    "/api/payment-links",
    authenticateAccessToken,
    authorizeRoles("MERCHANT"),
    validateRequest(createPaymentLinkSchema),
    createLink
);
router.get(
    "/api/payment-links",
    authenticateAccessToken,
    authorizeRoles("MERCHANT"),
    listLinks
);
router.delete(
    "/api/payment-links/:linkId",
    authenticateAccessToken,
    authorizeRoles("MERCHANT"),
    validateParam(paymentIdSchema, "linkId"),
    deactivateLink
);
router.get(
    "/api/public/payment-links/:reference",
    validateParam(paymentLinkReferenceSchema, "reference"),
    getPublicLink
);
router.post(
    "/api/public/payment-links/:reference/pay",
    publicPaymentRateLimit,
    validateParam(paymentLinkReferenceSchema, "reference"),
    validateRequest(payPaymentLinkSchema),
    payPublicLink
);
router.get(
    "/api/public/payment-links/:reference/payments/:paymentId/status",
    validateParam(paymentLinkReferenceSchema, "reference"),
    validateParam(paymentIdSchema, "paymentId"),
    getPublicPaymentStatus
);

export default router;