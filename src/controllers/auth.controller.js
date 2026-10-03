import {
    authenticateUser,
    createEmailVerificationToken,
    createPasswordResetToken,
    registerUser,
    resetPassword,
    revokeRefreshToken,
    rotateRefreshToken,
    verifyEmail
} from "../services/auth.service.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../services/email.service.js";

function handleError(res, error, operation) {
    if (error.code === "23505") {
        return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    console.error(`${operation} failed:`, error.message);
    return res.status(500).json({ success: false, message: "The request could not be completed" });
}

export async function register(req, res) {
    try {
        const result = await registerUser(req.validatedBody);
        try {
            await sendVerificationEmail(result.user.email, result.verificationToken);
        } catch (emailError) {
            console.error("Verification email could not be sent:", emailError.message);
        }

        return res.status(201).json({
            success: true,
            message: "Account created. Check your email to verify your account.",
            user: result.user
        });
    } catch (error) {
        return handleError(res, error, "Registration");
    }
}

export async function login(req, res) {
    try {
        const result = await authenticateUser(req.validatedBody);
        if (!result.authenticated) {
            const messages = {
                INVALID_CREDENTIALS: "Email or password is incorrect",
                ACCOUNT_INACTIVE: "This account is not active",
                EMAIL_NOT_VERIFIED: "Verify your email before signing in"
            };
            return res.status(401).json({ success: false, message: messages[result.reason] });
        }

        return res.json({
            success: true,
            user: result.user,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            tokenType: "Bearer",
            expiresIn: 900
        });
    } catch (error) {
        return handleError(res, error, "Login");
    }
}

export async function refresh(req, res) {
    try {
        const result = await rotateRefreshToken(req.validatedBody.refreshToken);
        if (!result.refreshed) {
            return res.status(401).json({ success: false, message: "Refresh token is invalid or expired" });
        }

        return res.json({
            success: true,
            user: result.user,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            tokenType: "Bearer",
            expiresIn: 900
        });
    } catch (error) {
        return handleError(res, error, "Token refresh");
    }
}

export async function logout(req, res) {
    try {
        await revokeRefreshToken(req.validatedBody.refreshToken);
        return res.json({ success: true, message: "Signed out" });
    } catch (error) {
        return handleError(res, error, "Logout");
    }
}

export async function forgotPassword(req, res) {
    try {
        const { email } = req.validatedBody;
        const token = await createPasswordResetToken(email);
        if (token) {
            try {
                await sendPasswordResetEmail(email, token);
            } catch (emailError) {
                console.error("Password reset email could not be sent:", emailError.message);
            }
        }

        return res.json({
            success: true,
            message: "If an active account exists for this email, password reset instructions will be sent."
        });
    } catch (error) {
        return handleError(res, error, "Password reset request");
    }
}

export async function completePasswordReset(req, res) {
    try {
        const changed = await resetPassword(req.validatedBody.token, req.validatedBody.password);
        if (!changed) {
            return res.status(400).json({ success: false, message: "Reset token is invalid or expired" });
        }
        return res.json({ success: true, message: "Password has been reset. Sign in with the new password." });
    } catch (error) {
        return handleError(res, error, "Password reset");
    }
}

export async function verifyEmailAddress(req, res) {
    try {
        const verified = await verifyEmail(req.validatedBody.token);
        if (!verified) {
            return res.status(400).json({ success: false, message: "Verification token is invalid or expired" });
        }
        return res.json({ success: true, message: "Email verified. You can now sign in." });
    } catch (error) {
        return handleError(res, error, "Email verification");
    }
}

export async function resendVerification(req, res) {
    try {
        const { email } = req.validatedBody;
        const token = await createEmailVerificationToken(email);
        if (token) {
            try {
                await sendVerificationEmail(email, token);
            } catch (emailError) {
                console.error("Verification email could not be sent:", emailError.message);
            }
        }
        return res.json({
            success: true,
            message: "If an unverified active account exists, verification instructions will be sent."
        });
    } catch (error) {
        return handleError(res, error, "Verification email request");
    }
}