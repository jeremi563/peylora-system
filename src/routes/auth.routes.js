import { Router } from "express";

import {
    completePasswordReset,
    forgotPassword,
    login,
    logout,
    refresh,
    register,
    resendVerification,
    verifyEmailAddress
} from "../controllers/auth.controller.js";
import { validateRequest } from "../middleware/validate-request.js";
import {
    loginRateLimit,
    passwordRateLimit,
    registrationRateLimit
} from "../middleware/security.js";
import {
    forgotPasswordSchema,
    loginSchema,
    refreshSchema,
    registerSchema,
    resetPasswordSchema,
    verifyEmailSchema
} from "../validators/auth.schemas.js";

const router = Router();

router.post("/register", registrationRateLimit, validateRequest(registerSchema), register);
router.post("/login", loginRateLimit, validateRequest(loginSchema), login);
router.post("/refresh", validateRequest(refreshSchema), refresh);
router.post("/logout", validateRequest(refreshSchema), logout);
router.post("/password/forgot", passwordRateLimit, validateRequest(forgotPasswordSchema), forgotPassword);
router.post("/password/reset", passwordRateLimit, validateRequest(resetPasswordSchema), completePasswordReset);
router.post("/email/verify", passwordRateLimit, validateRequest(verifyEmailSchema), verifyEmailAddress);
router.get("/verify-email", (req, res, next) => {
    req.body = { token: req.query.token };
    next();
}, passwordRateLimit, validateRequest(verifyEmailSchema), verifyEmailAddress);
router.post("/email/resend-verification", passwordRateLimit, validateRequest(forgotPasswordSchema), resendVerification);

export default router;