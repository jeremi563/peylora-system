import "dotenv/config";

import { closeDatabase, connectDatabase } from "../database.js";
import {
    claimEmailNotifications,
    markEmailNotificationDelivered,
    markEmailNotificationFailed
} from "../services/notification.service.js";
import { sendNotificationEmail } from "../services/email.service.js";

const batchSize = Math.max(1, Number(process.env.NOTIFICATION_BATCH_SIZE || 10));
const pollIntervalMs = Math.max(250, Number(process.env.NOTIFICATION_POLL_INTERVAL_MS || 2_000));
const maxAttempts = Math.max(1, Number(process.env.NOTIFICATION_MAX_ATTEMPTS || 8));
const leaseSeconds = Math.max(30, Number(process.env.NOTIFICATION_LEASE_SECONDS || 300));
let stopping = false;
let activeBatch;

async function processBatch() {
    const jobs = await claimEmailNotifications(batchSize, leaseSeconds);
    for (const job of jobs) {
        try {
            await sendNotificationEmail({
                to: job.recipient_email,
                subject: job.subject,
                text: job.body
            });
            await markEmailNotificationDelivered(job.id);
        } catch (error) {
            await markEmailNotificationFailed(job.id, job.attempts, error.message, maxAttempts);
            console.error("Notification delivery failed:", {
                notificationId: job.id,
                attempts: job.attempts,
                error: error.message
            });
        }
    }
}

async function runWorker() {
    await connectDatabase();
    console.info("Notification worker started");

    while (!stopping) {
        activeBatch = processBatch();
        try {
            await activeBatch;
        } catch (error) {
            console.error("Notification worker batch failed:", error.message);
        }
        activeBatch = undefined;

        if (!stopping) {
            await new Promise((resolve) => {
                setTimeout(resolve, pollIntervalMs);
            });
        }
    }

    await closeDatabase();
    console.info("Notification worker stopped");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        stopping = true;
    });
}

runWorker().catch(async (error) => {
    console.error("Could not start notification worker:", error.message);
    await closeDatabase();
    process.exitCode = 1;
});