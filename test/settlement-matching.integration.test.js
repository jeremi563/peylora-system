import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "settlement-matching-test-secret-at-least-32";

test("settlement matching creates exact, conflict and missing evidence outcomes", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const email = `settlement-matching-${suffix}@example.test`;
    let merchantId;
    let importId;
    let exactLineId;
    let conflictLineId;
    let missingLineId;

    try {
        const user = await pool.query(
            `INSERT INTO users (name, email, password_hash, email_verified)
             VALUES ('Settlement Matching Merchant', $1, 'test-password-hash', true)
             RETURNING id`,
            [email]
        );
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Settlement Matching Shop', $2)
             RETURNING id`,
            [user.rows[0].id, email]
        )).rows[0].id;
        const profile = await pool.query(
            `SELECT id FROM settlement_source_profiles
             WHERE code = 'PEYLORA_GENERIC_CSV_V1'`
        );
        importId = (await pool.query(
            `INSERT INTO settlement_evidence_imports (
                merchant_id, profile_id, status, original_filename, mime_type,
                size_bytes, sha256, original_bytes, parsed_row_count, completed_at
             )
             VALUES ($1, $2, 'VALIDATED', 'matching.csv', 'text/csv',
                     100, $3, $4, 3, NOW())
             RETURNING id`,
            [
                merchantId,
                profile.rows[0].id,
                randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
                Buffer.from("provider_reference,gross_amount\nRCPT-MATCH-1,100")
            ]
        )).rows[0].id;

        const payment = await pool.query(
            `INSERT INTO payments (
                merchant_id, reference, amount, phone_number, description, status
             )
             VALUES ($1, $2, 100, '254700001234', 'Matching test', 'SUCCESS')
             RETURNING id`,
            [merchantId, `PAY-MATCH-${suffix}`]
        );
        const attempt = await pool.query(
            `INSERT INTO transactions (
                payment_id, merchant_id, account_reference, amount,
                currency, phone_number, provider, status,
                mpesa_receipt_number, provider_transaction_date
             )
             VALUES ($1, $2, $3, 100, 'KES', '254700001234',
                     'MPESA', 'SUCCESS', $4, '20261101000000')
             RETURNING id`,
            [
                payment.rows[0].id,
                merchantId,
                `ACC-MATCH-${suffix}`,
                `RCPT-EXACT-${suffix}`
            ]
        );
        await pool.query(
            `INSERT INTO provider_transactions (
                merchant_id, attempt_transaction_id, provider, outcome,
                provider_reference, received_amount, currency,
                evidence_type, evidence_payload
             )
             VALUES ($1, $2, 'MPESA', 'SUCCESS', $3, 100, 'KES',
                     'CALLBACK', '{}')`,
            [
                merchantId,
                attempt.rows[0].id,
                `RCPT-EXACT-${suffix}`
            ]
        );

        exactLineId = (await pool.query(
            `INSERT INTO settlement_lines (
                merchant_id, evidence_import_id, provider_reference,
                receipt_reference, transaction_date, currency,
                gross_amount, status, raw_values
             )
             VALUES ($1, $2, $3, $3, '2026-11-01', 'KES', 100,
                     'SETTLED', '{}')
             RETURNING id`,
            [merchantId, importId, `RCPT-EXACT-${suffix}`]
        )).rows[0].id;
        const exactEvidence = await pool.query(
            `SELECT t.provider_transaction_date, pt.received_amount, pt.currency
             FROM provider_transactions pt
             JOIN transactions t ON t.id = pt.attempt_transaction_id
             WHERE pt.merchant_id = $1`,
            [merchantId]
        );
        assert.equal(exactEvidence.rows[0].provider_transaction_date, "20261101000000");

        conflictLineId = (await pool.query(
            `INSERT INTO settlement_lines (
                merchant_id, evidence_import_id, provider_reference,
                receipt_reference, transaction_date, currency,
                gross_amount, status, raw_values
             )
             VALUES ($1, $2, $3, $3, '2026-11-02', 'KES', 150,
                     'CONFLICT', '{}')
             RETURNING id`,
            [merchantId, importId, `RCPT-EXACT-${suffix}`]
        )).rows[0].id;

        missingLineId = (await pool.query(
            `INSERT INTO settlement_lines (
                merchant_id, evidence_import_id, provider_reference,
                transaction_date, currency, gross_amount,
                status, raw_values
             )
             VALUES ($1, $2, $3, '2026-11-01', 'KES', 75,
                     'UNKNOWN', '{}')
             RETURNING id`,
            [merchantId, importId, `RCPT-MISSING-${suffix}`]
        )).rows[0].id;

        const matchingService = await import("../src/services/settlement-matching.service.js");
        const results = await matchingService.runSettlementLineMatching({
            merchantId,
            importId
        });

        const exactResult = results.find((result) => result.settlementLineId === exactLineId);
        assert.equal(exactResult.result, "SYSTEM_EXACT", JSON.stringify(results));
        assert.equal(results.find((result) => result.settlementLineId === conflictLineId).result, "CONFLICT");
        assert.equal(
            results.find((result) => result.settlementLineId === missingLineId).result,
            "MISSING_PROVIDER_TRANSACTION"
        );

        const exactMatches = await pool.query(
            `SELECT match_state, provider_transaction_id
             FROM settlement_matches
             WHERE merchant_id = $1 AND settlement_line_id = $2`,
            [merchantId, exactLineId]
        );
        assert.equal(exactMatches.rows.length, 1);
        assert.equal(exactMatches.rows[0].match_state, "SYSTEM_EXACT");

        const conflictMatches = await pool.query(
            `SELECT match_state, conflict_fields
             FROM settlement_matches
             WHERE merchant_id = $1 AND settlement_line_id = $2`,
            [merchantId, conflictLineId]
        );
        assert.equal(conflictMatches.rows.length, 1);
        assert.equal(conflictMatches.rows[0].match_state, "CONFLICT");
        assert.ok(conflictMatches.rows[0].conflict_fields.includes("gross_amount"));

        const missingException = await pool.query(
            `SELECT exception_type
             FROM settlement_reconciliation_exceptions
             WHERE merchant_id = $1 AND settlement_line_id = $2`,
            [merchantId, missingLineId]
        );
        assert.equal(missingException.rows[0].exception_type, "MISSING_PROVIDER_TRANSACTION");

        const providerCount = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM provider_transactions WHERE merchant_id = $1",
            [merchantId]
        );
        assert.equal(providerCount.rows[0].count, 1);
    } finally {
        if (merchantId) {
            await pool.query("DELETE FROM settlement_reconciliation_exceptions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_matches WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_lines WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM provider_transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_evidence_rows WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_evidence_imports WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        }
        await pool.query("DELETE FROM users WHERE email = $1", [email]).catch(() => {});
        await closeDatabase();
    }
});
