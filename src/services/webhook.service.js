import { getDatabasePool } from "../database.js";

function parseResultCode(value) {
    if (Number.isInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value);
    return null;
}

export async function enqueueMpesaCallback(callback, metadata, rawPayload = { Body: { stkCallback: callback } }) {
    const checkoutRequestId = callback?.CheckoutRequestID;
    const resultCode = parseResultCode(callback?.ResultCode);
    if (typeof checkoutRequestId !== "string" || !checkoutRequestId || resultCode === null || !metadata || typeof metadata !== "object") {
        return { accepted: false, reason: "INVALID_CALLBACK" };
    }

    const eventKey = `mpesa:${checkoutRequestId}`;
    const result = await getDatabasePool().query(
        `INSERT INTO webhook_events (provider, event_type, event_key, payload, status, next_attempt_at)
         VALUES ('MPESA', 'STK_CALLBACK', $1, $2, 'RECEIVED', NOW())
         ON CONFLICT (event_key) DO NOTHING
         RETURNING id`,
        [eventKey, JSON.stringify({ callback, metadata, rawPayload })]
    );

    if (result.rowCount) {
        return { accepted: true, duplicate: false, eventId: result.rows[0].id, eventKey };
    }

    const existing = await getDatabasePool().query(
        "SELECT id, status FROM webhook_events WHERE event_key = $1",
        [eventKey]
    );
    return {
        accepted: true,
        duplicate: true,
        eventId: existing.rows[0]?.id,
        eventKey,
        status: existing.rows[0]?.status
    };
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