import { createHash } from "node:crypto";
import { getDatabasePool } from "../database.js";

function parseResultCode(value) {
    if (Number.isInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value);
    return null;
}

function canonicalJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) =>
            `${JSON.stringify(key)}:${canonicalJson(value[key])}`
        ).join(",")}}`;
    }
    return JSON.stringify(value);
}

export async function enqueueMpesaCallback(callback, metadata, rawPayload = { Body: { stkCallback: callback } }) {
    const checkoutRequestId = callback?.CheckoutRequestID;
    const resultCode = parseResultCode(callback?.ResultCode);
    if (typeof checkoutRequestId !== "string" || !checkoutRequestId || resultCode === null || !metadata || typeof metadata !== "object") {
        return { accepted: false, reason: "INVALID_CALLBACK" };
    }

    const baseEventKey = `mpesa:${checkoutRequestId}`;
    const payload = { callback, metadata, rawPayload };
    const canonicalPayload = canonicalJson(payload);
    const fingerprint = createHash("sha256").update(canonicalPayload).digest("hex");
    const client = await getDatabasePool().connect();

    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [checkoutRequestId]);

        const baseEvent = await client.query(
            "SELECT id, event_key, payload, status FROM webhook_events WHERE event_key = $1 FOR UPDATE",
            [baseEventKey]
        );
        if (baseEvent.rowCount && canonicalJson(baseEvent.rows[0].payload) === canonicalPayload) {
            await client.query("COMMIT");
            return {
                accepted: true,
                duplicate: true,
                eventId: baseEvent.rows[0].id,
                eventKey: baseEventKey,
                status: baseEvent.rows[0].status
            };
        }

        const eventKey = baseEvent.rowCount
            ? `${baseEventKey}:${fingerprint}`
            : baseEventKey;
        const existing = eventKey === baseEventKey
            ? null
            : await client.query(
                "SELECT id, payload, status FROM webhook_events WHERE event_key = $1 FOR UPDATE",
                [eventKey]
            );
        if (existing?.rowCount) {
            if (canonicalJson(existing.rows[0].payload) !== canonicalPayload) {
                throw new Error("Callback evidence fingerprint collision");
            }
            await client.query("COMMIT");
            return {
                accepted: true,
                duplicate: true,
                eventId: existing.rows[0].id,
                eventKey,
                status: existing.rows[0].status
            };
        }

        const inserted = await client.query(
            `INSERT INTO webhook_events (provider, event_type, event_key, payload, status, next_attempt_at)
             VALUES ('MPESA', 'STK_CALLBACK', $1, $2, 'RECEIVED', NOW())
             RETURNING id`,
            [eventKey, JSON.stringify(payload)]
        );
        await client.query("COMMIT");
        return {
            accepted: true,
            duplicate: false,
            eventId: inserted.rows[0].id,
            eventKey
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function claimWebhookEvents(limit = 10, leaseSeconds = 300) {
    const client = await getDatabasePool().connect();
    try {
        await client.query("BEGIN");
        const selected = await client.query(
            `SELECT id, provider, event_type, event_key, payload, attempts, max_attempts
             FROM webhook_events
             WHERE (
                    status = 'RECEIVED' AND next_attempt_at <= NOW()
                 ) OR (
                    status = 'PROCESSING' AND claimed_at < NOW() - ($2 * INTERVAL '1 second')
                 )
             ORDER BY created_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED`,
            [limit, leaseSeconds]
        );
        const events = [];
        for (const event of selected.rows) {
            if (event.attempts >= event.max_attempts) {
                await client.query(
                    `UPDATE webhook_events SET status = 'FAILED', last_error = COALESCE(last_error, 'Maximum attempts exceeded'),
                     claimed_at = NULL, updated_at = NOW() WHERE id = $1`,
                    [event.id]
                );
                continue;
            }

            const claimed = await client.query(
                `UPDATE webhook_events
                 SET status = 'PROCESSING', attempts = attempts + 1,
                     claimed_at = NOW(), next_attempt_at = NOW() + ($2 * INTERVAL '1 second'),
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING id, provider, event_type, event_key, payload, attempts, max_attempts`,
                [event.id, leaseSeconds]
            );
            events.push(claimed.rows[0]);
        }
        await client.query("COMMIT");
        return events;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function markWebhookProcessed(eventId) {
    await getDatabasePool().query(
        `UPDATE webhook_events
         SET status = 'PROCESSED', processed_at = NOW(), claimed_at = NULL,
             last_error = NULL, updated_at = NOW()
         WHERE id = $1`,
        [eventId]
    );
}

export async function retryWebhookEvent(eventId, attempts, maxAttempts, errorMessage) {
    const terminal = attempts >= maxAttempts;
    const retrySeconds = Math.min(3600, 5 * (2 ** Math.min(attempts - 1, 9)));
    await getDatabasePool().query(
        `UPDATE webhook_events
         SET status = $2,
             next_attempt_at = CASE WHEN $2 = 'FAILED' THEN next_attempt_at ELSE NOW() + ($3 * INTERVAL '1 second') END,
             claimed_at = NULL,
             last_error = $4,
             updated_at = NOW()
         WHERE id = $1`,
        [eventId, terminal ? "FAILED" : "RECEIVED", retrySeconds, String(errorMessage).slice(0, 1000)]
    );
}

export async function listWebhookEvents({ status, page, limit }) {
    const values = [];
    const filters = [];
    if (status) {
        values.push(status);
        filters.push(`status = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const offset = (page - 1) * limit;
    const pool = getDatabasePool();
    const events = await pool.query(
        `SELECT id, provider, event_type, event_key, status, attempts, max_attempts,
                last_error, next_attempt_at, processed_at, created_at, updated_at
         FROM webhook_events ${where}
         ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
    );
    const count = await pool.query(
        `SELECT COUNT(*)::integer AS total FROM webhook_events ${where}`,
        values
    );
    return { items: events.rows, total: count.rows[0].total };
}

export async function retryFailedWebhookEvent(eventId) {
    const result = await getDatabasePool().query(
        `UPDATE webhook_events
         SET status = 'RECEIVED', attempts = 0, max_attempts = GREATEST(max_attempts, 8),
             next_attempt_at = NOW(), claimed_at = NULL, processed_at = NULL,
             last_error = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'FAILED'
         RETURNING id, status`,
        [eventId]
    );
    return result.rows[0] ?? null;
}

export async function listAuditLogs({ action, page, limit }) {
    const values = [];
    const filters = [];
    if (action) {
        values.push(action);
        filters.push(`action = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const offset = (page - 1) * limit;
    const pool = getDatabasePool();
    const logs = await pool.query(
        `SELECT id, user_id, merchant_id, action, entity_type, entity_id, details, created_at
         FROM audit_logs ${where}
         ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
    );
    const count = await pool.query(
        `SELECT COUNT(*)::integer AS total FROM audit_logs ${where}`,
        values
    );
    return { items: logs.rows, total: count.rows[0].total };
}