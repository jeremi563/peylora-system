CREATE TABLE settlement_matches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    settlement_line_id uuid NOT NULL,
    provider_transaction_id uuid,
    settlement_batch_id uuid,
    bank_deposit_id uuid,
    match_state text NOT NULL
        CHECK (match_state IN (
            'SYSTEM_EXACT',
            'SYSTEM_CANDIDATE',
            'OPERATOR_CONFIRMED',
            'CONFLICT'
        )),
    confidence text NOT NULL
        CHECK (confidence IN ('EXACT', 'CANDIDATE', 'OPERATOR', 'CONFLICT')),
    evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    conflict_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    reason text,
    resolved_at timestamptz,
    event_key text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT settlement_matches_line_fk
        FOREIGN KEY (settlement_line_id, merchant_id)
        REFERENCES settlement_lines(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_matches_provider_fk
        FOREIGN KEY (provider_transaction_id, merchant_id)
        REFERENCES provider_transactions(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_matches_batch_fk
        FOREIGN KEY (settlement_batch_id, merchant_id)
        REFERENCES settlement_batches(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_matches_deposit_fk
        FOREIGN KEY (bank_deposit_id, merchant_id)
        REFERENCES settlement_bank_deposits(id, merchant_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX settlement_matches_id_merchant_unique
    ON settlement_matches (id, merchant_id);
CREATE UNIQUE INDEX settlement_matches_exact_line_provider_unique
    ON settlement_matches (merchant_id, settlement_line_id, provider_transaction_id)
    WHERE match_state = 'SYSTEM_EXACT';
CREATE UNIQUE INDEX settlement_matches_event_key_unique
    ON settlement_matches (event_key)
    WHERE event_key IS NOT NULL;
CREATE INDEX settlement_matches_merchant_line_idx
    ON settlement_matches (merchant_id, settlement_line_id, created_at DESC);
CREATE INDEX settlement_matches_conflict_idx
    ON settlement_matches (merchant_id, created_at DESC)
    WHERE match_state = 'CONFLICT';

CREATE TABLE settlement_reconciliation_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    settlement_line_id uuid,
    settlement_batch_id uuid,
    bank_deposit_id uuid,
    exception_type text NOT NULL
        CHECK (exception_type IN (
            'MISSING_PROVIDER_TRANSACTION',
            'MISSING_SETTLEMENT_LINE',
            'AMOUNT_MISMATCH',
            'DATE_MISMATCH',
            'CURRENCY_MISMATCH',
            'DUPLICATE_RECORD',
            'AMBIGUOUS_MATCH',
            'CONFLICTING_EVIDENCE',
            'PARTIAL_SETTLEMENT',
            'DELAYED_PAYOUT'
        )),
    status text NOT NULL
        CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
    evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    conflict_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    resolved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    resolution_reason text,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT settlement_exceptions_line_fk
        FOREIGN KEY (settlement_line_id, merchant_id)
        REFERENCES settlement_lines(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_exceptions_batch_fk
        FOREIGN KEY (settlement_batch_id, merchant_id)
        REFERENCES settlement_batches(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_exceptions_deposit_fk
        FOREIGN KEY (bank_deposit_id, merchant_id)
        REFERENCES settlement_bank_deposits(id, merchant_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX settlement_exceptions_id_merchant_unique
    ON settlement_reconciliation_exceptions (id, merchant_id);
CREATE INDEX settlement_exceptions_merchant_status_idx
    ON settlement_reconciliation_exceptions (merchant_id, status, created_at DESC);
CREATE INDEX settlement_exceptions_type_idx
    ON settlement_reconciliation_exceptions (merchant_id, exception_type, created_at DESC);
