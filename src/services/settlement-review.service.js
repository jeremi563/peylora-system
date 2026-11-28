import { createHash } from "node:crypto";

import { getDatabasePool } from "../database.js";

export class SettlementReviewValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "SettlementReviewValidationError";
    }
}

function canonicalJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) =>
            `${JSON.stringify(key)}:${canonicalJson(value[key])}`
        ).join(",")}}`;
    }
    return JSON.stringify(value);
}

export async function resolveSettlementException({
    merchantId,
    exceptionId,
    operatorUserId,
    resolution,
    reason,
    supportingEvidence
}) {
    if (!["RESOLVED", "DISMISSED"].includes(resolution)) {
        throw new SettlementReviewValidationError("resolution must be RESOLVED or DISMISSED");
    }
    if (String(reason ?? "").trim().length < 8) {
        throw new SettlementReviewValidationError("reason must be at least 8 characters");
    }
    if (String(supportingEvidence ?? "").trim().length < 1) {
        throw new SettlementReviewValidationError("supportingEvidence is required");
    }

    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const exception = await client.query(
            `SELECT id, merchant_id, settlement_line_id, settlement_batch_id,
                    bank_deposit_id, exception_type, status, evidence_json,
                    conflict_fields, created_at
             FROM settlement_reconciliation_exceptions
             WHERE id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [exceptionId, merchantId]
        );
        if (!exception.rowCount) {
            await client.query("ROLLBACK");
            return null;
        }

        const eventKey = `settlement-exception-resolution:${merchantId}:${exceptionId}`;
        const existingAudit = await client.query(
            `SELECT id
             FROM audit_logs
             WHERE event_key = $1
             FOR UPDATE`,
            [eventKey]
        );
        const existing = exception.rows[0];
        if (existing.status === "OPEN") {
            await client.query(
                `UPDATE settlement_reconciliation_exceptions
                 SET status = $2, resolved_by_user_id = $3,
                     resolution_reason = $4, resolved_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND merchant_id = $5 AND status = 'OPEN'`,
                [exceptionId, resolution, operatorUserId, reason, merchantId]
            );
        }
        if (!existingAudit.rowCount) {
            await client.query(
                `INSERT INTO audit_logs (
                    user_id, merchant_id, action, entity_type, entity_id, details, event_key
                 )
                 VALUES ($1, $2, 'SETTLEMENT_EXCEPTION_RESOLVED',
                         'SETTLEMENT_RECONCILIATION_EXCEPTION', $3, $4, $5)
                 ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
                [
                    operatorUserId,
                    merchantId,
                    exceptionId,
                    JSON.stringify({
                        resolution,
                        reason,
                        supportingEvidence,
                        exceptionType: existing.exception_type,
                        originalStatus: existing.status
                    }),
                    eventKey
                ]
            );
        }
        await client.query("COMMIT");
        return {
            id: existing.id,
            status: resolution,
            duplicate: existing.status !== "OPEN"
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function resolveSettlementMatch({
    merchantId,
    matchId,
    operatorUserId,
    resolution,
    reason,
    supportingEvidence
}) {
    if (!["CONFIRMED", "DISMISSED"].includes(resolution)) {
        throw new SettlementReviewValidationError("resolution must be CONFIRMED or DISMISSED");
    }
    if (String(reason ?? "").trim().length < 8) {
        throw new SettlementReviewValidationError("reason must be at least 8 characters");
    }
    if (String(supportingEvidence ?? "").trim().length < 1) {
        throw new SettlementReviewValidationError("supportingEvidence is required");
    }

    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const match = await client.query(
            `SELECT id, merchant_id, settlement_line_id, provider_transaction_id,
                    settlement_batch_id, bank_deposit_id, match_state,
                    confidence, evidence_json, conflict_fields,
                    resolution_status
             FROM settlement_matches
             WHERE id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [matchId, merchantId]
        );
        if (!match.rowCount) {
            await client.query("ROLLBACK");
            return null;
        }

        const existing = match.rows[0];
        const eventKey = `settlement-match-resolution:${merchantId}:${matchId}`;
        const existingAudit = await client.query(
            `SELECT id
             FROM audit_logs
             WHERE event_key = $1
             FOR UPDATE`,
            [eventKey]
        );
        if (existing.resolution_status === "OPEN") {
            await client.query(
                `UPDATE settlement_matches
                 SET match_state = $2,
                     confidence = $3,
                     resolution_status = $4,
                     resolution_reason = $5,
                     resolved_by_user_id = $6,
                     resolved_at = NOW(),
                     operator_user_id = $6,
                     reason = $5,
                     updated_at = NOW()
                 WHERE id = $1 AND merchant_id = $7`,
                [
                    matchId,
                    resolution === "CONFIRMED" ? "OPERATOR_CONFIRMED" : "CONFLICT",
                    resolution === "CONFIRMED" ? "OPERATOR" : "CONFLICT",
                    resolution === "CONFIRMED" ? "CONFIRMED" : "DISMISSED",
                    reason,
                    operatorUserId,
                    merchantId
                ]
            );
        }
        if (!existingAudit.rowCount) {
            await client.query(
                `INSERT INTO audit_logs (
                    user_id, merchant_id, action, entity_type, entity_id, details, event_key
                 )
                 VALUES ($1, $2, 'SETTLEMENT_MATCH_RESOLVED',
                         'SETTLEMENT_MATCH', $3, $4, $5)
                 ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
                [
                    operatorUserId,
                    merchantId,
                    matchId,
                    JSON.stringify({
                        resolution,
                        reason,
                        supportingEvidence,
                        originalMatchState: existing.match_state
                    }),
                    eventKey
                ]
            );
        }
        await client.query("COMMIT");
        return {
            id: existing.id,
            resolution_status: resolution === "CONFIRMED" ? "CONFIRMED" : "DISMISSED",
            duplicate: existing.resolution_status !== "OPEN"
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function createSettlementReconciliationSnapshot({
    merchantId,
    runType,
    operatorUserId
}) {
    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const run = await client.query(
            `INSERT INTO settlement_reconciliation_runs (
                merchant_id, run_type, status, started_at
             )
             VALUES ($1, $2, 'RUNNING', NOW())
             RETURNING id`,
            [merchantId, runType]
        );
        const runId = run.rows[0].id;
        const batches = await client.query(
                `SELECT * FROM settlement_batches
                 WHERE merchant_id = $1
                 ORDER BY created_at`,
                [merchantId]
            );
        const lines = await client.query(
                `SELECT * FROM settlement_lines
                 WHERE merchant_id = $1
                 ORDER BY created_at`,
                [merchantId]
            );
        const matches = await client.query(
                `SELECT * FROM settlement_matches
                 WHERE merchant_id = $1
                 ORDER BY created_at`,
                [merchantId]
            );
        const exceptions = await client.query(
                `SELECT * FROM settlement_reconciliation_exceptions
                 WHERE merchant_id = $1
                 ORDER BY created_at`,
                [merchantId]
            );
        const snapshot = {
            merchantId,
            runId,
            capturedAt: new Date().toISOString(),
            batches: batches.rows,
            lines: lines.rows,
            matches: matches.rows,
            exceptions: exceptions.rows
        };
        const snapshotJson = canonicalJson(snapshot);
        const snapshotHash = createHash("sha256").update(snapshotJson).digest("hex");
        const evidenceHash = createHash("sha256")
            .update(JSON.stringify({
                runId,
                merchantId,
                batchCount: batches.rows.length,
                lineCount: lines.rows.length,
                matchCount: matches.rows.length,
                exceptionCount: exceptions.rows.length
            }))
            .digest("hex");
        await client.query(
            `INSERT INTO settlement_reconciliation_snapshots (
                merchant_id, run_id, snapshot_hash, snapshot_json
             )
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (merchant_id, run_id, snapshot_hash) DO NOTHING`,
            [merchantId, runId, snapshotHash, JSON.stringify(snapshot)]
        );
        await client.query(
            `UPDATE settlement_reconciliation_runs
             SET status = 'COMPLETED', completed_at = NOW(),
                 evidence_hash = $2, snapshot_hash = $3,
                 summary = $4, updated_at = NOW()
             WHERE id = $1`,
            [
                runId,
                evidenceHash,
                snapshotHash,
                JSON.stringify({
                    batchCount: batches.rows.length,
                    lineCount: lines.rows.length,
                    matchCount: matches.rows.length,
                    exceptionCount: exceptions.rows.length
                })
            ]
        );
        await client.query(
            `INSERT INTO audit_logs (
                user_id, merchant_id, action, entity_type, entity_id, details, event_key
             )
             VALUES ($1, $2, 'SETTLEMENT_RECONCILIATION_SNAPSHOT_CREATED',
                     'SETTLEMENT_RECONCILIATION_RUN', $3, $4, $5)
             ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
            [
                operatorUserId,
                merchantId,
                runId,
                JSON.stringify({ snapshotHash, evidenceHash }),
                `settlement-snapshot:${merchantId}:${runId}:${snapshotHash}`
            ]
        );
        await client.query("COMMIT");
        return {
            runId,
            snapshotHash,
            evidenceHash,
            summary: {
                batchCount: batches.rows.length,
                lineCount: lines.rows.length,
                matchCount: matches.rows.length,
                exceptionCount: exceptions.rows.length
            }
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function listSettlementReconciliationRuns(merchantId) {
    const result = await getDatabasePool().query(
        `SELECT r.id, r.run_type, r.status, r.started_at, r.completed_at,
                r.evidence_hash, r.snapshot_hash, r.summary,
                s.id AS snapshot_id, s.created_at AS snapshot_created_at
         FROM settlement_reconciliation_runs r
         LEFT JOIN settlement_reconciliation_snapshots s
           ON s.run_id = r.id AND s.merchant_id = r.merchant_id
         WHERE r.merchant_id = $1
         ORDER BY r.created_at DESC`,
        [merchantId]
    );
    return result.rows;
}
