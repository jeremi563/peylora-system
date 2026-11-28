ALTER TABLE payment_links
    DROP CONSTRAINT IF EXISTS payment_links_payment_id_fkey;

ALTER TABLE payment_links
    ADD COLUMN use_mode text,
    ADD COLUMN consumed_at timestamptz;

UPDATE payment_links
SET use_mode = 'REUSABLE';

ALTER TABLE payment_links
    ALTER COLUMN use_mode SET DEFAULT 'REUSABLE',
    ALTER COLUMN use_mode SET NOT NULL,
    ADD CONSTRAINT payment_links_use_mode_check
        CHECK (use_mode IN ('SINGLE_USE', 'REUSABLE'));

CREATE UNIQUE INDEX payment_links_id_merchant_unique
    ON payment_links (id, merchant_id);

UPDATE payment_links pl
SET payment_id = (
    SELECT p.id
    FROM payments p
    WHERE p.payment_link_id = pl.id
      AND p.merchant_id = pl.merchant_id
    ORDER BY p.created_at ASC, p.id ASC
    LIMIT 1
)
WHERE pl.payment_id IS NULL;

WITH missing_links AS (
    SELECT pl.id, pl.merchant_id, pl.invoice_id, pl.reference,
           pl.description, pl.amount
    FROM payment_links pl
    WHERE pl.payment_id IS NULL
),
created_requests AS (
    INSERT INTO payments (
        merchant_id, invoice_id, reference, amount, currency,
        phone_number, description, status
    )
    SELECT merchant_id, invoice_id,
           'LINK-' || id::text,
           amount, 'KES',
           '254700000000',
           description,
           'PENDING'
    FROM missing_links
    RETURNING id, merchant_id, reference
)
UPDATE payment_links pl
SET payment_id = created.id
FROM created_requests created
WHERE pl.merchant_id = created.merchant_id
  AND created.reference = 'LINK-' || pl.id::text;

UPDATE payments p
SET payment_link_id = pl.id,
    updated_at = NOW()
FROM payment_links pl
WHERE pl.payment_id = p.id
  AND pl.merchant_id = p.merchant_id
  AND p.payment_link_id IS NULL;

ALTER TABLE payment_links
    ALTER COLUMN payment_id SET NOT NULL,
    ADD CONSTRAINT payment_links_payment_fk
        FOREIGN KEY (payment_id, merchant_id)
        REFERENCES payments(id, merchant_id)
        ON DELETE RESTRICT;

CREATE UNIQUE INDEX payment_links_payment_unique
    ON payment_links (payment_id);
