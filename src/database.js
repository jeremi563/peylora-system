import pg from "pg";

const { Pool } = pg;

let pool;

export async function connectDatabase() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is not configured");
    }

    const isCloudPostgres = connectionString.includes("supabase.co") ||
        connectionString.includes("pooler.supabase.com") ||
        connectionString.includes("sslmode=require");
    const useSsl = process.env.DATABASE_SSL === "true" || (isCloudPostgres && process.env.DATABASE_SSL !== "false");

    pool = new Pool({
        connectionString,
        max: Number(process.env.DATABASE_POOL_MAX || 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        ...(useSsl ? {
            ssl: {
                rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true"
            }
        } : {})
    });

    pool.on("error", (error) => {
        console.error("Unexpected PostgreSQL pool error:", error.message);
    });

    try {
        await pool.query("SELECT 1");
    } catch (error) {
        await pool.end();
        pool = undefined;
        throw error;
    }
}

export function getDatabasePool() {
    if (!pool) {
        throw new Error("PostgreSQL is not connected");
    }

    return pool;
}

export async function closeDatabase() {
    if (pool) {
        await pool.end();
        pool = undefined;
    }
}