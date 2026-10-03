import { randomUUID } from "node:crypto";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { createClient } from "redis";

const redisUrl = process.env.RATE_LIMIT_REDIS_URL;
const rateLimitRedisClient = redisUrl ? createClient({ url: redisUrl }) : null;

rateLimitRedisClient?.on("error", (error) => {
    console.error("Rate-limit Redis error:", error.message);
});

if (rateLimitRedisClient && !rateLimitRedisClient.isOpen) {
    await rateLimitRedisClient.connect();
}

const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

export function requestContext(req, res, next) {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
}

export function enforceHttps(req, res, next) {
    if (process.env.NODE_ENV !== "production" || req.secure) {
        return next();
    }

    return res.status(426).json({
        success: false,
        message: "HTTPS is required",
        code: "HTTPS_REQUIRED",
        requestId: req.requestId
    });
}

export const corsMiddleware = cors({
    origin(origin, callback) {
        if (!origin || corsOrigins.includes(origin)) {
            return callback(null, true);
        }

        const error = new Error("Origin is not allowed");
        error.code = "CORS_ORIGIN_DENIED";
        return callback(error);
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
    exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
    credentials: false,
    maxAge: 600,
    optionsSuccessStatus: 204
});

function createRateLimiter({ id, windowMs, limit, message }) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        passOnStoreError: false,
        ...(rateLimitRedisClient ? {
            store: new RedisStore({
                prefix: `daraja:rate-limit:${id}:`,
                sendCommand: (...args) => rateLimitRedisClient.sendCommand(args)
            })
        } : {}),
        skip: (req) => req.originalUrl.split("?")[0] === "/api/mpesa/callback",
        handler(req, res) {
            res.status(429).json({
                success: false,
                message,
                code: "RATE_LIMITED",
                requestId: req.requestId
            });
        }
    });
}

export const apiRateLimit = createRateLimiter({
    id: "api",
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.API_RATE_LIMIT || 300),
    message: "Too many API requests. Try again later."
});

export const loginRateLimit = createRateLimiter({
    id: "login",
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.LOGIN_RATE_LIMIT || 10),
    message: "Too many sign-in attempts. Try again later."
});

export const registrationRateLimit = createRateLimiter({
    id: "registration",
    windowMs: 60 * 60 * 1000,
    limit: Number(process.env.REGISTRATION_RATE_LIMIT || 10),
    message: "Too many account creation attempts. Try again later."
});

export const passwordRateLimit = createRateLimiter({
    id: "password",
    windowMs: 60 * 60 * 1000,
    limit: Number(process.env.PASSWORD_RATE_LIMIT || 5),
    message: "Too many password or verification requests. Try again later."
});

export const paymentRateLimit = createRateLimiter({
    id: "payment",
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.PAYMENT_RATE_LIMIT || 10),
    message: "Too many payment attempts. Try again later."
});

export const publicPaymentRateLimit = createRateLimiter({
    id: "public-payment",
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.PUBLIC_PAYMENT_RATE_LIMIT || 8),
    message: "Too many payment attempts. Try again later."
});

export async function connectRateLimitStore() {
    if (rateLimitRedisClient && !rateLimitRedisClient.isOpen) {
        await rateLimitRedisClient.connect();
    }
}

export async function closeRateLimitStore() {
    if (rateLimitRedisClient?.isOpen) {
        await rateLimitRedisClient.quit();
    }
}

export function apiErrorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    if (error.code === "CORS_ORIGIN_DENIED") {
        return res.status(403).json({
            success: false,
            message: "Request origin is not allowed",
            code: "CORS_ORIGIN_DENIED",
            requestId: req.requestId
        });
    }

    if (error.type === "entity.too.large") {
        return res.status(413).json({
            success: false,
            message: "Request body exceeds the allowed size",
            code: "PAYLOAD_TOO_LARGE",
            requestId: req.requestId
        });
    }

    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
        return res.status(400).json({
            success: false,
            message: "Request body must contain valid JSON",
            code: "INVALID_JSON",
            requestId: req.requestId
        });
    }

    console.error("Unhandled API error:", {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        message: error.message
    });
    return res.status(500).json({
        success: false,
        message: "An internal server error occurred",
        code: "INTERNAL_SERVER_ERROR",
        requestId: req.requestId
    });
}