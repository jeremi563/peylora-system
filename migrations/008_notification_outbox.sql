ALTER TABLE notifications
    ADD COLUMN event_key text,
    ADD COLUMN recipient_email text,
    ADD COLUMN subject text,
    ADD COLUMN body text,
    ADD COLUMN delivery_status text NOT NULL DEFAULT 'DELIVERED'
        CHECK (delivery_status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED')),
    ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    ADD COLUMN next_attempt_at timestamptz,
    ADD COLUMN last_error text;

CREATE UNIQUE INDEX notifications_event_channel_unique
    ON notifications (event_key, channel)
    WHERE event_key IS NOT NULL;

CREATE INDEX notifications_email_outbox_idx
    ON notifications (next_attempt_at, created_at)
    WHERE channel = 'EMAIL' AND delivery_status IN ('PENDING', 'PROCESSING');

CREATE INDEX notifications_user_unread_idx
    ON notifications (user_id, created_at DESC)
    WHERE channel = 'IN_APP' AND read_at IS NULL;