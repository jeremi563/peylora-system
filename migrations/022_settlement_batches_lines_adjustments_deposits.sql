CREATE UNIQUE INDEX IF NOT EXISTS settlement_evidence_row_id_import_merchant_unique
    ON settlement_evidence_rows (id, import_id, merchant_id);

CREATE TABLE settlement_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    evidence_import_id uuid,
    source_provider text NOT NULL DEFAULT 'MPESA',
    source_batch_reference text,
    period_start date,
    period_end date,
    settlement_effective_date date,
    currency char(3) NOT NULL DEFAULT 'KES'
        CHECK (currency IN ('KES')),
    gross_amount numeric(12, 2),
    fee_amount numeric(12, 2),
    net_amount numeric(12, 2),
    transaction_count integer CHECK (transaction_count >= 0),
    status text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (status IN (
            'EXPECTED',
            'PARTIAL',
            'SETTLED',
            'DELAYED',
            'ADJUSTED',
            'CONFLICT',
            'UNKNOWN'
        )),
    source_hash char(64),
    raw_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT settlement_batches_import_fk
        FOREIGN KEY (evidence_import_id, merchant_id)
        REFERENCES settlement_evidence_imports(id, merchant_id)
        ON DELETE RESTRICT,
    CHECK (
        (gross_amount IS NULL OR gross_amount >= 0)
        AND (fee_amount IS NULL OR fee_amount >= 0)
        AND (net_amount IS NULL OR net_amount >= 0)
    ),
    CHECK (
        period_start IS NULL
        OR period_end IS NULL
        OR period_start <= period_end
    )
);

CREATE UNIQUE INDEX settlement_batches_id_merchant_unique
    ON settlement_batches (id, merchant_id);
CREATE UNIQUE INDEX settlement_batches_source_natural_key_unique
    ON settlement_batches (
        merchant_id,
        evidence_import_id,
        COALESCE(source_batch_reference, ''),
        COALESCE(settlement_effective_date, '1900-01-01'::date)
    )
    WHERE source_batch_reference IS NOT NULL;
CREATE INDEX settlement_batches_merchant_created_idx
    ON settlement_batches (merchant_id, created_at DESC);
CREATE INDEX settlement_batches_status_created_idx
    ON settlement_batches (merchant_id, status, created_at DESC);

