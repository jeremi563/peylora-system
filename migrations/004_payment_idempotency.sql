ALTER TABLE payments
    ADD COLUMN idempotency_request_hash char(64);

ALTER TABLE transactions
    ADD COLUMN reconciliation_response jsonb,
    ADD COLUMN reconciliation_requested_at timestamptz;