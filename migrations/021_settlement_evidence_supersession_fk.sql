ALTER TABLE settlement_evidence_imports
    ADD CONSTRAINT settlement_evidence_import_superseded_fk
        FOREIGN KEY (superseded_by_import_id, merchant_id)
        REFERENCES settlement_evidence_imports(id, merchant_id)
        ON DELETE RESTRICT;
