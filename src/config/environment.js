export function validateEnvironment() {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error("AUTH_JWT_SECRET must be configured with at least 32 characters");
    }

    if (process.env.NODE_ENV === "production" && !process.env.BREVO_API_KEY) {
        throw new Error("BREVO_API_KEY must be configured in production to deliver email");
    }

    if (process.env.NODE_ENV === "production" && !process.env.EMAIL_FROM) {
        throw new Error("EMAIL_FROM must be configured in production to deliver email");
    }

    if (process.env.NODE_ENV === "production" && !process.env.CORS_ORIGINS) {
        throw new Error("CORS_ORIGINS must list the trusted frontend origins in production");
    }

    if (process.env.NODE_ENV === "production" && process.env.TRUST_PROXY_HOPS === undefined) {
        throw new Error("TRUST_PROXY_HOPS must be configured behind the production HTTPS proxy");
    }

    if (process.env.NODE_ENV === "production" && !process.env.RATE_LIMIT_REDIS_URL) {
        throw new Error("RATE_LIMIT_REDIS_URL must be configured for shared production rate limits");
    }

    if (process.env.TRUST_PROXY_HOPS !== undefined) {
        const hops = Number(process.env.TRUST_PROXY_HOPS);
        if (!Number.isInteger(hops) || hops < 1 || hops > 5) {
            throw new Error("TRUST_PROXY_HOPS must be an integer between 1 and 5");
        }
    }
}