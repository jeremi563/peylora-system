import { Router } from "express";
import { getDatabasePool } from "../database.js";
import { getOperationalSnapshot } from "../services/webhook.service.js";

const router = Router();

async function handleHealthCheck(req, res) {
    const start = performance.now();
    const checks = {
        database: { status: "unknown" },
        system: {
            uptimeSeconds: Math.floor(process.uptime()),
            memoryUsage: {
                rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
                heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
            }
        }
    };

    let isHealthy = true;

    try {
        const pool = getDatabasePool();
        const dbStart = performance.now();
        await pool.query("SELECT 1");
        const operations = await getOperationalSnapshot();
        checks.database = {
            status: "up",
            latencyMs: Math.round((performance.now() - dbStart) * 100) / 100
        };
        checks.operations = operations;
        const failedWebhooks = operations.webhooks.find((row) => row.status === "FAILED")?.count ?? 0;
        const failedNotifications = operations.notifications.find((row) => row.status === "FAILED")?.count ?? 0;
        const reconciliationConflicts = operations.reconciliationConflicts[0]?.count ?? 0;
        const alertThreshold = Math.max(1, Number(process.env.OPERATION_ALERT_THRESHOLD || 1));
        if (
            failedWebhooks >= alertThreshold
            || failedNotifications >= alertThreshold
            || reconciliationConflicts >= alertThreshold
        ) {
            isHealthy = false;
            checks.operations.alert = "REVIEW_REQUIRED";
        }
    } catch (error) {
        isHealthy = false;
        checks.database = {
            status: "down",
            error: error.message
        };
    }

    const responsePayload = {
        status: isHealthy ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
        version: "1.0.0",
        durationMs: Math.round((performance.now() - start) * 100) / 100,
        checks
    };

    const statusCode = isHealthy ? 200 : 503;
    return res.status(statusCode).json(responsePayload);
}

router.get("/health", handleHealthCheck);
router.get("/api/health", handleHealthCheck);

export default router;
