import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.CORS_ORIGINS = "https://trusted.example.test";
process.env.LOGIN_RATE_LIMIT = "2";
process.env.API_RATE_LIMIT = "100";
delete process.env.RATE_LIMIT_REDIS_URL;

const { default: app } = await import("../src/app.js");
const { closeDatabase, connectDatabase } = await import("../src/database.js");
const { validateEnvironment } = await import("../src/config/environment.js");

test("security middleware sets headers, restricts CORS, caps JSON bodies, and applies route limits", async () => {
    await connectDatabase();
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));

    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        let response = await fetch(`${base}/`, { headers: { Origin: "https://trusted.example.test" } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("access-control-allow-origin"), "https://trusted.example.test");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("x-powered-by"), null);
        assert.ok(response.headers.get("x-request-id"));

        response = await fetch(`${base}/`, { headers: { Origin: "https://untrusted.example.test" } });
        assert.equal(response.status, 403);
        assert.equal((await response.json()).code, "CORS_ORIGIN_DENIED");

        response = await fetch(`${base}/`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ payload: "x".repeat(70_000) })
        });
        assert.equal(response.status, 413);
        assert.equal((await response.json()).code, "PAYLOAD_TOO_LARGE");

        response = await fetch(`${base}/api/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{invalid json"
        });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "INVALID_JSON");

        const loginRequest = () => fetch(`${base}/api/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "security@example.test", password: "WrongPassword!123" })
        });
        assert.equal((await loginRequest()).status, 401);
        assert.equal((await loginRequest()).status, 401);
        const limited = await loginRequest();
        assert.equal(limited.status, 429);
        assert.equal((await limited.json()).code, "RATE_LIMITED");

        for (let index = 0; index < 110; index += 1) {
            const callback = await fetch(`${base}/api/mpesa/callback`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{}"
            });
            assert.equal(callback.status, 200);
        }
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await closeDatabase();
    }
});

test("production requires explicit frontend/proxy configuration and HTTP is rejected", async () => {
    const previous = {
        nodeEnv: process.env.NODE_ENV,
        corsOrigins: process.env.CORS_ORIGINS,
        proxyHops: process.env.TRUST_PROXY_HOPS,
        smtpHost: process.env.SMTP_HOST,
        rateLimitRedisUrl: process.env.RATE_LIMIT_REDIS_URL
    };
    process.env.NODE_ENV = "production";
    process.env.AUTH_JWT_SECRET = "security-test-secret-that-is-at-least-thirty-two-bytes";
    process.env.SMTP_HOST = "smtp.example.test";
    delete process.env.CORS_ORIGINS;
    delete process.env.TRUST_PROXY_HOPS;
    assert.throws(() => validateEnvironment(), /CORS_ORIGINS/);

    process.env.CORS_ORIGINS = "https://trusted.example.test";
    assert.throws(() => validateEnvironment(), /TRUST_PROXY_HOPS/);
    process.env.TRUST_PROXY_HOPS = "1";
    process.env.RATE_LIMIT_REDIS_URL = "redis://localhost:6379";
    assert.doesNotThrow(() => validateEnvironment());

    app.set("trust proxy", 1);
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        let response = await fetch(`${base}/`);
        assert.equal(response.status, 426);
        assert.equal((await response.json()).code, "HTTPS_REQUIRED");
        response = await fetch(`${base}/`, { headers: { "X-Forwarded-Proto": "https" } });
        assert.equal(response.status, 200);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        app.set("trust proxy", false);
        process.env.NODE_ENV = previous.nodeEnv;
        if (previous.corsOrigins === undefined) delete process.env.CORS_ORIGINS;
        else process.env.CORS_ORIGINS = previous.corsOrigins;
        if (previous.proxyHops === undefined) delete process.env.TRUST_PROXY_HOPS;
        else process.env.TRUST_PROXY_HOPS = previous.proxyHops;
        if (previous.smtpHost === undefined) delete process.env.SMTP_HOST;
        else process.env.SMTP_HOST = previous.smtpHost;
        if (previous.rateLimitRedisUrl === undefined) delete process.env.RATE_LIMIT_REDIS_URL;
        else process.env.RATE_LIMIT_REDIS_URL = previous.rateLimitRedisUrl;
    }
});