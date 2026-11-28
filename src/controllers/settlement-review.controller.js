import {
    createSettlementReconciliationSnapshot,
    listSettlementReconciliationRuns,
    resolveSettlementException,
    resolveSettlementMatch,
    SettlementReviewValidationError
} from "../services/settlement-review.service.js";

export async function resolveException(req, res) {
    try {
        const result = await resolveSettlementException({
            merchantId: req.validatedBody.merchantId,
            exceptionId: req.params.exceptionId,
            operatorUserId: req.auth.userId,
            resolution: req.validatedBody.resolution,
            reason: req.validatedBody.reason,
            supportingEvidence: req.validatedBody.supportingEvidence
        });
        if (!result) {
            return res.status(404).json({
                success: false,
                message: "Settlement reconciliation exception not found"
            });
        }
        return res.json({
            success: true,
            duplicate: result.duplicate,
            exception: result
        });
    } catch (error) {
        if (error instanceof SettlementReviewValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }
        console.error("Could not resolve settlement exception:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not resolve settlement exception"
        });
    }
}

export async function resolveMatch(req, res) {
    try {
        const result = await resolveSettlementMatch({
            merchantId: req.validatedBody.merchantId,
            matchId: req.params.matchId,
            operatorUserId: req.auth.userId,
            resolution: req.validatedBody.resolution,
            reason: req.validatedBody.reason,
            supportingEvidence: req.validatedBody.supportingEvidence
        });
        if (!result) {
            return res.status(404).json({
                success: false,
                message: "Settlement match not found"
            });
        }
        return res.json({
            success: true,
            duplicate: result.duplicate,
            match: result
        });
    } catch (error) {
        if (error instanceof SettlementReviewValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }
        console.error("Could not resolve settlement match:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not resolve settlement match"
        });
    }
}

export async function createSnapshot(req, res) {
    try {
        const result = await createSettlementReconciliationSnapshot({
            merchantId: req.validatedBody.merchantId,
            runType: req.validatedBody.runType,
            operatorUserId: req.auth.userId
        });
        return res.status(201).json({
            success: true,
            run: result
        });
    } catch (error) {
        console.error("Could not create settlement reconciliation snapshot:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not create settlement reconciliation snapshot"
        });
    }
}

export async function listMerchantSnapshots(req, res) {
    try {
        return res.json({
            success: true,
            runs: await listSettlementReconciliationRuns(req.auth.merchantId)
        });
    } catch (error) {
        console.error("Could not list settlement reconciliation runs:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not list settlement reconciliation runs"
        });
    }
}
