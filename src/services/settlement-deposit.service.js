import { createHash } from "node:crypto";

import { getDatabasePool } from "../database.js";

export class SettlementDepositValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "SettlementDepositValidationError";
    }
}

function parseDate(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if (/^\d{8}$/.test(text)) {
        return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
        const [day, month, year] = text.split("/");
        return `${year}-${month}-${day}`;
    }
    return null;
}

function parseAmount(value) {
    const text = String(value ?? "").trim();
    if (!/^[-+]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) return null;
    return text;
}

export async function registerMerchantBankAccount({
    merchantId,
    accountAlias,
    bankReference,
    accountLast4
}) {
    const alias = String(accountAlias ?? "").trim();
    if (alias.length < 2 || alias.length > 100) {
        throw new SettlementDepositValidationError("accountAlias must be 2-100 characters");
    }
    const reference = bankReference == null ? null : String(bankReference).trim() || null;
    const last4 = accountLast4 == null ? null : String(accountLast4).trim() || null;
    if (last4 && !/^\d{4}$/.test(last4)) {
        throw new SettlementDepositValidationError("accountLast4 must contain exactly four digits");
    }
    const pool = getDatabasePool();
    const existing = await pool.query(
        `SELECT id, merchant_id, account_alias, bank_reference, account_last4,
                currency, active, created_at
         FROM merchant_bank_accounts
         WHERE merchant_id = $1
           AND account_alias = $2`,
        [merchantId, alias]
    );
    if (existing.rowCount) {
        return { duplicate: true, account: existing.rows[0] };
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const inserted = await client.query(
            `INSERT INTO merchant_bank_accounts (
                merchant_id, account_alias, bank_reference, account_last4
             )
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (merchant_id, account_alias) DO NOTHING
             RETURNING id, merchant_id, account_alias, bank_reference,
                       account_last4, currency, active, created_at`,
            [merchantId, alias, reference, last4]
        );
        if (!inserted.rowCount) {
            await client.query("ROLLBACK");
            const duplicate = await pool.query(
                `SELECT id, merchant_id, account_alias, bank_reference, account_last4,
                        currency, active, created_at
                 FROM merchant_bank_accounts
                 WHERE merchant_id = $1 AND account_alias = $2`,
                [merchantId, alias]
            );
            return { duplicate: true, account: duplicate.rows[0] };
        }
        await client.query(
            `INSERT INTO audit_logs (
                user_id, merchant_id, action, entity_type, entity_id, details, event_key
             )
             VALUES ($1, $2, 'MERCHANT_BANK_ACCOUNT_REGISTERED',
                     'MERCHANT_BANK_ACCOUNT', $3, $4, $5)
             ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
            [
                null,
                merchantId,
                inserted.rows[0].id,
                JSON.stringify({
                    accountAlias: alias,
                    bankReferencePresent: reference != null,
                    accountLast4Present: last4 != null
                }),
                `merchant-bank-account:${merchantId}:${inserted.rows[0].id}`
            ]
        );
        await client.query("COMMIT");
        return { duplicate: false, account: inserted.rows[0] };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function listMerchantBankAccounts(merchantId) {
    const result = await getDatabasePool().query(
        `SELECT id, account_alias, bank_reference, account_last4,
                currency, active, created_at
         FROM merchant_bank_accounts
         WHERE merchant_id = $1
         ORDER BY created_at DESC`,
        [merchantId]
    );
    return result.rows;
}

export async function createManualBankDeposit({
    merchantId,
    accountAlias,
    bankReference,
    depositDate,
    valueDate,
    depositedAmount,
    evidenceImportId = null,
    evidenceRowId = null,
    rawValues = {}
}) {
    const depositDateCanonical = parseDate(depositDate);
    const valueDateCanonical = valueDate ? parseDate(valueDate) : null;
    const amountCanonical = parseAmount(depositedAmount);
    if (!depositDateCanonical) {
        throw new SettlementDepositValidationError("depositDate must be YYYY-MM-DD, YYYYMMDD or DD/MM/YYYY");
    }
    if (valueDate && !valueDateCanonical) {
        throw new SettlementDepositValidationError("valueDate must be YYYY-MM-DD, YYYYMMDD or DD/MM/YYYY");
    }
    if (!amountCanonical) {
        throw new SettlementDepositValidationError("depositedAmount must be a non-negative KES amount");
    }
    if (Number(amountCanonical) < 0) {
        throw new SettlementDepositValidationError("depositedAmount must be non-negative");
    }
    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const account = await client.query(
            `SELECT id, account_alias, bank_reference
             FROM merchant_bank_accounts
             WHERE merchant_id = $1
               AND active = true
               AND account_alias = $2
             FOR UPDATE`,
            [merchantId, String(accountAlias).trim()]
        );
        if (!account.rowCount) {
            throw new SettlementDepositValidationError("Merchant bank account alias not found");
        }
        if (
            bankReference
            && account.rows[0].bank_reference
            && String(bankReference).trim() !== account.rows[0].bank_reference
        ) {
            throw new SettlementDepositValidationError("bankReference conflicts with the registered account");
        }
        const inserted = await client.query(
            `INSERT INTO settlement_bank_deposits (
                merchant_id, evidence_import_id, evidence_row_id,
                account_alias, bank_reference, deposit_date, value_date,
                currency, deposited_amount, status, raw_values
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'KES', $8,
                     'SETTLED', $9)
             ON CONFLICT (merchant_id, bank_reference)
             WHERE bank_reference IS NOT NULL
             DO NOTHING
             RETURNING id, merchant_id, account_alias, bank_reference,
                       deposit_date, value_date, currency, deposited_amount,
                       status, created_at`,
            [
                merchantId,
                evidenceImportId,
                evidenceRowId,
                account.rows[0].account_alias,
                bankReference ? String(bankReference).trim() : null,
                depositDateCanonical,
                valueDateCanonical,
                amountCanonical,
                JSON.stringify(rawValues)
            ]
        );
        if (!inserted.rowCount) {
            await client.query("ROLLBACK");
            const duplicate = await pool.query(
                `SELECT id, merchant_id, account_alias, bank_reference,
                        deposit_date, value_date, currency, deposited_amount,
                        status, created_at
                 FROM settlement_bank_deposits
                 WHERE merchant_id = $1
                   AND bank_reference = $2`,
                [merchantId, String(bankReference).trim()]
            );
            return { duplicate: true, deposit: duplicate.rows[0] };
        }
        await client.query(
            `INSERT INTO audit_logs (
                user_id, merchant_id, action, entity_type, entity_id, details, event_key
             )
             VALUES ($1, $2, 'SETTLEMENT_BANK_DEPOSIT_RECORDED',
                     'SETTLEMENT_BANK_DEPOSIT', $3, $4, $5)
             ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
            [
                null,
                merchantId,
                inserted.rows[0].id,
                JSON.stringify({
                    accountAlias: account.rows[0].account_alias,
                    bankReferencePresent: bankReference != null,
                    depositDate: depositDateCanonical,
                    valueDate: valueDateCanonical,
                    depositedAmount: amountCanonical,
                    evidenceImportId,
                    evidenceRowId
                }),
                `settlement-bank-deposit:${merchantId}:${inserted.rows[0].id}`
            ]
        );
        await client.query("COMMIT");
        return { duplicate: false, deposit: inserted.rows[0] };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function reconcileSettlementBatchDeposit({
    merchantId,
    settlementBatchId,
    bankDepositId
}) {
    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const batch = await client.query(
            `SELECT id, merchant_id, currency, net_amount,
                    settlement_effective_date, source_batch_reference
             FROM settlement_batches
             WHERE id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [settlementBatchId, merchantId]
        );
        if (!batch.rowCount) {
            throw new SettlementDepositValidationError("Settlement batch not found");
        }
        const deposit = await client.query(
            `SELECT id, merchant_id, currency, deposited_amount,
                    deposit_date, value_date, bank_reference
             FROM settlement_bank_deposits
             WHERE id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [bankDepositId, merchantId]
        );
        if (!deposit.rowCount) {
            throw new SettlementDepositValidationError("Bank deposit not found");
        }
        const batchRow = batch.rows[0];
        const depositRow = deposit.rows[0];
        const conflictFields = [];
        if (batchRow.currency !== depositRow.currency) {
            conflictFields.push("currency");
        }
        if (batchRow.net_amount == null) {
            conflictFields.push("batch_net_amount");
        }
        if (depositRow.deposited_amount == null) {
            conflictFields.push("deposit_amount");
        }
        let differenceAmount = null;
        if (
            batchRow.net_amount != null
            && depositRow.deposited_amount != null
        ) {
            differenceAmount = (
                Number(depositRow.deposited_amount)
                - Number(batchRow.net_amount)
            ).toFixed(2);
            if (Number(differenceAmount) !== 0) {
                conflictFields.push("amount");
            }
        }
        const matchState = conflictFields.length ? "CONFLICT" : "SYSTEM_EXACT";
        const evidenceJson = {
            batchId: batchRow.id,
            depositId: depositRow.id,
            sourceBatchReference: batchRow.source_batch_reference,
            bankReference: depositRow.bank_reference,
            batchNetAmount: batchRow.net_amount,
            depositAmount: depositRow.deposited_amount,
            differenceAmount,
            settlementEffectiveDate: batchRow.settlement_effective_date,
            depositDate: depositRow.deposit_date,
            valueDate: depositRow.value_date
        };
        const evidenceHash = createHash("sha256")
            .update(JSON.stringify(evidenceJson))
            .digest("hex");
        const eventKey = `settlement-batch-deposit:${merchantId}:${settlementBatchId}:${bankDepositId}:${evidenceHash}`;
        const inserted = await client.query(
            `INSERT INTO settlement_batch_deposit_matches (
                merchant_id, settlement_batch_id, bank_deposit_id,
                match_state, batch_net_amount, deposit_amount,
                difference_amount, evidence_json, conflict_fields, event_key
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (merchant_id, settlement_batch_id, bank_deposit_id)
             DO NOTHING
             RETURNING id`,
            [
                merchantId,
                settlementBatchId,
                bankDepositId,
                matchState,
                batchRow.net_amount,
                depositRow.deposited_amount,
                differenceAmount,
                JSON.stringify(evidenceJson),
                JSON.stringify(conflictFields),
                eventKey
            ]
        );
        if (conflictFields.length) {
            await client.query(
                `INSERT INTO settlement_reconciliation_exceptions (
                    merchant_id, settlement_batch_id, bank_deposit_id,
                    exception_type, status, evidence_json, conflict_fields
                 )
                 SELECT $1, $2, $3,
                        CASE
                            WHEN $6::text[] @> ARRAY['amount'] THEN 'AMOUNT_MISMATCH'
                            WHEN $6::text[] @> ARRAY['currency'] THEN 'CURRENCY_MISMATCH'
                            ELSE 'CONFLICTING_EVIDENCE'
                        END,
                        'OPEN', $4, $5
                 WHERE NOT EXISTS (
                     SELECT 1
                     FROM settlement_reconciliation_exceptions
                     WHERE merchant_id = $1
                       AND settlement_batch_id = $2
                       AND bank_deposit_id = $3
                       AND status = 'OPEN'
                       AND conflict_fields = $5::jsonb
                 )`,
                [
                    merchantId,
                    settlementBatchId,
                    bankDepositId,
                    JSON.stringify(evidenceJson),
                    JSON.stringify(conflictFields),
                    conflictFields
                ]
            );
        }
        await client.query("COMMIT");
        return {
            duplicate: !inserted.rowCount,
            matchState,
            conflictFields,
            differenceAmount
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
