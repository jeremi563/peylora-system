import {
    listAuditLogs,
    listWebhookEvents,
    retryFailedWebhookEvent
} from "../services/webhook.service.js";

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
        const event = await retryFailedWebhookEvent(req.params.eventId);
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