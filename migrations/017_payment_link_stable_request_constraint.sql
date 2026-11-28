ALTER TABLE payment_links
    DROP CONSTRAINT IF EXISTS payment_links_payment_id_fkey,
    DROP CONSTRAINT IF EXISTS payment_links_payment_fk;

CREATE UNIQUE INDEX IF NOT EXISTS payment_links_id_merchant_unique
    ON payment_links (id, merchant_id);

ALTER TABLE payment_links
    ADD CONSTRAINT payment_links_payment_fk
        FOREIGN KEY (payment_id, merchant_id)
        REFERENCES payments(id, merchant_id)
        ON DELETE RESTRICT;
