import {
    getOperationalSnapshot,
    listAuditLogs,
    listWebhookEvents,
    retryFailedWebhookEvent
} from "../services/webhook.service.js";
import {
    createPaymentAttemptRecoveryDisposition,
    PaymentAttemptNotRecoverableError,
    RecoveryDispositionConflictError
} from "../services/transaction.service.js";

function pageResponse(result, query, key) {
    return {
        success: true,
        [key]: result.items,
        pagination: {
            page: query.page,
            limit: query.limit,
            total: result.total,
            pages: Math.ceil(result.total / query.limit)
        }
    };
}

export async function getWebhookEvents(req, res) {
    try {
        const result = await listWebhookEvents(req.validatedQuery);
        return res.json(pageResponse(result, req.validatedQuery, "events"));
    } catch (error) {
        console.error("Could not list webhook events:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve webhook events" });
    }
}

export async function retryWebhook(req, res) {
    try {
        const event = await retryFailedWebhookEvent(
            req.params.eventId,
            req.auth.userId,
            req.validatedBody.reason,
            req.validatedBody.supportingEvidence
        );
        if (!event) {
            return res.status(404).json({ success: false, message: "Failed webhook event not found" });
        }
        return res.json({ success: true, event });
    } catch (error) {
        console.error("Could not retry webhook event:", error.message);
        return res.status(500).json({ success: false, message: "Could not retry webhook event" });
    }
}

export async function getAuditLogs(req, res) {
    try {
        const result = await listAuditLogs(req.validatedQuery);
        return res.json(pageResponse(result, req.validatedQuery, "auditLogs"));
    } catch (error) {
        console.error("Could not list audit logs:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve audit logs" });
    }
}

export async function authorizePaymentAttemptRetry(req, res) {
    try {
        const disposition = await createPaymentAttemptRecoveryDisposition({
            transactionId: req.params.transactionId,
            operatorUserId: req.auth.userId,
            reason: req.validatedBody.reason,
            supportingEvidence: req.validatedBody.supportingEvidence
        });
        if (!disposition) {
            return res.status(404).json({
                success: false,
                message: "Payment attempt not found"
            });
        }
        return res.status(201).json({ success: true, recoveryDisposition: disposition });
    } catch (error) {
        if (error instanceof RecoveryDispositionConflictError) {
            return res.status(409).json({ success: false, message: error.message });
        }
        if (error instanceof PaymentAttemptNotRecoverableError) {
            return res.status(409).json({ success: false, message: error.message });
        }
        console.error("Could not authorize payment attempt retry:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not authorize payment attempt retry"
        });
    }
}

export async function getOperations(req, res) {
    try {
        return res.json({
            success: true,
            operations: await getOperationalSnapshot()
        });
    } catch (error) {
        console.error("Could not retrieve operational snapshot:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not retrieve operational snapshot"
        });
    }
}