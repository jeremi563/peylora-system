-- Add a separate invoice status for allocation-derived partial payments.
ALTER TABLE invoices
    DROP CONSTRAINT invoices_status_check;

ALTER TABLE invoices
    ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('DRAFT', 'SENT', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'));

-- Composite identity indexes allow child financial records to prove both merchant and entity ownership.
CREATE UNIQUE INDEX customers_id_merchant_unique
    ON customers (id, merchant_id);
CREATE UNIQUE INDEX payments_id_merchant_unique
    ON payments (id, merchant_id);
CREATE UNIQUE INDEX transactions_id_merchant_unique
    ON transactions (id, merchant_id);
CREATE UNIQUE INDEX invoices_id_merchant_unique
    ON invoices (id, merchant_id);

-- Provider Transaction: a sufficiently evidenced provider-side financial outcome.
-- An STK initiation acknowledgement does not create one of these rows.
CREATE TABLE provider_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    attempt_transaction_id uuid NOT NULL,
    provider text NOT NULL DEFAULT 'MPESA'
        CHECK (provider IN ('MPESA')),
    outcome text NOT NULL
        CHECK (outcome IN ('SUCCESS', 'FAILED', 'CANCELLED')),
    provider_reference text,
    received_amount numeric(12, 2),
    currency char(3) NOT NULL DEFAULT 'KES'
        CHECK (currency IN ('KES')),
    evidence_type text
        CHECK (evidence_type IN ('CALLBACK', 'STATUS_QUERY')),
    evidence_event_key text,
    evidence_payload jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT provider_transactions_attempt_fk
        FOREIGN KEY (attempt_transaction_id, merchant_id)
        REFERENCES transactions(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT provider_transactions_success_received_amount_check
        CHECK (
            (outcome = 'SUCCESS' AND received_amount > 0)
            OR
            (outcome != 'SUCCESS' AND received_amount IS NULL)
        )
);

CREATE UNIQUE INDEX provider_transactions_attempt_unique
    ON provider_transactions (attempt_transaction_id);
CREATE UNIQUE INDEX provider_transactions_reference_unique
    ON provider_transactions (merchant_id, provider, provider_reference)
    WHERE provider_reference IS NOT NULL;
CREATE UNIQUE INDEX provider_transactions_id_merchant_unique
    ON provider_transactions (id, merchant_id);
CREATE INDEX provider_transactions_merchant_created_at_idx
    ON provider_transactions (merchant_id, created_at DESC);

-- Unassigned received funds are separate from customer credit.
CREATE TABLE unassigned_received_funds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    provider_transaction_id uuid NOT NULL,
    received_amount numeric(12, 2) NOT NULL
        CHECK (received_amount > 0),
    allocated_amount numeric(12, 2) NOT NULL DEFAULT 0
        CHECK (allocated_amount >= 0),
    currency char(3) NOT NULL DEFAULT 'KES'
        CHECK (currency IN ('KES')),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT unassigned_received_funds_provider_fk
        FOREIGN KEY (provider_transaction_id, merchant_id)
        REFERENCES provider_transactions(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT unassigned_received_funds_allocation_check
        CHECK (allocated_amount <= received_amount)
);

CREATE UNIQUE INDEX unassigned_received_funds_provider_unique
    ON unassigned_received_funds (provider_transaction_id);
CREATE UNIQUE INDEX unassigned_received_funds_id_merchant_unique
    ON unassigned_received_funds (id, merchant_id);
CREATE INDEX unassigned_received_funds_merchant_created_at_idx
    ON unassigned_received_funds (merchant_id, created_at DESC);

-- Credit balances are stored for a consistency strategy:
-- financial operations lock the balance row and update balance plus ledger atomically.
CREATE TABLE customer_credit_balances (
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    customer_id uuid NOT NULL,
    available_amount numeric(12, 2) NOT NULL DEFAULT 0
        CHECK (available_amount >= 0),
    currency char(3) NOT NULL DEFAULT 'KES'
        CHECK (currency IN ('KES')),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (merchant_id, customer_id),
    CONSTRAINT customer_credit_balances_customer_fk
        FOREIGN KEY (customer_id, merchant_id)
        REFERENCES customers(id, merchant_id)
        ON DELETE RESTRICT
);

CREATE TABLE customer_credit_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    customer_id uuid NOT NULL,
    entry_type text NOT NULL
        CHECK (entry_type IN ('CREDIT', 'DEBIT', 'REVERSAL', 'ADJUSTMENT')),
    direction text NOT NULL
        CHECK (direction IN ('INCREASE', 'DECREASE')),
    amount numeric(12, 2) NOT NULL
        CHECK (amount > 0),
    provider_transaction_id uuid,
    allocation_id uuid,
    allocation_reversal_id uuid,
    event_key text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT customer_credit_ledger_customer_fk
        FOREIGN KEY (customer_id, merchant_id)
        REFERENCES customers(id, merchant_id)
        ON DELETE RESTRICT,
    CHECK (
            (entry_type = 'CREDIT' AND direction = 'INCREASE')
            OR
            (entry_type = 'DEBIT' AND direction = 'DECREASE')
            OR
            (entry_type = 'REVERSAL' AND direction = 'INCREASE')
            OR
            (entry_type = 'ADJUSTMENT')
        )
);

