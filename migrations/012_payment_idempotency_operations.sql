CREATE TABLE payment_idempotency_operations (
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    idempotency_key text NOT NULL,
    operation_type text NOT NULL
        CHECK (operation_type IN ('INITIAL', 'RETRY')),
    request_hash char(64),
    payment_id uuid NOT NULL,
    attempt_id uuid,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (merchant_id, idempotency_key),
    CONSTRAINT payment_idempotency_operations_payment_fk
        FOREIGN KEY (payment_id, merchant_id)
        REFERENCES payments(id, merchant_id)
        ON DELETE RESTRICT,
    CONSTRAINT payment_idempotency_operations_attempt_fk
        FOREIGN KEY (attempt_id, merchant_id)
        REFERENCES transactions(id, merchant_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX payment_idempotency_operations_attempt_unique
    ON payment_idempotency_operations (attempt_id)
    WHERE attempt_id IS NOT NULL;

INSERT INTO payment_idempotency_operations (
    merchant_id, idempotency_key, operation_type, request_hash,
    payment_id, attempt_id, created_at
)
SELECT p.merchant_id, p.idempotency_key, 'INITIAL', p.idempotency_request_hash,
       p.id, initial_attempt.id, p.created_at
FROM payments p
LEFT JOIN LATERAL (
    SELECT t.id
    FROM transactions t
    WHERE t.payment_id = p.id AND t.merchant_id = p.merchant_id
    ORDER BY t.created_at ASC, t.id ASC
    LIMIT 1
) initial_attempt ON true
WHERE p.merchant_id IS NOT NULL
  AND p.idempotency_key IS NOT NULL;
