ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS reconciliation_response jsonb,
    ADD COLUMN IF NOT EXISTS reconciliation_requested_at timestamptz;