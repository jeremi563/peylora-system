import jwt from "jsonwebtoken";

import { getDatabasePool } from "../database.js";

export async function authenticateAccessToken(req, res, next) {
    const authorization = req.get("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return res.status(401).json({ success: false, message: "Authentication is required" });
    }

    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret || secret.length < 32) {
        console.error("AUTH_JWT_SECRET is missing or too short");
        return res.status(500).json({ success: false, message: "Authentication is unavailable" });
    }

    let claims;
    try {
        claims = jwt.verify(match[1], secret, {
            algorithms: ["HS256"],
            issuer: "daraja-payment-platform",
            audience: "daraja-api"
        });
    } catch {
        return res.status(401).json({ success: false, message: "Access token is invalid or expired" });
    }

    try {
        const result = await getDatabasePool().query(
            `SELECT u.id, u.email, u.role, u.status, u.email_verified,
                    m.id AS merchant_id, m.status AS merchant_status
             FROM users u
             LEFT JOIN merchants m ON m.user_id = u.id
             WHERE u.id = $1`,
            [claims.sub]
        );
        const user = result.rows[0];

        if (!user || user.status !== "ACTIVE" || !user.email_verified) {
            return res.status(401).json({ success: false, message: "Account is unavailable" });
        }
        if (user.role === "MERCHANT" && (!user.merchant_id || user.merchant_status !== "ACTIVE")) {
            return res.status(403).json({ success: false, message: "Merchant account is unavailable" });
        }

        req.auth = {
            userId: user.id,
            email: user.email,
            role: user.role,
            merchantId: user.merchant_id ?? null
        };
        return next();
    } catch (error) {
        console.error("Access token validation failed:", error.message);
        return res.status(500).json({ success: false, message: "Authentication is unavailable" });
    }
}

export function authorizeRoles(...roles) {
    return (req, res, next) => {
        if (!req.auth) {
            return res.status(401).json({ success: false, message: "Authentication is required" });
        }
        if (!roles.includes(req.auth.role)) {
            return res.status(403).json({ success: false, message: "You do not have permission to access this resource" });
        }
        return next();
    };
}

export function requireMerchantOwnership(parameterName = "merchantId") {
    return (req, res, next) => {
        const requestedMerchantId = req.params[parameterName];
        if (req.auth?.role === "ADMIN") {
            return next();
        }
        if (req.auth?.role !== "MERCHANT" || req.auth.merchantId !== requestedMerchantId) {
            return res.status(403).json({ success: false, message: "You do not have access to this merchant" });
        }
        return next();
    };
}