CREATE UNIQUE INDEX customer_credit_ledger_id_merchant_customer_unique
    ON customer_credit_ledger (id, merchant_id, customer_id);
CREATE UNIQUE INDEX customer_credit_ledger_event_key_unique
    ON customer_credit_ledger (event_key)
    WHERE event_key IS NOT NULL;
CREATE INDEX customer_credit_ledger_customer_created_at_idx
    ON customer_credit_ledger (merchant_id, customer_id, created_at DESC);
CREATE INDEX customer_credit_ledger_provider_transaction_idx
    ON customer_credit_ledger (provider_transaction_id)
    WHERE provider_transaction_id IS NOT NULL;

-- Payment allocations link received or credited value to eligible invoices.
-- Source fields are mutually exclusive.
CREATE TABLE payment_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    invoice_id uuid NOT NULL,
    customer_id uuid,
    source_type text NOT NULL
        CHECK (source_type IN ('RECEIVED_PAYMENT', 'CUSTOMER_CREDIT', 'UNASSIGNED_FUNDS')),
    provider_transaction_id uuid,
    unassigned_received_funds_id uuid,
    amount numeric(12, 2) NOT NULL
        CHECK (amount > 0),
    event_key text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT payment_allocations_invoice_fk
        FOREIGN KEY (invoice_id, merchant_id)
        REFERENCES invoices(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT payment_allocations_customer_fk
        FOREIGN KEY (customer_id, merchant_id)
        REFERENCES customers(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT payment_allocations_provider_fk
        FOREIGN KEY (provider_transaction_id, merchant_id)
        REFERENCES provider_transactions(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT payment_allocations_unassigned_fk
        FOREIGN KEY (unassigned_received_funds_id, merchant_id)
        REFERENCES unassigned_received_funds(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT payment_allocations_source_check
        CHECK (
            (
                source_type = 'RECEIVED_PAYMENT'
                AND provider_transaction_id IS NOT NULL
                AND unassigned_received_funds_id IS NULL
            )
            OR
            (
                source_type = 'CUSTOMER_CREDIT'
                AND provider_transaction_id IS NULL
                AND unassigned_received_funds_id IS NULL
                AND customer_id IS NOT NULL
            )
            OR
            (
                source_type = 'UNASSIGNED_FUNDS'
                AND unassigned_received_funds_id IS NOT NULL
                AND provider_transaction_id IS NULL
                AND customer_id IS NULL
            )
        )
);

CREATE UNIQUE INDEX payment_allocations_id_merchant_unique
    ON payment_allocations (id, merchant_id);
CREATE UNIQUE INDEX payment_allocations_id_merchant_customer_unique
    ON payment_allocations (id, merchant_id, customer_id);
CREATE UNIQUE INDEX payment_allocations_event_key_unique
    ON payment_allocations (event_key)
    WHERE event_key IS NOT NULL;
CREATE UNIQUE INDEX payment_allocations_received_source_unique
    ON payment_allocations (provider_transaction_id, invoice_id)
    WHERE source_type = 'RECEIVED_PAYMENT';
CREATE UNIQUE INDEX payment_allocations_unassigned_source_unique
    ON payment_allocations (unassigned_received_funds_id, invoice_id)
    WHERE source_type = 'UNASSIGNED_FUNDS';
CREATE INDEX payment_allocations_invoice_created_at_idx
    ON payment_allocations (merchant_id, invoice_id, created_at DESC);
CREATE INDEX payment_allocations_customer_created_at_idx
    ON payment_allocations (merchant_id, customer_id, created_at DESC)
    WHERE customer_id IS NOT NULL;

ALTER TABLE customer_credit_ledger
    ADD CONSTRAINT customer_credit_ledger_provider_fk
    FOREIGN KEY (provider_transaction_id, merchant_id)
    REFERENCES provider_transactions(id, merchant_id)
    ON DELETE RESTRICT,
    ADD CONSTRAINT customer_credit_ledger_allocation_fk
    FOREIGN KEY (allocation_id, merchant_id, customer_id)
    REFERENCES payment_allocations(id, merchant_id, customer_id)
    ON DELETE RESTRICT;

-- Allocation reversals are append-only and one reversal per original allocation.
CREATE TABLE allocation_reversals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    original_allocation_id uuid NOT NULL,
    reason text,
    event_key text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT allocation_reversals_original_fk
        FOREIGN KEY (original_allocation_id, merchant_id)
        REFERENCES payment_allocations(id, merchant_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX allocation_reversals_original_unique
    ON allocation_reversals (original_allocation_id);
CREATE UNIQUE INDEX allocation_reversals_id_merchant_unique
    ON allocation_reversals (id, merchant_id);
CREATE UNIQUE INDEX allocation_reversals_event_key_unique
    ON allocation_reversals (event_key)
    WHERE event_key IS NOT NULL;

ALTER TABLE customer_credit_ledger
    ADD CONSTRAINT customer_credit_ledger_reversal_fk
    FOREIGN KEY (allocation_reversal_id, merchant_id)
    REFERENCES allocation_reversals(id, merchant_id)
    ON DELETE RESTRICT;
