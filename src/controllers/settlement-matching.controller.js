import {
    runSettlementLineMatching,
    SettlementMatchingValidationError
} from "../services/settlement-matching.service.js";
import { getDatabasePool } from "../database.js";

export async function runSettlementMatching(req, res) {
    try {
        const importId = req.body.importId?.trim() || null;
        const lineId = req.body.lineId?.trim() || null;
        const results = await runSettlementLineMatching({
            merchantId: req.auth.merchantId,
            settlementLineId: lineId,
            importId
        });
        return res.json({
            success: true,
            matches: results
        });
    } catch (error) {
        if (error instanceof SettlementMatchingValidationError) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }
        console.error("Could not run settlement matching:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not run settlement matching"
        });
    }
}

export async function listSettlementMatches(req, res) {
    try {
        const result = await getDatabasePool().query(
            `SELECT sm.id, sm.settlement_line_id, sm.provider_transaction_id,
                    sm.settlement_batch_id, sm.match_state, sm.confidence,
                    sm.evidence_json, sm.conflict_fields, sm.resolved_at,
                    sm.reason, sm.created_at
             FROM settlement_matches sm
             WHERE sm.merchant_id = $1
             ORDER BY sm.created_at DESC`,
            [req.auth.merchantId]
        );
        return res.json({
            success: true,
            matches: result.rows
        });
    } catch (error) {
        console.error("Could not list settlement matches:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not list settlement matches"
        });
    }
}

export async function listSettlementExceptions(req, res) {
    try {
        const result = await getDatabasePool().query(
            `SELECT id, settlement_line_id, settlement_batch_id, bank_deposit_id,
                    exception_type, status, evidence_json, conflict_fields,
                    resolved_by_user_id, resolution_reason, resolved_at, created_at
             FROM settlement_reconciliation_exceptions
             WHERE merchant_id = $1
             ORDER BY created_at DESC`,
            [req.auth.merchantId]
        );
        return res.json({
            success: true,
            exceptions: result.rows
        });
    } catch (error) {
        console.error("Could not list settlement exceptions:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not list settlement exceptions"
        });
    }
}
