import { Router } from "express";

import {
    getPayment,
    getHome,
    getTransaction,
    initiateStkPush,
    listPayments,
    reconcileTransaction,
    receiveMpesaCallback
} from "../controllers/mpesa.controller.js";
import {
    authenticateAccessToken,
    authorizeRoles
} from "../middleware/authentication.js";
import { validateParam, validateQuery, validateRequest } from "../middleware/validate-request.js";
import { createPaymentSchema, paymentIdSchema, paymentListSchema } from "../validators/payment.schemas.js";
import { paymentRateLimit } from "../middleware/security.js";

const router = Router();

router.get("/", getHome);
router.post(
    "/api/payments",
    paymentRateLimit,
    authenticateAccessToken,
    authorizeRoles("MERCHANT"),
    validateRequest(createPaymentSchema),
    initiateStkPush
);
router.get(
    "/api/payments",
    authenticateAccessToken,
    authorizeRoles("MERCHANT"),
    validateQuery(paymentListSchema),
    listPayments
);
router.get(
    "/api/payments/:paymentId",
    authenticateAccessToken,
    authorizeRoles("MERCHANT"),
    validateParam(paymentIdSchema, "paymentId"),
    getPayment
);
router.get(
    "/api/transactions/:transactionId",
    authenticateAccessToken,
    authorizeRoles("MERCHANT"),
    validateParam(paymentIdSchema, "transactionId"),
    getTransaction
);
router.post(
    "/api/transactions/:transactionId/reconcile",
    authenticateAccessToken,
    authorizeRoles("MERCHANT"),
    validateParam(paymentIdSchema, "transactionId"),
    reconcileTransaction
);
router.post(
    "/api/mpesa/stk-push",
    paymentRateLimit,
    authenticateAccessToken,
    authorizeRoles("MERCHANT"),
    validateRequest(createPaymentSchema),
    initiateStkPush
);
router.post("/api/mpesa/callback", receiveMpesaCallback);

export default router;