import assert from "node:assert/strict";
import test from "node:test";

import { notificationIdSchema, notificationListSchema } from "../src/validators/notification.schemas.js";

test("notification list query defaults and validates pagination and unread filter", () => {
    assert.deepEqual(notificationListSchema.parse({}), {
        page: 1,
        limit: 25,
        unreadOnly: false
    });
    assert.deepEqual(notificationListSchema.parse({ page: "2", limit: "50", unreadOnly: "true" }), {
        page: 2,
        limit: 50,
        unreadOnly: true
    });
    assert.equal(notificationListSchema.safeParse({ limit: "101" }).success, false);
    assert.equal(notificationListSchema.safeParse({ unreadOnly: "yes" }).success, false);
});

test("notification IDs must be UUIDs", () => {
    assert.equal(notificationIdSchema.safeParse("c9f6b41c-40a4-42e3-b9b4-6f344435de32").success, true);
    assert.equal(notificationIdSchema.safeParse("bad-id").success, false);
});