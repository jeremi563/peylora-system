import { getDatabasePool } from "../database.js";

export async function recordPaymentNotifications(client, {
    eventKey,
    userId,
    email,
    businessName,
    status,
    reference,
    requestedAmount,
    paidAmount,
    amountMatches,
    receiptNumber
}) {
    if (!userId) return;

    const title = status === "SUCCESS" && amountMatches === false
        ? "Payment amount requires review"
        : `Payment ${status.toLowerCase()}`;
    const payload = {
        title,
        status,
        reference,
        requestedAmount,
        paidAmount: paidAmount ?? null,
        amountMatches: amountMatches ?? null,
        receiptNumber: receiptNumber ?? null
    };
    const message = status === "SUCCESS" && amountMatches === false
        ? `Payment ${reference} reported KES ${paidAmount}, different from the requested KES ${requestedAmount}. Review this payment.`
        : `Payment ${reference} is ${status.toLowerCase()}${paidAmount == null ? "" : ` for KES ${paidAmount}`}${receiptNumber ? `. M-Pesa receipt: ${receiptNumber}` : ""}.`;

    await client.query(
        `INSERT INTO notifications (user_id, type, channel, payload, event_key, delivery_status, sent_at)
         VALUES ($1, 'PAYMENT_STATUS', 'IN_APP', $2, $3, 'DELIVERED', NOW())
         ON CONFLICT (event_key, channel) WHERE event_key IS NOT NULL DO NOTHING`,
        [userId, JSON.stringify(payload), eventKey]
    );

    if (email) {
        await client.query(
            `INSERT INTO notifications (
                user_id, type, channel, payload, event_key, recipient_email, subject, body,
                delivery_status, next_attempt_at
             )
             VALUES ($1, 'PAYMENT_STATUS', 'EMAIL', $2, $3, $4, $5, $6, 'PENDING', NOW())
             ON CONFLICT (event_key, channel) WHERE event_key IS NOT NULL DO NOTHING`,
            [userId, JSON.stringify({ ...payload, businessName }), eventKey, email, title, message]
        );
    }
}

export async function listUserNotifications(userId, { page, limit, unreadOnly }) {
    const pool = getDatabasePool();
    const filters = ["user_id = $1", "channel = 'IN_APP'"];
    if (unreadOnly) filters.push("read_at IS NULL");
    const where = filters.join(" AND ");
    const offset = (page - 1) * limit;
    const [items, counts] = await Promise.all([
        pool.query(
            `SELECT id, type, payload, read_at, created_at
             FROM notifications
             WHERE ${where}
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        ),
        pool.query(
                `SELECT COUNT(*) FILTER (
                    WHERE channel = 'IN_APP' AND ($2::boolean = false OR read_at IS NULL)
                    )::integer AS total,
                    COUNT(*) FILTER (WHERE channel = 'IN_APP' AND read_at IS NULL)::integer AS unread
             FROM notifications
             WHERE user_id = $1`,
                [userId, unreadOnly]
        )
    ]);

    return {
        items: items.rows,
        total: counts.rows[0].total,
        unread: counts.rows[0].unread
    };
}

export async function markNotificationRead(userId, notificationId) {
    const result = await getDatabasePool().query(
        `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
         WHERE id = $1 AND user_id = $2 AND channel = 'IN_APP'
         RETURNING id, read_at`,
        [notificationId, userId]
    );
    return result.rows[0] ?? null;
}

export async function markAllNotificationsRead(userId) {
    const result = await getDatabasePool().query(
        `UPDATE notifications SET read_at = NOW()
         WHERE user_id = $1 AND channel = 'IN_APP' AND read_at IS NULL`,
        [userId]
    );
    return result.rowCount;
}

export async function claimEmailNotifications(limit = 10, leaseSeconds = 300) {
    const client = await getDatabasePool().connect();
    try {
        await client.query("BEGIN");
        const selected = await client.query(
            `SELECT id, recipient_email, subject, body, attempts
             FROM notifications
             WHERE channel = 'EMAIL'
               AND delivery_status IN ('PENDING', 'PROCESSING')
               AND next_attempt_at <= NOW()
             ORDER BY created_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED`,
            [limit]
        );
        const jobs = [];
        for (const row of selected.rows) {
            const updated = await client.query(
                `UPDATE notifications
                 SET delivery_status = 'PROCESSING', attempts = attempts + 1,
                     next_attempt_at = NOW() + ($2 * INTERVAL '1 second')
                 WHERE id = $1
                 RETURNING id, recipient_email, subject, body, attempts`,
                [row.id, leaseSeconds]
            );
            jobs.push(updated.rows[0]);
        }
        await client.query("COMMIT");
        return jobs;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function markEmailNotificationDelivered(notificationId) {
    await getDatabasePool().query(
        `UPDATE notifications
         SET delivery_status = 'DELIVERED', sent_at = NOW(), next_attempt_at = NULL, last_error = NULL
         WHERE id = $1 AND channel = 'EMAIL'`,
        [notificationId]
    );
}

export async function markEmailNotificationFailed(notificationId, attempts, errorMessage, maxAttempts) {
    const terminal = attempts >= maxAttempts;
    const retrySeconds = Math.min(3600, 15 * (2 ** Math.min(attempts - 1, 8)));
    await getDatabasePool().query(
        `UPDATE notifications
         SET delivery_status = $2,
             next_attempt_at = CASE WHEN $2 = 'FAILED' THEN NULL ELSE NOW() + ($3 * INTERVAL '1 second') END,
             last_error = $4
         WHERE id = $1 AND channel = 'EMAIL'`,
        [notificationId, terminal ? "FAILED" : "PENDING", retrySeconds, String(errorMessage).slice(0, 1000)]
    );
}