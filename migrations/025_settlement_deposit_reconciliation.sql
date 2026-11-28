CREATE TABLE merchant_bank_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    account_alias text NOT NULL,
    bank_reference text,
    account_last4 varchar(4),
    currency char(3) NOT NULL DEFAULT 'KES'
        CHECK (currency IN ('KES')),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX merchant_bank_accounts_id_merchant_unique
    ON merchant_bank_accounts (id, merchant_id);
CREATE UNIQUE INDEX merchant_bank_accounts_alias_unique
    ON merchant_bank_accounts (merchant_id, account_alias);
CREATE UNIQUE INDEX merchant_bank_accounts_reference_unique
    ON merchant_bank_accounts (merchant_id, bank_reference)
    WHERE bank_reference IS NOT NULL;

CREATE TABLE settlement_batch_deposit_matches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    settlement_batch_id uuid NOT NULL,
    bank_deposit_id uuid NOT NULL,
    match_state text NOT NULL
        CHECK (match_state IN (
            'SYSTEM_EXACT',
            'SYSTEM_CANDIDATE',
            'OPERATOR_CONFIRMED',
            'CONFLICT'
        )),
    batch_net_amount numeric(12, 2),
    deposit_amount numeric(12, 2),
    difference_amount numeric(12, 2),
    evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    conflict_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    event_key text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT settlement_batch_deposit_batch_fk
        FOREIGN KEY (settlement_batch_id, merchant_id)
        REFERENCES settlement_batches(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_batch_deposit_deposit_fk
        FOREIGN KEY (bank_deposit_id, merchant_id)
        REFERENCES settlement_bank_deposits(id, merchant_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX settlement_batch_deposit_matches_id_merchant_unique
    ON settlement_batch_deposit_matches (id, merchant_id);
CREATE UNIQUE INDEX settlement_batch_deposit_matches_pair_unique
    ON settlement_batch_deposit_matches (merchant_id, settlement_batch_id, bank_deposit_id);
CREATE UNIQUE INDEX settlement_batch_deposit_matches_event_key_unique
    ON settlement_batch_deposit_matches (event_key)
    WHERE event_key IS NOT NULL;
CREATE INDEX settlement_batch_deposit_matches_merchant_idx
    ON settlement_batch_deposit_matches (merchant_id, created_at DESC);