CREATE TABLE settlement_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    batch_id uuid,
    evidence_import_id uuid,
    evidence_row_id uuid,
    provider_reference text,
    receipt_reference text,
    phone_number text,
    transaction_date date,
    settlement_effective_date date,
    currency char(3) NOT NULL DEFAULT 'KES'
        CHECK (currency IN ('KES')),
    gross_amount numeric(12, 2),
    fee_amount numeric(12, 2),
    net_amount numeric(12, 2),
    status text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (status IN (
            'EXPECTED',
            'PARTIAL',
            'SETTLED',
            'DELAYED',
            'ADJUSTED',
            'CONFLICT',
            'UNKNOWN'
        )),
    raw_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT settlement_lines_batch_fk
        FOREIGN KEY (batch_id, merchant_id)
        REFERENCES settlement_batches(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_lines_import_fk
        FOREIGN KEY (evidence_import_id, merchant_id)
        REFERENCES settlement_evidence_imports(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_lines_row_fk
        FOREIGN KEY (evidence_row_id, evidence_import_id, merchant_id)
        REFERENCES settlement_evidence_rows(id, import_id, merchant_id)
        ON DELETE RESTRICT,
    CHECK (
        (gross_amount IS NULL OR gross_amount >= 0)
        AND (fee_amount IS NULL OR fee_amount >= 0)
        AND (net_amount IS NULL OR net_amount >= 0)
    )
);

CREATE UNIQUE INDEX settlement_lines_id_merchant_unique
    ON settlement_lines (id, merchant_id);
CREATE UNIQUE INDEX settlement_lines_source_row_unique
    ON settlement_lines (evidence_import_id, evidence_row_id)
    WHERE evidence_import_id IS NOT NULL
      AND evidence_row_id IS NOT NULL;
CREATE UNIQUE INDEX settlement_lines_provider_reference_unique
    ON settlement_lines (merchant_id, provider_reference)
    WHERE provider_reference IS NOT NULL;
CREATE INDEX settlement_lines_merchant_batch_idx
    ON settlement_lines (merchant_id, batch_id);
CREATE INDEX settlement_lines_merchant_status_idx
    ON settlement_lines (merchant_id, status, created_at DESC);

CREATE TABLE settlement_adjustments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    batch_id uuid,
    line_id uuid,
    evidence_import_id uuid,
    evidence_row_id uuid,
    adjustment_type text NOT NULL,
    amount numeric(12, 2),
    currency char(3) NOT NULL DEFAULT 'KES'
        CHECK (currency IN ('KES')),
    effective_date date,
    provider_reference text,
    raw_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    reversal_of_adjustment_id uuid,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT settlement_adjustments_batch_fk
        FOREIGN KEY (batch_id, merchant_id)
        REFERENCES settlement_batches(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_adjustments_line_fk
        FOREIGN KEY (line_id, merchant_id)
        REFERENCES settlement_lines(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_adjustments_import_fk
        FOREIGN KEY (evidence_import_id, merchant_id)
        REFERENCES settlement_evidence_imports(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_adjustments_row_fk
        FOREIGN KEY (evidence_row_id, evidence_import_id, merchant_id)
        REFERENCES settlement_evidence_rows(id, import_id, merchant_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX settlement_adjustments_id_merchant_unique
    ON settlement_adjustments (id, merchant_id);
ALTER TABLE settlement_adjustments
    ADD CONSTRAINT settlement_adjustments_reversal_fk
        FOREIGN KEY (reversal_of_adjustment_id, merchant_id)
        REFERENCES settlement_adjustments(id, merchant_id)
        ON DELETE RESTRICT;
CREATE UNIQUE INDEX settlement_adjustments_source_row_unique
    ON settlement_adjustments (evidence_import_id, evidence_row_id)
    WHERE evidence_import_id IS NOT NULL
      AND evidence_row_id IS NOT NULL;
CREATE INDEX settlement_adjustments_merchant_created_idx
    ON settlement_adjustments (merchant_id, created_at DESC);

CREATE TABLE settlement_bank_deposits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    evidence_import_id uuid,
    evidence_row_id uuid,
    account_alias text,
    bank_reference text,
    deposit_date date,
    value_date date,
    currency char(3) NOT NULL DEFAULT 'KES'
        CHECK (currency IN ('KES')),
    deposited_amount numeric(12, 2),
    status text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (status IN (
            'EXPECTED',
            'PARTIAL',
            'SETTLED',
            'DELAYED',
            'ADJUSTED',
            'CONFLICT',
            'UNKNOWN'
        )),
    raw_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT settlement_deposits_import_fk
        FOREIGN KEY (evidence_import_id, merchant_id)
        REFERENCES settlement_evidence_imports(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT settlement_deposits_row_fk
        FOREIGN KEY (evidence_row_id, evidence_import_id, merchant_id)
        REFERENCES settlement_evidence_rows(id, import_id, merchant_id)
        ON DELETE RESTRICT,
    CHECK (deposited_amount IS NULL OR deposited_amount >= 0)
);

CREATE UNIQUE INDEX settlement_bank_deposits_id_merchant_unique
    ON settlement_bank_deposits (id, merchant_id);
CREATE UNIQUE INDEX settlement_bank_deposits_bank_reference_unique
    ON settlement_bank_deposits (merchant_id, bank_reference)
    WHERE bank_reference IS NOT NULL;
CREATE UNIQUE INDEX settlement_bank_deposits_source_row_unique
    ON settlement_bank_deposits (evidence_import_id, evidence_row_id)
    WHERE evidence_import_id IS NOT NULL
      AND evidence_row_id IS NOT NULL;
CREATE INDEX settlement_bank_deposits_merchant_created_idx
    ON settlement_bank_deposits (merchant_id, created_at DESC);
