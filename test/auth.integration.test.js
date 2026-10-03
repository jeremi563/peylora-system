import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "phase-thirteen-auth-test-secret-at-least-32-characters";

test("authentication lifecycle hashes credentials and revokes replayed/reset sessions", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const auth = await import("../src/services/auth.service.js");
    const email = `auth-integration-${randomUUID()}@example.test`;
    const oldPassword = "OldIntegrationPassword!123";
    const newPassword = "NewIntegrationPassword!456";

    try {
        const registration = await auth.registerUser({
            name: "Auth Integration",
            businessName: "Auth Integration Shop",
            email,
            password: oldPassword,
            phoneNumber: "254700009876"
        });
        assert.equal(registration.user.emailVerified, false);

        const persisted = await pool.query(
            `SELECT u.password_hash, u.email_verified,
                    COUNT(rt.id)::integer AS refresh_tokens
             FROM users u LEFT JOIN refresh_tokens rt ON rt.user_id = u.id
             WHERE u.id = $1 GROUP BY u.id`,
            [registration.user.id]
        );
        assert.notEqual(persisted.rows[0].password_hash, oldPassword);
        assert.equal(persisted.rows[0].email_verified, false);
        assert.equal(persisted.rows[0].refresh_tokens, 0);

        assert.equal(
            (await auth.authenticateUser({ email, password: oldPassword })).reason,
            "EMAIL_NOT_VERIFIED"
        );
        assert.equal(await auth.verifyEmail(registration.verificationToken), true);
        assert.equal(await auth.verifyEmail(registration.verificationToken), false);

        const firstSession = await auth.authenticateUser({ email, password: oldPassword });
        assert.equal(firstSession.authenticated, true);
        assert.ok(firstSession.accessToken);
        const rawRefresh = await pool.query(
            "SELECT token_hash FROM refresh_tokens WHERE user_id = $1",
            [registration.user.id]
        );
        assert.equal(rawRefresh.rows[0].token_hash.includes(firstSession.refreshToken), false);

        const rotated = await auth.rotateRefreshToken(firstSession.refreshToken);
        assert.equal(rotated.refreshed, true);
        const replay = await auth.rotateRefreshToken(firstSession.refreshToken);
        assert.equal(replay.refreshed, false);
        assert.equal(replay.replayDetected, true);
        assert.equal((await auth.rotateRefreshToken(rotated.refreshToken)).refreshed, false);

        const secondSession = await auth.authenticateUser({ email, password: oldPassword });
        const resetToken = await auth.createPasswordResetToken(email);
        assert.equal(typeof resetToken, "string");
        assert.equal(await auth.resetPassword(resetToken, newPassword), true);
        assert.equal(await auth.resetPassword(resetToken, "AnotherPassword!789"), false);
        assert.equal((await auth.authenticateUser({ email, password: oldPassword })).authenticated, false);
        assert.equal((await auth.rotateRefreshToken(secondSession.refreshToken)).refreshed, false);
        assert.equal((await auth.authenticateUser({ email, password: newPassword })).authenticated, true);

        const unverifiedUser = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [`missing-${email}`]
        );
        assert.equal(unverifiedUser.rowCount, 0);
        assert.equal(await auth.createPasswordResetToken(`missing-${email}`), null);
    } finally {
        const merchant = await pool.query("SELECT id FROM merchants WHERE business_email = $1", [email]);
        if (merchant.rowCount) {
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchant.rows[0].id]);
        }
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
        await closeDatabase();
    }
});