import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import {
    sendNotificationEmail,
    sendPasswordResetEmail,
    sendVerificationEmail
} from "../src/services/email.service.js";

const emailEnvironmentKeys = ["BREVO_API_KEY", "EMAIL_FROM", "NODE_ENV", "PUBLIC_APP_URL", "PORT"];

async function withEmailEnvironment(overrides, run) {
    const previous = Object.fromEntries(emailEnvironmentKeys.map((key) => [key, process.env[key]]));
    for (const key of emailEnvironmentKeys) {
        if (Object.hasOwn(overrides, key)) {
            if (overrides[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = overrides[key];
            }
        } else {
            delete process.env[key];
        }
    }

    try {
        await run();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

test("verification email is sent through Brevo with the branded action template", async (context) => {
    let request;
    context.mock.method(axios, "post", async (...args) => {
        request = args;
        return { status: 201 };
    });

    await withEmailEnvironment({
        BREVO_API_KEY: "test-api-key",
        EMAIL_FROM: '"Peyflow team" <verified@example.test>',
        NODE_ENV: "test",
        PUBLIC_APP_URL: "https://app.example.test"
    }, () => sendVerificationEmail("merchant@example.test", "token value&"));

    assert.equal(request[0], "https://api.brevo.com/v3/smtp/email");
    assert.deepEqual(request[1].sender, { email: "verified@example.test", name: "Peyflow team" });
    assert.deepEqual(request[1].to, [{ email: "merchant@example.test" }]);
    assert.equal(request[1].subject, "Verify your Peyflow account");
    assert.match(request[1].htmlContent, /Verify email address/);
    assert.match(request[1].htmlContent, /https:\/\/app\.example\.test\/api\/auth\/verify-email\?token=token\+value%26/);
    assert.equal(request[2].headers["api-key"], "test-api-key");
    assert.equal(request[2].timeout, 10000);
});

test("notification content is escaped before being included in the shared HTML template", async (context) => {
    let request;
    context.mock.method(axios, "post", async (...args) => {
        request = args;
        return { status: 201 };
    });

    await withEmailEnvironment({
        BREVO_API_KEY: "test-api-key",
        EMAIL_FROM: "verified@example.test",
        NODE_ENV: "test"
    }, () => sendNotificationEmail({
        to: "merchant@example.test",
        subject: "Notice",
        text: "<script>alert('x')</script>"
    }));

    assert.match(request[1].htmlContent, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
    assert.doesNotMatch(request[1].htmlContent, /<script>/);
});

test("Brevo delivery failures are reported without leaking the API key", async (context) => {
    context.mock.method(axios, "post", async () => {
        throw { response: { status: 401, data: { message: "Authentication failed" } } };
    });

    await withEmailEnvironment({
        BREVO_API_KEY: "do-not-leak-this-key",
        EMAIL_FROM: "verified@example.test",
        NODE_ENV: "test"
    }, async () => {
        await assert.rejects(
            sendPasswordResetEmail("merchant@example.test", "reset-token"),
            (error) => {
                assert.match(error.message, /Brevo email delivery failed \(HTTP 401\)/);
                assert.doesNotMatch(error.message, /do-not-leak-this-key/);
                return true;
            }
        );
    });
});

test("production requires the Brevo API key", async () => {
    await withEmailEnvironment({ NODE_ENV: "production" }, async () => {
        await assert.rejects(
            sendNotificationEmail({ to: "merchant@example.test", subject: "Notice", text: "Message" }),
            /BREVO_API_KEY is required for email delivery in production/
        );
    });
});