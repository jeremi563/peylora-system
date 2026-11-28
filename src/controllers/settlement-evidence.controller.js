import {
    createSettlementEvidenceImport,
    getSettlementEvidenceDownload,
    getSettlementEvidenceImport,
    getSettlementEvidenceRows,
    listSettlementEvidenceImports,
    listSettlementSourceProfiles,
    SettlementEvidenceValidationError
} from "../services/settlement-evidence.service.js";

export async function listSettlementProfiles(req, res) {
    try {
        return res.json({
            success: true,
            profiles: await listSettlementSourceProfiles()
        });
    } catch (error) {
        console.error("Could not list settlement source profiles:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not list settlement source profiles"
        });
    }
}

export async function uploadSettlementEvidence(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "A CSV or XLSX evidence file is required"
            });
        }
        const profileId = req.body.profileId?.trim();
        if (!profileId) {
            return res.status(400).json({
                success: false,
                message: "profileId is required"
            });
        }
        const result = await createSettlementEvidenceImport({
            merchantId: req.auth.merchantId,
            operatorUserId: req.auth.userId,
            profileId,
            originalFilename: req.file.originalname,
            mimeType: req.file.mimetype,
            buffer: req.file.buffer
        });
        return res.status(result.duplicate ? 200 : 201).json({
            success: true,
            duplicate: result.duplicate,
            evidenceImport: result.import
        });
    } catch (error) {
        if (error instanceof SettlementEvidenceValidationError) {
            return res.status(400).json({
                success: false,
                message: error.message,
                details: error.details
            });
        }
        console.error("Could not import settlement evidence:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not import settlement evidence"
        });
    }
}

export async function listSettlementImports(req, res) {
    try {
        return res.json({
            success: true,
            evidenceImports: await listSettlementEvidenceImports(req.auth.merchantId)
        });
    } catch (error) {
        console.error("Could not list settlement evidence imports:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not list settlement evidence imports"
        });
    }
}

export async function getSettlementImport(req, res) {
    try {
        const evidenceImport = await getSettlementEvidenceImport(
            req.auth.merchantId,
            req.params.importId
        );
        if (!evidenceImport) {
            return res.status(404).json({
                success: false,
                message: "Settlement evidence import not found"
            });
        }
        const rows = await getSettlementEvidenceRows(
            req.auth.merchantId,
            req.params.importId
        );
        return res.json({
            success: true,
            evidenceImport,
            rows
        });
    } catch (error) {
        console.error("Could not retrieve settlement evidence import:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not retrieve settlement evidence import"
        });
    }
}

export async function downloadSettlementEvidence(req, res) {
    try {
        const evidence = await getSettlementEvidenceDownload(
            req.auth.merchantId,
            req.params.importId
        );
        if (!evidence) {
            return res.status(404).json({
                success: false,
                message: "Settlement evidence import not found"
            });
        }
        res.setHeader("Content-Type", evidence.mime_type);
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${evidence.original_filename.replace(/["\r\n]/g, "")}"`
        );
        res.setHeader("X-Content-SHA256", evidence.sha256);
        return res.send(evidence.original_bytes);
    } catch (error) {
        console.error("Could not download settlement evidence:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not download settlement evidence"
        });
    }
}
