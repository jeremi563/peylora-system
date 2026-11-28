CREATE TABLE settlement_source_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    file_format text NOT NULL
        CHECK (file_format IN ('CSV', 'XLSX')),
    required_headers jsonb NOT NULL,
    optional_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO settlement_source_profiles (
    code, name, file_format, required_headers, optional_headers
) VALUES
(
    'PEYLORA_GENERIC_CSV_V1',
    'Peylora Generic Settlement CSV',
    'CSV',
    '["provider_reference","transaction_date","settlement_date","gross_amount","currency","status"]'::jsonb,
    '["batch_reference","fee_amount","net_amount","bank_reference","bank_value_date","transaction_count","adjustment_type","phone_number","merchant_reference"]'::jsonb
),
(
    'PEYLORA_GENERIC_XLSX_V1',
    'Peylora Generic Settlement Excel',
    'XLSX',
    '["provider_reference","transaction_date","settlement_date","gross_amount","currency","status"]'::jsonb,
    '["batch_reference","fee_amount","net_amount","bank_reference","bank_value_date","transaction_count","adjustment_type","phone_number","merchant_reference"]'::jsonb
);

CREATE TABLE settlement_evidence_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    profile_id uuid NOT NULL REFERENCES settlement_source_profiles(id) ON DELETE RESTRICT,
    status text NOT NULL
        CHECK (status IN ('RECEIVED', 'VALIDATING', 'VALIDATED', 'EXCEPTION', 'SUPERSEDED')),
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes integer NOT NULL CHECK (size_bytes > 0),
    sha256 char(64) NOT NULL,
    original_bytes bytea NOT NULL,
    parsed_row_count integer NOT NULL DEFAULT 0 CHECK (parsed_row_count >= 0),
    validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    received_at timestamptz NOT NULL DEFAULT NOW(),
    completed_at timestamptz,
    superseded_by_import_id uuid,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX settlement_evidence_import_merchant_fingerprint_unique
    ON settlement_evidence_imports (merchant_id, sha256);
CREATE UNIQUE INDEX settlement_evidence_import_id_merchant_unique
    ON settlement_evidence_imports (id, merchant_id);
CREATE INDEX settlement_evidence_import_merchant_created_idx
    ON settlement_evidence_imports (merchant_id, created_at DESC);

CREATE TABLE settlement_evidence_rows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id uuid NOT NULL,
    merchant_id uuid NOT NULL,
    row_number integer NOT NULL CHECK (row_number >= 1),
    raw_values jsonb NOT NULL,
    normalized_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    validation_status text NOT NULL
        CHECK (validation_status IN ('VALID', 'EXCEPTION')),
    validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT settlement_evidence_row_import_fk
        FOREIGN KEY (import_id, merchant_id)
        REFERENCES settlement_evidence_imports(id, merchant_id)
        ON DELETE RESTRICT,
    UNIQUE (import_id, merchant_id, row_number)
);

CREATE INDEX settlement_evidence_row_import_status_idx
    ON settlement_evidence_rows (import_id, validation_status);
