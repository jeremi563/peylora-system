ALTER TABLE payments
    ADD COLUMN payment_link_id uuid REFERENCES payment_links(id) ON DELETE SET NULL;

CREATE INDEX payments_payment_link_created_at_idx
    ON payments (payment_link_id, created_at DESC);