import { Router } from "express";
import { getDatabasePool } from "../database.js";

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
        checks.database = {
            status: "up",
            latencyMs: Math.round((performance.now() - dbStart) * 100) / 100
        };
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
