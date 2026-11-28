import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import "dotenv/config";

process.env.NODE_ENV = "test";

test("worker recovery retains failed work, expires leases, and audits operator retry", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const email = `worker-recovery-${suffix}@example.test`;
    let adminUserId;
    let webhookEventId;
    let notificationId;

    try {
        adminUserId = (await pool.query(
            `INSERT INTO users (name, email, password_hash, role, email_verified)
             VALUES ('Worker Recovery Admin', $1, 'test-password-hash', 'ADMIN', true)
             RETURNING id`,
            [email]
        )).rows[0].id;

        webhookEventId = (await pool.query(
            `INSERT INTO webhook_events (
                provider, event_type, event_key, payload, status,
                attempts, max_attempts, last_error, next_attempt_at
             )
             VALUES ('MPESA', 'STK_CALLBACK', $1, $2, 'FAILED',
                     8, 8, 'Maximum attempts exceeded', NOW())
             RETURNING id`,
            [
                `worker-recovery:${suffix}`,
                JSON.stringify({
                    callback: { CheckoutRequestID: `CHECKOUT-WORKER-${suffix}`, ResultCode: 1032 },
                    metadata: {}
                })
            ]
        )).rows[0].id;

        notificationId = (await pool.query(
            `INSERT INTO notifications (
                user_id, type, channel, payload, recipient_email, subject, body,
                delivery_status, attempts, next_attempt_at, claimed_at
             )
             VALUES ($1, 'PAYMENT_STATUS', 'EMAIL', $2, $3,
                     'Worker recovery test', 'Test body',
                     'PROCESSING', 1, NOW() - INTERVAL '1 minute',
                     NOW() - INTERVAL '10 minutes')
             RETURNING id`,
            [
                adminUserId,
                JSON.stringify({ title: "Worker recovery test" }),
                email
            ]
        )).rows[0].id;

        const notificationService = await import("../src/services/notification.service.js");
        const claimed = await notificationService.claimEmailNotifications(100, 30);
        const leasedState = await pool.query(
            `SELECT id, delivery_status, attempts, claimed_at, next_attempt_at
             FROM notifications WHERE id = $1`,
            [notificationId]
        );
        assert.equal(leasedState.rowCount, 1, JSON.stringify(leasedState.rows));
        assert.equal(
            claimed.filter((job) => job.id === notificationId).length,
            1,
            JSON.stringify({ claimed, leasedState: leasedState.rows })
        );

        const webhookService = await import("../src/services/webhook.service.js");
        const snapshotBeforeRetry = await webhookService.getOperationalSnapshot();
        assert.ok(snapshotBeforeRetry.webhooks.find((row) => row.status === "FAILED"));

        const firstRetry = await webhookService.retryFailedWebhookEvent(
            webhookEventId,
            adminUserId,
            "The provider callback was reviewed and may be retried",
            "Supporting provider reconciliation evidence"
        );
        assert.equal(firstRetry.status, "RECEIVED");
        const duplicateRetry = await webhookService.retryFailedWebhookEvent(
            webhookEventId,
            adminUserId,
            "The provider callback was reviewed and may be retried",
            "Supporting provider reconciliation evidence"
        );
        assert.equal(duplicateRetry.status, "RECEIVED");

        const auditCount = await pool.query(
            `SELECT COUNT(*)::integer AS count
             FROM audit_logs
             WHERE event_key = $1`,
            [`operator-webhook-retry:${webhookEventId}`]
        );
        assert.equal(auditCount.rows[0].count, 1);

        const retriedEvent = await pool.query(
            `SELECT status, attempts, last_error
             FROM webhook_events
             WHERE id = $1`,
            [webhookEventId]
        );
        assert.equal(retriedEvent.rows[0].status, "RECEIVED");
        assert.equal(retriedEvent.rows[0].attempts, 0);
        assert.equal(retriedEvent.rows[0].last_error, null);
    } finally {
        if (notificationId) {
            await pool.query("DELETE FROM notifications WHERE id = $1", [notificationId]).catch(() => {});
        }
        if (webhookEventId) {
            await pool.query("DELETE FROM audit_logs WHERE entity_id = $1", [webhookEventId]).catch(() => {});
            await pool.query("DELETE FROM webhook_events WHERE id = $1", [webhookEventId]).catch(() => {});
        }
        if (adminUserId) {
            await pool.query("DELETE FROM users WHERE id = $1", [adminUserId]).catch(() => {});
        }
        await closeDatabase();
    }
});
