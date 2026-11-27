CREATE TABLE reconciliation_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    transaction_id uuid NOT NULL,
    evidence_type text NOT NULL
        CHECK (evidence_type IN ('STATUS_QUERY')),
    result_code integer,
    callback_result_code integer,
    agreement text
        CHECK (agreement IN ('MATCH', 'MISMATCH', 'NO_CALLBACK')),
    response_payload jsonb NOT NULL,
    event_key text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT reconciliation_events_transaction_fk
        FOREIGN KEY (transaction_id, merchant_id)
        REFERENCES transactions(id, merchant_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX reconciliation_events_event_key_unique
    ON reconciliation_events (event_key)
    WHERE event_key IS NOT NULL;
CREATE INDEX reconciliation_events_transaction_created_at_idx
    ON reconciliation_events (transaction_id, created_at DESC);
CREATE INDEX reconciliation_events_merchant_created_at_idx
    ON reconciliation_events (merchant_id, created_at DESC);
