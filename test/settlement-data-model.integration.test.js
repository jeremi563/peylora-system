import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import "dotenv/config";

process.env.NODE_ENV = "test";

test("settlement data model preserves merchant-scoped immutable evidence", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const merchantEmail = `settlement-model-${suffix}@example.test`;
    const otherEmail = `settlement-model-other-${suffix}@example.test`;
    let merchantId;
    let otherMerchantId;
    let importId;
    let rowId;
    let batchId;
    let lineId;
    let depositId;
    let adjustmentId;

    try {
        const merchantUser = await pool.query(
            `INSERT INTO users (name, email, password_hash, email_verified)
             VALUES ('Settlement Model Merchant', $1, 'test-password-hash', true)
             RETURNING id`,
            [merchantEmail]
        );
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Settlement Model Shop', $2)
             RETURNING id`,
            [merchantUser.rows[0].id, merchantEmail]
        )).rows[0].id;

        const otherUser = await pool.query(
            `INSERT INTO users (name, email, password_hash, email_verified)
             VALUES ('Other Settlement Model Merchant', $1, 'test-password-hash', true)
             RETURNING id`,
            [otherEmail]
        );
        otherMerchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Other Settlement Model Shop', $2)
             RETURNING id`,
            [otherUser.rows[0].id, otherEmail]
        )).rows[0].id;

        const profile = await pool.query(
            `SELECT id FROM settlement_source_profiles
             WHERE code = 'PEYLORA_GENERIC_CSV_V1'`
        );
        const originalBytes = Buffer.from("provider_reference,gross_amount\nRCPT-MODEL-1,100.00");
        importId = (await pool.query(
            `INSERT INTO settlement_evidence_imports (
                merchant_id, profile_id, status, original_filename, mime_type,
                size_bytes, sha256, original_bytes, parsed_row_count, completed_at
             )
             VALUES ($1, $2, 'VALIDATED', 'model.csv', 'text/csv',
                     $3, $4, $5, 1, NOW())
             RETURNING id`,
            [
                merchantId,
                profile.rows[0].id,
                originalBytes.length,
                randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
                originalBytes
            ]
        )).rows[0].id;

        rowId = (await pool.query(
            `INSERT INTO settlement_evidence_rows (
                import_id, merchant_id, row_number, raw_values,
                normalized_values, validation_status
             )
             VALUES ($1, $2, 2, $3, $4, 'VALID')
             RETURNING id`,
            [
                importId,
                merchantId,
                JSON.stringify({
                    provider_reference: `RCPT-MODEL-${suffix}`,
                    gross_amount: "100.00"
                }),
                JSON.stringify({
                    provider_reference: `RCPT-MODEL-${suffix}`,
                    gross_amount: "100.00"
                })
            ]
        )).rows[0].id;

        batchId = (await pool.query(
            `INSERT INTO settlement_batches (
                merchant_id, evidence_import_id, source_provider,
                source_batch_reference, period_start, period_end,
                settlement_effective_date, currency, gross_amount,
                net_amount, transaction_count, status, raw_values
             )
             VALUES ($1, $2, 'MPESA', $3, '2026-11-01', '2026-11-03',
                     '2026-11-05', 'KES', 100.00, NULL, 1, 'EXPECTED', '{}')
             RETURNING id`,
            [merchantId, importId, `BATCH-MODEL-${suffix}`]
        )).rows[0].id;

        lineId = (await pool.query(
            `INSERT INTO settlement_lines (
                merchant_id, batch_id, evidence_import_id, evidence_row_id,
                provider_reference, receipt_reference, transaction_date,
                settlement_effective_date, currency, gross_amount,
                fee_amount, net_amount, status, raw_values
             )
             VALUES ($1, $2, $3, $4, $5, $6, '2026-11-01',
                     '2026-11-05', 'KES', 100.00, NULL, NULL,
                     'EXPECTED', '{}')
             RETURNING id`,
            [
                merchantId,
                batchId,
                importId,
                rowId,
                `RCPT-MODEL-${suffix}`,
                `RCPT-MODEL-${suffix}`
            ]
        )).rows[0].id;

        depositId = (await pool.query(
            `INSERT INTO settlement_bank_deposits (
                merchant_id, evidence_import_id, evidence_row_id,
                account_alias, bank_reference, deposit_date, value_date,
                currency, deposited_amount, status, raw_values
             )
             VALUES ($1, $2, $3, 'PRIMARY-KES', $4, '2026-11-06',
                     '2026-11-06', 'KES', 100.00, 'SETTLED', '{}')
             RETURNING id`,
            [
                merchantId,
                importId,
                rowId,
                `DEP-MODEL-${suffix}`
            ]
        )).rows[0].id;

        adjustmentId = (await pool.query(
            `INSERT INTO settlement_adjustments (
                merchant_id, batch_id, line_id, evidence_import_id,
                evidence_row_id, adjustment_type, amount, currency,
                effective_date, provider_reference, raw_values
             )
             VALUES ($1, $2, $3, $4, $5, 'FEE_REVERSAL',
                     5.00, 'KES', '2026-11-07', $6, '{}')
             RETURNING id`,
            [
                merchantId,
                batchId,
                lineId,
                importId,
                rowId,
                `ADJ-MODEL-${suffix}`
            ]
        )).rows[0].id;

        await assert.rejects(
            pool.query(
                `INSERT INTO settlement_lines (
                    merchant_id, batch_id, evidence_import_id, evidence_row_id,
                    provider_reference, currency
                 )
                 VALUES ($1, $2, $3, $4, $5, 'KES')`,
                [
                    otherMerchantId,
                    batchId,
                    importId,
                    rowId,
                    `RCPT-CROSS-MERCHANT-${suffix}`
                ]
            ),
            /cross.*merchant|settlement_lines_batch_fk|source_row_unique|violates foreign key/i
        );

        await assert.rejects(
            pool.query(
                `INSERT INTO settlement_batches (
                    merchant_id, evidence_import_id, source_batch_reference,
                    settlement_effective_date, currency
                 )
                 VALUES ($1, $2, $3, '2026-11-05', 'KES')`,
                [merchantId, importId, `BATCH-MODEL-${suffix}`]
            ),
            /settlement_batches_source_natural_key_unique|duplicate key/i
        );

        const missingValues = await pool.query(
            `SELECT gross_amount, fee_amount, net_amount
             FROM settlement_batches
             WHERE id = $1`,
            [batchId]
        );
        assert.equal(missingValues.rows[0].fee_amount, null);
        assert.equal(missingValues.rows[0].net_amount, null);

        await pool.query(
            `INSERT INTO settlement_adjustments (
                merchant_id, batch_id, line_id, adjustment_type, amount, currency,
                effective_date, provider_reference, reversal_of_adjustment_id, raw_values
             )
             VALUES ($1, $2, $3, 'REVERSAL',
                     5.00, 'KES', '2026-11-08', $4, $5, '{}')`,
            [
                merchantId,
                batchId,
                lineId,
                `REV-MODEL-${suffix}`,
                adjustmentId
            ]
        );

        const reversalCount = await pool.query(
            `SELECT COUNT(*)::integer AS count
             FROM settlement_adjustments
             WHERE merchant_id = $1 AND reversal_of_adjustment_id = $2`,
            [merchantId, adjustmentId]
        );
        assert.equal(reversalCount.rows[0].count, 1);

        const providerCount = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM provider_transactions WHERE merchant_id = $1",
            [merchantId]
        );
        assert.equal(providerCount.rows[0].count, 0);
    } finally {
        if (merchantId) {
            await pool.query("DELETE FROM settlement_adjustments WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_bank_deposits WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_lines WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_batches WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_evidence_rows WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_evidence_imports WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        }
        if (otherMerchantId) {
            await pool.query("DELETE FROM merchants WHERE id = $1", [otherMerchantId]).catch(() => {});
        }
        await pool.query("DELETE FROM users WHERE email IN ($1, $2)", [merchantEmail, otherEmail]).catch(() => {});
        await closeDatabase();
    }
});
