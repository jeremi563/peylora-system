ALTER TABLE payments
    ADD COLUMN invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;

ALTER TABLE payment_links
    ADD COLUMN invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX payments_invoice_created_at_idx
    ON payments (invoice_id, created_at DESC);
CREATE INDEX payment_links_invoice_created_at_idx
    ON payment_links (invoice_id, created_at DESC);