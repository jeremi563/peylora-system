import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "settlement-review-test-secret-at-least-32";

test("settlement review resolution is admin-audited and snapshots are immutable", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const merchantEmail = `settlement-review-${suffix}@example.test`;
    const adminEmail = `settlement-review-admin-${suffix}@example.test`;
    let merchantId;
    let adminUserId;
    let exceptionId;
    let matchId;

    try {
        const merchantUser = await pool.query(
            `INSERT INTO users (name, email, password_hash, email_verified)
             VALUES ('Settlement Review Merchant', $1, 'test-password-hash', true)
             RETURNING id`,
            [merchantEmail]
        );
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Settlement Review Shop', $2)
             RETURNING id`,
            [merchantUser.rows[0].id, merchantEmail]
        )).rows[0].id;
        adminUserId = (await pool.query(
            `INSERT INTO users (name, email, password_hash, role, email_verified)
             VALUES ('Settlement Review Admin', $1, 'test-password-hash', 'ADMIN', true)
             RETURNING id`,
            [adminEmail]
        )).rows[0].id;

        exceptionId = (await pool.query(
            `INSERT INTO settlement_reconciliation_exceptions (
                merchant_id, exception_type, status, evidence_json,
                conflict_fields
             )
             VALUES ($1, 'AMOUNT_MISMATCH', 'OPEN', $2, '["gross_amount"]')
             RETURNING id`,
            [
                merchantId,
                JSON.stringify({
                    sourceGrossAmount: "100.00",
                    providerReceivedAmount: "90.00"
                })
            ]
        )).rows[0].id;

        const payment = await pool.query(
            `INSERT INTO payments (
                merchant_id, reference, amount, phone_number, description, status
             )
             VALUES ($1, $2, 100, '254700001234', 'Review test', 'SUCCESS')
             RETURNING id`,
            [merchantId, `PAY-REVIEW-${suffix}`]
        );
        const attempt = await pool.query(
            `INSERT INTO transactions (
                payment_id, merchant_id, account_reference, amount,
                currency, phone_number, provider, status,
                mpesa_receipt_number
             )
             VALUES ($1, $2, $3, 100, 'KES', '254700001234',
                     'MPESA', 'SUCCESS', $4)
             RETURNING id`,
            [
                payment.rows[0].id,
                merchantId,
                `ACC-REVIEW-${suffix}`,
                `RCPT-REVIEW-${suffix}`
            ]
        );
        const providerTransaction = await pool.query(
            `INSERT INTO provider_transactions (
                merchant_id, attempt_transaction_id, provider, outcome,
                provider_reference, received_amount, currency,
                evidence_type, evidence_payload
             )
             VALUES ($1, $2, 'MPESA', 'SUCCESS', $3, 100, 'KES',
                     'CALLBACK', '{}')
             RETURNING id`,
            [
                merchantId,
                attempt.rows[0].id,
                `RCPT-REVIEW-${suffix}`
            ]
        );
        const line = await pool.query(
            `INSERT INTO settlement_lines (
                merchant_id, provider_reference, receipt_reference,
                currency, gross_amount, status, raw_values
             )
             VALUES ($1, $2, $2, 'KES', 100, 'CONFLICT', '{}')
             RETURNING id`,
            [merchantId, `RCPT-REVIEW-${suffix}`]
        );
        matchId = (await pool.query(
            `INSERT INTO settlement_matches (
                merchant_id, settlement_line_id, provider_transaction_id,
                match_state, confidence, evidence_json,
                conflict_fields
             )
             VALUES ($1, $2, $3, 'CONFLICT', 'CONFLICT', '{}', '["gross_amount"]')
             RETURNING id`,
            [merchantId, line.rows[0].id, providerTransaction.rows[0].id]
        )).rows[0].id;

        const reviewService = await import("../src/services/settlement-review.service.js");
        const resolvedException = await reviewService.resolveSettlementException({
            merchantId,
            exceptionId,
            operatorUserId: adminUserId,
            resolution: "RESOLVED",
            reason: "Provider and source evidence reviewed",
            supportingEvidence: "Receipt and received amount evidence retained"
        });
        assert.equal(resolvedException.status, "RESOLVED");

        const duplicateExceptionResolution = await reviewService.resolveSettlementException({
            merchantId,
            exceptionId,
            operatorUserId: adminUserId,
            resolution: "DISMISSED",
            reason: "Duplicate resolution attempt",
            supportingEvidence: "Existing resolution should remain unchanged"
        });
        assert.equal(duplicateExceptionResolution.duplicate, true);

        const resolvedMatch = await reviewService.resolveSettlementMatch({
            merchantId,
            matchId,
            operatorUserId: adminUserId,
            resolution: "CONFIRMED",
            reason: "The source receipt matches the provider receipt",
            supportingEvidence: "Receipt and amount evidence compared"
        });
        assert.equal(resolvedMatch.resolution_status, "CONFIRMED");

        const duplicateMatchResolution = await reviewService.resolveSettlementMatch({
            merchantId,
            matchId,
            operatorUserId: adminUserId,
            resolution: "DISMISSED",
            reason: "Duplicate resolution attempt",
            supportingEvidence: "Existing resolution should remain unchanged"
        });
        assert.equal(duplicateMatchResolution.duplicate, true);

        const snapshot = await reviewService.createSettlementReconciliationSnapshot({
            merchantId,
            runType: "FULL_RECONCILIATION",
            operatorUserId: adminUserId
        });
        assert.ok(snapshot.runId);
        assert.ok(snapshot.snapshotHash);

        const runs = await reviewService.listSettlementReconciliationRuns(merchantId);
        assert.equal(runs.length, 1);
        assert.equal(runs[0].status, "COMPLETED");
        assert.equal(runs[0].snapshot_hash, snapshot.snapshotHash);

        const audit = await pool.query(
            `SELECT COUNT(*)::integer AS count
             FROM audit_logs
             WHERE merchant_id = $1
               AND action IN (
                    'SETTLEMENT_EXCEPTION_RESOLVED',
                    'SETTLEMENT_MATCH_RESOLVED',
                    'SETTLEMENT_RECONCILIATION_SNAPSHOT_CREATED'
               )`,
            [merchantId]
        );
        assert.equal(audit.rows[0].count, 3);

        const exceptionState = await pool.query(
            `SELECT status, resolved_by_user_id, resolution_reason
             FROM settlement_reconciliation_exceptions
             WHERE id = $1`,
            [exceptionId]
        );
        assert.equal(exceptionState.rows[0].status, "RESOLVED");
        assert.equal(exceptionState.rows[0].resolved_by_user_id, adminUserId);
        assert.equal(exceptionState.rows[0].resolution_reason, "Provider and source evidence reviewed");

        const providerCount = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM provider_transactions WHERE merchant_id = $1",
            [merchantId]
        );
        assert.equal(providerCount.rows[0].count, 1);
    } finally {
        if (merchantId) {
            await pool.query("DELETE FROM settlement_reconciliation_snapshots WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_reconciliation_runs WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM audit_logs WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_matches WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_reconciliation_exceptions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_lines WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM provider_transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        }
        await pool.query("DELETE FROM users WHERE email IN ($1, $2)", [merchantEmail, adminEmail]).catch(() => {});
        await closeDatabase();
    }
});
