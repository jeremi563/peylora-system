import "dotenv/config";

import { closeDatabase, connectDatabase } from "../database.js";
import { applyMpesaCallback } from "../services/transaction.service.js";
import {
    claimWebhookEvents,
    retryWebhookEvent
} from "../services/webhook.service.js";

const batchSize = Math.max(1, Number(process.env.WEBHOOK_BATCH_SIZE || 20));
const pollIntervalMs = Math.max(250, Number(process.env.WEBHOOK_POLL_INTERVAL_MS || 1_000));
const leaseSeconds = Math.max(30, Number(process.env.WEBHOOK_LEASE_SECONDS || 300));
let stopping = false;

async function processEvent(event) {
    if (event.provider !== "MPESA" || event.event_type !== "STK_CALLBACK") {
        throw new Error(`Unsupported webhook event ${event.provider}:${event.event_type}`);
    }

    const result = await applyMpesaCallback(event.payload.callback, event.payload.metadata);
    if (result.storedForRetry) {
        await retryWebhookEvent(
            event.id,
            event.attempts,
            event.max_attempts,
            "Waiting for the matching STK transaction to be associated"
        );
        return;
    }

    if (!result.matched) {
        throw new Error(result.reason || "Webhook callback could not be matched");
    }

    console.info("Webhook event processed:", {
        eventId: event.id,
        status: result.status,
        duplicate: result.duplicate === true
    });
}

async function runWorker() {
    await connectDatabase();
    console.info("Webhook worker started");

    while (!stopping) {
        try {
            const events = await claimWebhookEvents(batchSize, leaseSeconds);
            for (const event of events) {
                try {
                    await processEvent(event);
                } catch (error) {
                    await retryWebhookEvent(event.id, event.attempts, event.max_attempts, error.message);
                    console.error("Webhook event processing failed:", {
                        eventId: event.id,
                        attempts: event.attempts,
                        error: error.message
                    });
                }
            }
        } catch (error) {
            console.error("Webhook worker batch failed:", error.message);
        }

        if (!stopping) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
    }

    await closeDatabase();
    console.info("Webhook worker stopped");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        stopping = true;
    });
}

runWorker().catch(async (error) => {
    console.error("Could not start webhook worker:", error.message);
    await closeDatabase();
    process.exitCode = 1;
});