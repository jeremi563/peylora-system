CREATE TABLE settlement_reconciliation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    run_type text NOT NULL
        CHECK (run_type IN ('PROVIDER_MATCH', 'BATCH_DEPOSIT', 'FULL_RECONCILIATION')),
    status text NOT NULL
        CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
    started_at timestamptz NOT NULL DEFAULT NOW(),
    completed_at timestamptz,
    evidence_hash char(64),
    snapshot_hash char(64),
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_json jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX settlement_reconciliation_runs_id_merchant_unique
    ON settlement_reconciliation_runs (id, merchant_id);
CREATE INDEX settlement_reconciliation_runs_merchant_created_idx
    ON settlement_reconciliation_runs (merchant_id, created_at DESC);

CREATE TABLE settlement_reconciliation_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    run_id uuid NOT NULL,
    snapshot_hash char(64) NOT NULL,
    snapshot_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT settlement_snapshots_run_fk
        FOREIGN KEY (run_id, merchant_id)
        REFERENCES settlement_reconciliation_runs(id, merchant_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX settlement_reconciliation_snapshots_id_merchant_unique
    ON settlement_reconciliation_snapshots (id, merchant_id);
CREATE UNIQUE INDEX settlement_reconciliation_snapshots_hash_unique
    ON settlement_reconciliation_snapshots (merchant_id, run_id, snapshot_hash);
CREATE INDEX settlement_reconciliation_snapshots_merchant_created_idx
    ON settlement_reconciliation_snapshots (merchant_id, created_at DESC);

ALTER TABLE settlement_matches
    ADD COLUMN IF NOT EXISTS resolution_status text NOT NULL DEFAULT 'OPEN'
        CHECK (resolution_status IN ('OPEN', 'CONFIRMED', 'DISMISSED')),
    ADD COLUMN IF NOT EXISTS resolution_reason text,
    ADD COLUMN IF NOT EXISTS resolved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
