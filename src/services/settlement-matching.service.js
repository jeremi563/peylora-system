import { createHash } from "node:crypto";

import { getDatabasePool } from "../database.js";

export class SettlementMatchingValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "SettlementMatchingValidationError";
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

async function findProviderTransaction(client, merchantId, line) {
    const candidates = [];
    if (line.provider_reference) {
        const byReference = await client.query(
            `SELECT pt.id, pt.provider_reference, pt.received_amount,
                    pt.currency, pt.created_at,
                    t.mpesa_receipt_number, t.provider_transaction_date
             FROM provider_transactions pt
             JOIN transactions t
               ON t.id = pt.attempt_transaction_id
              AND t.merchant_id = pt.merchant_id
             WHERE pt.merchant_id = $1
               AND pt.outcome = 'SUCCESS'
               AND (
                    pt.provider_reference = $2
                    OR t.mpesa_receipt_number = $2
               )`,
            [merchantId, line.provider_reference]
        );
        candidates.push(...byReference.rows);
    }
    if (line.receipt_reference) {
        const byReceipt = await client.query(
            `SELECT pt.id, pt.provider_reference, pt.received_amount,
                    pt.currency, pt.created_at,
                    t.mpesa_receipt_number, t.provider_transaction_date
             FROM provider_transactions pt
             JOIN transactions t
               ON t.id = pt.attempt_transaction_id
              AND t.merchant_id = pt.merchant_id
             WHERE pt.merchant_id = $1
               AND pt.outcome = 'SUCCESS'
               AND (
                    pt.provider_reference = $2
                    OR t.mpesa_receipt_number = $2
               )`,
            [merchantId, line.receipt_reference]
        );
        candidates.push(...byReceipt.rows);
    }
    return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
}

function normalizeEvidenceDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) return null;
        return [
            String(value.getFullYear()).padStart(4, "0"),
            String(value.getMonth() + 1).padStart(2, "0"),
            String(value.getDate()).padStart(2, "0")
        ].join("-");
    }
    const text = String(value).trim();
    if (/^\d{8}$/.test(text)) {
        return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }
    if (/^\d{14}$/.test(text)) {
        return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
        return text.slice(0, 10);
    }
    const parsed = new Date(text);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function compareEvidence(line, providerTransaction) {
    const conflictFields = [];
    if (
        line.currency
        && providerTransaction.currency
        && line.currency !== providerTransaction.currency
    ) {
        conflictFields.push("currency");
    }
    if (line.gross_amount != null) {
        if (Number(line.gross_amount) !== Number(providerTransaction.received_amount)) {
            conflictFields.push("gross_amount");
        }
    }
    if (line.transaction_date) {
        const lineDate = normalizeEvidenceDate(line.transaction_date);
        const providerDate = normalizeEvidenceDate(providerTransaction.provider_transaction_date);
        if (
            providerDate
            && providerDate !== lineDate
        ) {
            conflictFields.push("transaction_date");
        }
    }
    return conflictFields;
}

