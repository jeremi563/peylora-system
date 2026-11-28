import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "settlement-deposit-test-secret-at-least-32";

test("batch-to-bank-deposit reconciliation uses source net and deposit values", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const email = `settlement-deposit-${suffix}@example.test`;
    let merchantId;
    let batchId;
    let exactDepositId;
    let mismatchDepositId;

    try {
        const user = await pool.query(
            `INSERT INTO users (name, email, password_hash, email_verified)
             VALUES ('Settlement Deposit Merchant', $1, 'test-password-hash', true)
             RETURNING id`,
            [email]
        );
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Settlement Deposit Shop', $2)
             RETURNING id`,
            [user.rows[0].id, email]
        )).rows[0].id;

        batchId = (await pool.query(
            `INSERT INTO settlement_batches (
                merchant_id, source_provider, source_batch_reference,
                settlement_effective_date, currency, net_amount,
                transaction_count, status, raw_values
             )
             VALUES ($1, 'MPESA', $2, '2026-11-05', 'KES', 975.00,
                     1, 'SETTLED', '{}')
             RETURNING id`,
            [merchantId, `BATCH-DEPOSIT-${suffix}`]
        )).rows[0].id;

        const depositService = await import("../src/services/settlement-deposit.service.js");
        const account = await depositService.registerMerchantBankAccount({
            merchantId,
            accountAlias: "PRIMARY-KES",
            accountLast4: "1234"
        });
        assert.equal(account.duplicate, false);

        const exact = await depositService.createManualBankDeposit({
            merchantId,
            accountAlias: "PRIMARY-KES",
            bankReference: `DEP-EXACT-${suffix}`,
            depositDate: "2026-11-06",
            valueDate: "2026-11-06",
            depositedAmount: "975.00"
        });
        assert.equal(exact.duplicate, false);
        exactDepositId = exact.deposit.id;

        const mismatch = await depositService.createManualBankDeposit({
            merchantId,
            accountAlias: "PRIMARY-KES",
            bankReference: `DEP-MISMATCH-${suffix}`,
            depositDate: "2026-11-06",
            depositedAmount: "900.00"
        });
        assert.equal(mismatch.duplicate, false);
        mismatchDepositId = mismatch.deposit.id;

        const exactReconciliation = await depositService.reconcileSettlementBatchDeposit({
            merchantId,
            settlementBatchId: batchId,
            bankDepositId: exactDepositId
        });
        assert.equal(exactReconciliation.matchState, "SYSTEM_EXACT");
        assert.equal(exactReconciliation.conflictFields.length, 0);
        assert.equal(Number(exactReconciliation.differenceAmount), 0);

        const mismatchReconciliation = await depositService.reconcileSettlementBatchDeposit({
            merchantId,
            settlementBatchId: batchId,
            bankDepositId: mismatchDepositId
        });
        assert.equal(mismatchReconciliation.matchState, "CONFLICT");
        assert.ok(mismatchReconciliation.conflictFields.includes("amount"));
        assert.equal(Number(mismatchReconciliation.differenceAmount), -75);

        const duplicateDeposit = await depositService.createManualBankDeposit({
            merchantId,
            accountAlias: "PRIMARY-KES",
            bankReference: `DEP-EXACT-${suffix}`,
            depositDate: "2026-11-06",
            depositedAmount: "975.00"
        });
        assert.equal(duplicateDeposit.duplicate, true);

        const exception = await pool.query(
            `SELECT exception_type, conflict_fields
             FROM settlement_reconciliation_exceptions
             WHERE merchant_id = $1
               AND settlement_batch_id = $2
               AND bank_deposit_id = $3`,
            [merchantId, batchId, mismatchDepositId]
        );
        assert.equal(exception.rows.length, 1);
        assert.equal(exception.rows[0].exception_type, "AMOUNT_MISMATCH");
        assert.ok(exception.rows[0].conflict_fields.includes("amount"));

        const depositCount = await pool.query(
            `SELECT COUNT(*)::integer AS count
             FROM settlement_bank_deposits
             WHERE merchant_id = $1`,
            [merchantId]
        );
        assert.equal(depositCount.rows[0].count, 2);

        const providerCount = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM provider_transactions WHERE merchant_id = $1",
            [merchantId]
        );
        assert.equal(providerCount.rows[0].count, 0);
    } finally {
        if (merchantId) {
            await pool.query("DELETE FROM settlement_batch_deposit_matches WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_reconciliation_exceptions WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_bank_deposits WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM merchant_bank_accounts WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_batches WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        }
        await pool.query("DELETE FROM users WHERE email = $1", [email]).catch(() => {});
        await closeDatabase();
    }
});
