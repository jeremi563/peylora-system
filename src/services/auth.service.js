import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { getDatabasePool } from "../database.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_DAYS = 30;
const ONE_TIME_TOKEN_TTL_HOURS = 1;

function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}

function createOneTimeToken() {
    return randomBytes(32).toString("base64url");
}

function createAccessToken(user) {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error("AUTH_JWT_SECRET must contain at least 32 characters");
    }

    return jwt.sign(
        { role: user.role },
        secret,
        {
            subject: user.id,
            issuer: "daraja-payment-platform",
            audience: "daraja-api",
            expiresIn: ACCESS_TOKEN_TTL
        }
    );
}

function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phone_number,
        role: user.role,
        emailVerified: user.email_verified
    };
}

async function createRefreshToken(client, userId, familyId = randomUUID()) {
    const token = randomBytes(48).toString("base64url");
    await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, token_family_id, expires_at)
         VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 day'))`,
        [userId, hashToken(token), familyId, REFRESH_TOKEN_TTL_DAYS]
    );
    return token;
}

export async function registerUser({ name, businessName, email, password, phoneNumber }) {
    const pool = getDatabasePool();
    const client = await pool.connect();
    const passwordHash = await bcrypt.hash(password, 12);
    const verificationToken = createOneTimeToken();

    try {
        await client.query("BEGIN");
        const inserted = await client.query(
            `INSERT INTO users (name, email, phone_number, password_hash)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, email, phone_number, role, email_verified`,
            [name, email, phoneNumber ?? null, passwordHash]
        );
        await client.query(
            `INSERT INTO merchants (user_id, business_name, business_phone, business_email)
             VALUES ($1, $2, $3, $4)`,
            [inserted.rows[0].id, businessName ?? name, phoneNumber ?? null, email]
        );
        await client.query(
            `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 hour'))`,
            [inserted.rows[0].id, hashToken(verificationToken), ONE_TIME_TOKEN_TTL_HOURS]
        );
        await client.query("COMMIT");

        return { user: publicUser(inserted.rows[0]), verificationToken };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function authenticateUser({ email, password }) {
    const tokenSecret = process.env.AUTH_JWT_SECRET;
    if (!tokenSecret || tokenSecret.length < 32) {
        throw new Error("AUTH_JWT_SECRET must contain at least 32 characters");
    }

    const pool = getDatabasePool();
    const result = await pool.query(
        `SELECT id, name, email, phone_number, role, status, email_verified, password_hash
         FROM users WHERE email = $1`,
        [email]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return { authenticated: false, reason: "INVALID_CREDENTIALS" };
    }
    if (user.status !== "ACTIVE") {
        return { authenticated: false, reason: "ACCOUNT_INACTIVE" };
    }
    if (!user.email_verified) {
        return { authenticated: false, reason: "EMAIL_NOT_VERIFIED" };
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const accessToken = createAccessToken(user);
        const refreshToken = await createRefreshToken(client, user.id);
        await client.query("COMMIT");
        return {
            authenticated: true,
            user: publicUser(user),
            accessToken,
            refreshToken
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function rotateRefreshToken(token) {
    const tokenSecret = process.env.AUTH_JWT_SECRET;
    if (!tokenSecret || tokenSecret.length < 32) {
        throw new Error("AUTH_JWT_SECRET must contain at least 32 characters");
    }

    const pool = getDatabasePool();
    const client = await pool.connect();
    let revokedReplay = false;

    try {
        await client.query("BEGIN");
        const result = await client.query(
            `SELECT rt.user_id, rt.token_family_id, rt.expires_at, rt.revoked_at,
                    u.name, u.email, u.phone_number, u.role, u.status, u.email_verified
             FROM refresh_tokens rt
             JOIN users u ON u.id = rt.user_id
             WHERE rt.token_hash = $1
             FOR UPDATE OF rt`,
            [hashToken(token)]
        );

        if (!result.rowCount) {
            await client.query("COMMIT");
            return { refreshed: false };
        }

        const current = result.rows[0];
        if (current.revoked_at) {
            await client.query(
                "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE token_family_id = $1",
                [current.token_family_id]
            );
            revokedReplay = true;
            await client.query("COMMIT");
            return { refreshed: false, replayDetected: revokedReplay };
        }

        if (new Date(current.expires_at) <= new Date() || current.status !== "ACTIVE") {
            await client.query(
                "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL",
                [hashToken(token)]
            );
            await client.query("COMMIT");
            return { refreshed: false };
        }

        await client.query(
            "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1",
            [hashToken(token)]
        );
        const refreshToken = await createRefreshToken(client, current.user_id, current.token_family_id);
        const user = {
            id: current.user_id,
            name: current.name,
            email: current.email,
            phone_number: current.phone_number,
            role: current.role,
            email_verified: current.email_verified
        };
        const accessToken = createAccessToken(user);
        await client.query("COMMIT");

        return {
            refreshed: true,
            user: publicUser(user),
            accessToken,
            refreshToken
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function revokeRefreshToken(token) {
    const result = await getDatabasePool().query(
        `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE token_hash = $1`,
        [hashToken(token)]
    );
    return result.rowCount > 0;
}

export async function createPasswordResetToken(email) {
    const pool = getDatabasePool();
    const user = await pool.query(
        "SELECT id FROM users WHERE email = $1 AND status = 'ACTIVE'",
        [email]
    );
    if (!user.rowCount) {
        return null;
    }

    const token = createOneTimeToken();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(
            "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL",
            [user.rows[0].id]
        );
        await client.query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 hour'))`,
            [user.rows[0].id, hashToken(token), ONE_TIME_TOKEN_TTL_HOURS]
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
    return token;
}

export async function resetPassword(token, password) {
    const pool = getDatabasePool();
    const client = await pool.connect();
    const tokenHash = hashToken(token);
    const passwordHash = await bcrypt.hash(password, 12);

    try {
        await client.query("BEGIN");
        const reset = await client.query(
            `SELECT id, user_id FROM password_reset_tokens
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
             FOR UPDATE`,
            [tokenHash]
        );
        if (!reset.rowCount) {
            await client.query("ROLLBACK");
            return false;
        }

        await client.query("UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1", [
            reset.rows[0].user_id,
            passwordHash
        ]);
        await client.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1", [reset.rows[0].id]);
        await client.query(
            "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
            [reset.rows[0].user_id]
        );
        await client.query("COMMIT");
        return true;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function createEmailVerificationToken(email) {
    const pool = getDatabasePool();
    const user = await pool.query(
        "SELECT id FROM users WHERE email = $1 AND status = 'ACTIVE' AND email_verified = false",
        [email]
    );
    if (!user.rowCount) {
        return null;
    }

    const token = createOneTimeToken();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(
            "UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL",
            [user.rows[0].id]
        );
        await client.query(
            `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 hour'))`,
            [user.rows[0].id, hashToken(token), ONE_TIME_TOKEN_TTL_HOURS]
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
    return token;
}

export async function verifyEmail(token) {
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const verification = await client.query(
            `SELECT id, user_id FROM email_verification_tokens
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
             FOR UPDATE`,
            [hashToken(token)]
        );
        if (!verification.rowCount) {
            await client.query("ROLLBACK");
            return false;
        }

        await client.query(
            "UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1",
            [verification.rows[0].user_id]
        );
        await client.query("UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1", [
            verification.rows[0].id
        ]);
        await client.query("COMMIT");
        return true;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}