import {
    listUserNotifications,
    markAllNotificationsRead,
    markNotificationRead
} from "../services/notification.service.js";

export async function listNotifications(req, res) {
    try {
        const query = req.validatedQuery;
        const result = await listUserNotifications(req.auth.userId, query);
        return res.json({
            success: true,
            notifications: result.items,
            unreadCount: result.unread,
            pagination: {
                page: query.page,
                limit: query.limit,
                total: result.total,
                pages: Math.ceil(result.total / query.limit)
            }
        });
    } catch (error) {
        console.error("Could not list notifications:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve notifications" });
    }
}

export async function markNotificationAsRead(req, res) {
    try {
        const notification = await markNotificationRead(req.auth.userId, req.params.notificationId);
        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }
        return res.json({ success: true, notification });
    } catch (error) {
        console.error("Could not mark notification read:", error.message);
        return res.status(500).json({ success: false, message: "Could not update notification" });
    }
}

export async function markAllAsRead(req, res) {
    try {
        const count = await markAllNotificationsRead(req.auth.userId);
        return res.json({ success: true, updated: count });
    } catch (error) {
        console.error("Could not mark notifications read:", error.message);
        return res.status(500).json({ success: false, message: "Could not update notifications" });
    }
}