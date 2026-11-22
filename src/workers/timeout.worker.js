import "dotenv/config";

import { closeDatabase, connectDatabase } from "../database.js";
import { markExpiredPendingAttempts } from "../services/transaction.service.js";

const timeoutSeconds = Math.max(30, Number(process.env.PAYMENT_TIMEOUT_SECONDS || 900));
const pollIntervalMs = Math.max(250, Number(process.env.PAYMENT_TIMEOUT_POLL_INTERVAL_MS || 30_000));
const batchSize = Math.max(1, Number(process.env.PAYMENT_TIMEOUT_BATCH_SIZE || 100));
let stopping = false;

async function runWorker() {
    await connectDatabase();
    console.info("Payment timeout worker started");

    while (!stopping) {
        try {
            const timedOut = await markExpiredPendingAttempts({
                timeoutSeconds,
                limit: batchSize
            });
            if (timedOut > 0) {
                console.info("Payment attempts timed out:", { timedOut });
            }
        } catch (error) {
            console.error("Payment timeout batch failed:", error.message);
        }

        if (!stopping) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
    }

    await closeDatabase();
    console.info("Payment timeout worker stopped");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        stopping = true;
    });
}

runWorker().catch(async (error) => {
    await closeDatabase();
    process.exitCode = 1;
});