export async function runSettlementLineMatching({ merchantId, settlementLineId = null, importId = null }) {
    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const lines = await client.query(
            `SELECT sl.id, sl.merchant_id, sl.batch_id,
                    sl.provider_reference, sl.receipt_reference,
                    sl.transaction_date, sl.settlement_effective_date,
                    sl.currency, sl.gross_amount, sl.fee_amount,
                    sl.net_amount, sl.status, sl.raw_values
             FROM settlement_lines sl
             WHERE sl.merchant_id = $1
               AND ($2::uuid IS NULL OR sl.id = $2)
               AND ($3::uuid IS NULL OR sl.evidence_import_id = $3)
             ORDER BY sl.created_at`,
            [merchantId, settlementLineId, importId]
        );

        const results = [];
        for (const line of lines.rows) {
            await client.query(
                `SELECT id FROM settlement_lines
                 WHERE id = $1 AND merchant_id = $2
                 FOR UPDATE`,
                [line.id, merchantId]
            );
            const candidates = await findProviderTransaction(client, merchantId, line);
            if (!candidates.length) {
                await client.query(
                    `INSERT INTO settlement_reconciliation_exceptions (
                        merchant_id, settlement_line_id, exception_type,
                        status, evidence_json, conflict_fields
                     )
                     SELECT $1, $2, 'MISSING_PROVIDER_TRANSACTION', 'OPEN',
                            $3, '[]'::jsonb
                     WHERE NOT EXISTS (
                         SELECT 1
                         FROM settlement_reconciliation_exceptions
                         WHERE merchant_id = $1
                           AND settlement_line_id = $2
                           AND exception_type = 'MISSING_PROVIDER_TRANSACTION'
                           AND status = 'OPEN'
                     )`,
                    [
                        merchantId,
                        line.id,
                        JSON.stringify({
                            providerReference: line.provider_reference,
                            receiptReference: line.receipt_reference
                        })
                    ]
                );
                results.push({
                    settlementLineId: line.id,
                    result: "MISSING_PROVIDER_TRANSACTION"
                });
                continue;
            }

            if (candidates.length > 1) {
                await client.query(
                    `INSERT INTO settlement_reconciliation_exceptions (
                        merchant_id, settlement_line_id, exception_type,
                        status, evidence_json, conflict_fields
                     )
                     VALUES ($1, $2, 'AMBIGUOUS_MATCH', 'OPEN', $3, '[]'::jsonb)`,
                    [
                        merchantId,
                        line.id,
                        JSON.stringify({
                            candidateProviderTransactionIds: candidates.map((candidate) => candidate.id)
                        })
                    ]
                );
                for (const candidate of candidates) {
                    await client.query(
                        `INSERT INTO settlement_matches (
                            merchant_id, settlement_line_id, provider_transaction_id,
                            settlement_batch_id, match_state, confidence,
                            evidence_json, conflict_fields
                         )
                         VALUES ($1, $2, $3, $4, 'SYSTEM_CANDIDATE', 'CANDIDATE', $5, '[]'::jsonb)
                         ON CONFLICT DO NOTHING`,
                        [
                            merchantId,
                            line.id,
                            candidate.id,
                            line.batch_id,
                            JSON.stringify({
                                providerReference: candidate.provider_reference,
                                receivedAmount: candidate.received_amount,
                                currency: candidate.currency
                            })
                        ]
                    );
                }
                results.push({
                    settlementLineId: line.id,
                    result: "AMBIGUOUS_MATCH"
                });
                continue;
            }

            const providerTransaction = candidates[0];
            const conflictFields = compareEvidence(line, providerTransaction);
            if (conflictFields.length) {
                const evidenceJson = {
                    settlementLine: {
                        providerReference: line.provider_reference,
                        receiptReference: line.receipt_reference,
                        grossAmount: line.gross_amount,
                        currency: line.currency,
                        transactionDate: line.transaction_date
                    },
                    providerTransaction: {
                        id: providerTransaction.id,
                        providerReference: providerTransaction.provider_reference,
                        receiptReference: providerTransaction.mpesa_receipt_number,
                        receivedAmount: providerTransaction.received_amount,
                        currency: providerTransaction.currency,
                        providerTransactionDate: providerTransaction.provider_transaction_date
                    }
                };
                const evidenceHash = createHash("sha256")
                    .update(canonicalJson(evidenceJson))
                    .digest("hex");
                await client.query(
                    `INSERT INTO settlement_matches (
                        merchant_id, settlement_line_id, provider_transaction_id,
                        settlement_batch_id, match_state, confidence,
                        evidence_json, conflict_fields, event_key
                     )
                     VALUES ($1, $2, $3, $4, 'CONFLICT', 'CONFLICT', $5, $6, $7)
                     ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
                    [
                        merchantId,
                        line.id,
                        providerTransaction.id,
                        line.batch_id,
                        JSON.stringify(evidenceJson),
                        JSON.stringify(conflictFields),
                        `settlement-match-conflict:${merchantId}:${line.id}:${evidenceHash}`
                    ]
                );
                await client.query(
                    `INSERT INTO settlement_reconciliation_exceptions (
                        merchant_id, settlement_line_id, exception_type,
                        status, evidence_json, conflict_fields
                     )
                     SELECT $1, $2,
                            CASE
                                WHEN $4::text[] @> ARRAY['currency'] THEN 'CURRENCY_MISMATCH'
                                WHEN $4::text[] @> ARRAY['transaction_date'] THEN 'DATE_MISMATCH'
                                ELSE 'AMOUNT_MISMATCH'
                            END,
                            'OPEN', $3, $5
                     WHERE NOT EXISTS (
                         SELECT 1
                         FROM settlement_reconciliation_exceptions
                         WHERE merchant_id = $1
                           AND settlement_line_id = $2
                           AND status = 'OPEN'
                           AND conflict_fields = $5::jsonb
                     )`,
                    [
                        merchantId,
                        line.id,
                        JSON.stringify(evidenceJson),
                        conflictFields,
                        JSON.stringify(conflictFields)
                    ]
                );
                results.push({
                    settlementLineId: line.id,
                    result: "CONFLICT",
                    conflictFields
                });
                continue;
            }

            const evidenceJson = {
                settlementLine: {
                    providerReference: line.provider_reference,
                    receiptReference: line.receipt_reference,
                    grossAmount: line.gross_amount,
                    currency: line.currency,
                    transactionDate: line.transaction_date
                },
                providerTransaction: {
                    id: providerTransaction.id,
                    providerReference: providerTransaction.provider_reference,
                    receiptReference: providerTransaction.mpesa_receipt_number,
                    receivedAmount: providerTransaction.received_amount,
                    currency: providerTransaction.currency,
                    providerTransactionDate: providerTransaction.provider_transaction_date
                }
            };
            const evidenceHash = createHash("sha256")
                .update(canonicalJson(evidenceJson))
                .digest("hex");
            await client.query(
                `INSERT INTO settlement_matches (
                    merchant_id, settlement_line_id, provider_transaction_id,
                    settlement_batch_id, match_state, confidence,
                    evidence_json, conflict_fields, event_key
                 )
                 VALUES ($1, $2, $3, $4, 'SYSTEM_EXACT', 'EXACT', $5, '[]'::jsonb, $6)
                 ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
                [
                    merchantId,
                    line.id,
                    providerTransaction.id,
                    line.batch_id,
                    JSON.stringify(evidenceJson),
                    `settlement-match-exact:${merchantId}:${line.id}:${providerTransaction.id}:${evidenceHash}`
                ]
            );
            results.push({
                settlementLineId: line.id,
                providerTransactionId: providerTransaction.id,
                result: "SYSTEM_EXACT"
            });
        }
        await client.query("COMMIT");
        return results;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
