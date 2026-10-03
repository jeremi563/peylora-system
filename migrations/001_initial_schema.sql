CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    phone_number varchar(15),
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'MERCHANT' CHECK (role IN ('ADMIN', 'MERCHANT', 'CUSTOMER')),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    email_verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE merchants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    business_name text NOT NULL,
    business_description text,
    business_phone varchar(15),
    business_email text,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE,
    name text,
    phone_number varchar(15) NOT NULL,
    email text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (merchant_id, phone_number)
);

CREATE TABLE payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid REFERENCES merchants(id) ON DELETE RESTRICT,
    customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
    reference varchar(64) NOT NULL UNIQUE,
    amount numeric(12, 2) NOT NULL CHECK (amount > 0),
    currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
    phone_number varchar(15) NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'CREATED'
        CHECK (status IN ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT')),
    idempotency_key text,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (merchant_id, idempotency_key)
);

CREATE TABLE transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    merchant_id uuid REFERENCES merchants(id) ON DELETE RESTRICT,
    account_reference varchar(64) NOT NULL UNIQUE,
    provider text NOT NULL DEFAULT 'MPESA' CHECK (provider = 'MPESA'),
    amount numeric(12, 2) NOT NULL CHECK (amount > 0),
    paid_amount numeric(12, 2) CHECK (paid_amount IS NULL OR paid_amount > 0),
    currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
    amount_matches boolean,
    phone_number varchar(15) NOT NULL,
    paid_from_phone_number varchar(15),
    status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT')),
    merchant_request_id text,
    checkout_request_id text,
    mpesa_receipt_number text,
    provider_transaction_date varchar(14),
    result_code integer,
    result_description text,
    stk_response_code text,
    stk_response_description text,
    stk_response jsonb,
    callback_metadata jsonb,
    failure_reason text,
    callback_received_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX transactions_checkout_request_id_unique
    ON transactions (checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE UNIQUE INDEX transactions_mpesa_receipt_number_unique
    ON transactions (mpesa_receipt_number) WHERE mpesa_receipt_number IS NOT NULL;
CREATE INDEX transactions_payment_id_created_at_idx ON transactions (payment_id, created_at DESC);
CREATE INDEX transactions_status_created_at_idx ON transactions (status, created_at DESC);

CREATE TABLE payment_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
    reference varchar(64) NOT NULL UNIQUE,
    description text NOT NULL,
    amount numeric(12, 2) NOT NULL CHECK (amount > 0),
    currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'EXPIRED')),
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
    invoice_number varchar(64) NOT NULL,
    currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
    total_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    status text NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'SENT', 'PENDING', 'PAID', 'OVERDUE', 'CANCELLED')),
    due_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (merchant_id, invoice_number)
);

CREATE TABLE invoice_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description text NOT NULL,
    quantity numeric(10, 2) NOT NULL CHECK (quantity > 0),
    unit_amount numeric(12, 2) NOT NULL CHECK (unit_amount >= 0),
    line_total numeric(12, 2) GENERATED ALWAYS AS (quantity * unit_amount) STORED,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    description text,
    price_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
    currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
    billing_interval text NOT NULL DEFAULT 'MONTHLY'
        CHECK (billing_interval IN ('MONTHLY', 'YEARLY')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'TRIAL'
        CHECK (status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED')),
    start_date timestamptz NOT NULL DEFAULT NOW(),
    renewal_date timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX subscriptions_merchant_created_at_idx ON subscriptions (merchant_id, created_at DESC);

CREATE TABLE refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);

CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL,
    channel text NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL')),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    read_at timestamptz,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX notifications_user_created_at_idx ON notifications (user_id, created_at DESC);

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    merchant_id uuid REFERENCES merchants(id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text,
    entity_id uuid,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_logs_merchant_created_at_idx ON audit_logs (merchant_id, created_at DESC);

CREATE TABLE webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    event_type text NOT NULL,
    event_key text UNIQUE,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    processed_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX webhook_events_status_created_at_idx ON webhook_events (status, created_at);