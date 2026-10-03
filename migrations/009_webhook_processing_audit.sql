ALTER TABLE webhook_events
    ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
    ADD COLUMN claimed_at timestamptz,
    ADD COLUMN max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0);

ALTER TABLE audit_logs
    ADD COLUMN event_key text;

CREATE UNIQUE INDEX audit_logs_event_key_unique
    ON audit_logs (event_key)
    WHERE event_key IS NOT NULL;

CREATE INDEX webhook_events_due_idx
    ON webhook_events (next_attempt_at, created_at)
    WHERE status IN ('RECEIVED', 'PROCESSING', 'FAILED');