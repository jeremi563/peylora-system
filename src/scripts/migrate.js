import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";

import { closeDatabase, connectDatabase, getDatabasePool } from "../database.js";

const migrationsDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));
const migrationLockId = 724193850;

async function runMigrations() {
    await connectDatabase();
    const client = await getDatabasePool().connect();

    try {
        await client.query("SELECT pg_advisory_lock($1)", [migrationLockId]);
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT NOW()
            )
        `);

        const files = (await readdir(migrationsDirectory))
            .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
            .sort();

        for (const file of files) {
            const applied = await client.query(
                "SELECT 1 FROM schema_migrations WHERE name = $1",
                [file]
            );
            if (applied.rowCount) {
                continue;
            }

            const sql = await readFile(join(migrationsDirectory, file), "utf8");
            await client.query("BEGIN");
            try {
                await client.query(sql);
                await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
                await client.query("COMMIT");
                console.info(`Applied database migration: ${file}`);
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            }
        }
    } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [migrationLockId]);
        client.release();
        await closeDatabase();
    }
}

runMigrations().catch(async (error) => {
    console.error("Database migration failed:", error.message);
    await closeDatabase();
    process.exitCode = 1;
});