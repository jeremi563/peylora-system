ALTER TABLE notifications
    ADD COLUMN claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS notifications_processing_lease_idx
    ON notifications (delivery_status, claimed_at)
    WHERE channel = 'EMAIL';
