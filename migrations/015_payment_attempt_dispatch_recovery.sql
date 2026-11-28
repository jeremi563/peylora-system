ALTER TABLE transactions
    ADD COLUMN dispatch_state text;

UPDATE transactions
SET dispatch_state = CASE
    WHEN checkout_request_id IS NOT NULL AND stk_response_code = '0'
        THEN 'ACKNOWLEDGED'
    WHEN stk_response_code IS NOT NULL AND stk_response_code <> '0'
        THEN 'REJECTED'
    ELSE 'LEGACY_UNKNOWN'
END;

ALTER TABLE transactions
    ALTER COLUMN dispatch_state SET DEFAULT 'PREPARED',
    ALTER COLUMN dispatch_state SET NOT NULL,
    ADD CONSTRAINT transactions_dispatch_state_check
        CHECK (dispatch_state IN (
            'PREPARED',
            'DISPATCHING',
            'ACKNOWLEDGED',
            'REJECTED',
            'UNCERTAIN',
            'PRE_DISPATCH_FAILED',
            'LEGACY_UNKNOWN'
        ));

ALTER TABLE transactions
    ADD COLUMN recovery_disposition_id uuid;

CREATE INDEX transactions_dispatch_state_created_at_idx
    ON transactions (dispatch_state, created_at);

CREATE TABLE payment_attempt_recovery_dispositions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_transaction_id uuid NOT NULL,
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    operator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    disposition text NOT NULL CHECK (disposition = 'RETRY_AUTHORIZED'),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 1000),
    supporting_evidence text NOT NULL
        CHECK (length(btrim(supporting_evidence)) BETWEEN 1 AND 4000),
    request_hash char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT payment_attempt_recovery_attempt_fk
        FOREIGN KEY (attempt_transaction_id, merchant_id)
        REFERENCES transactions(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT payment_attempt_recovery_id_merchant_unique
        UNIQUE (id, merchant_id),
    CONSTRAINT payment_attempt_recovery_attempt_unique
        UNIQUE (attempt_transaction_id)
);

ALTER TABLE transactions
    ADD CONSTRAINT transactions_recovery_disposition_fk
        FOREIGN KEY (recovery_disposition_id, merchant_id)
        REFERENCES payment_attempt_recovery_dispositions(id, merchant_id)
        ON DELETE RESTRICT;

CREATE UNIQUE INDEX transactions_recovery_disposition_unique
    ON transactions (recovery_disposition_id)
    WHERE recovery_disposition_id IS NOT NULL;

CREATE INDEX payment_attempt_recovery_merchant_created_at_idx
    ON payment_attempt_recovery_dispositions (merchant_id, created_at DESC);
