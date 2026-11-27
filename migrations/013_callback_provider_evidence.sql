ALTER TABLE reconciliation_events
    DROP CONSTRAINT reconciliation_events_evidence_type_check,
    ADD CONSTRAINT reconciliation_events_evidence_type_check
        CHECK (evidence_type IN ('STATUS_QUERY', 'CALLBACK_VERIFICATION'));

ALTER TABLE reconciliation_events
    DROP CONSTRAINT reconciliation_events_agreement_check,
    ADD CONSTRAINT reconciliation_events_agreement_check
        CHECK (agreement IN ('MATCH', 'MISMATCH', 'NO_CALLBACK', 'UNVERIFIED'));

CREATE INDEX reconciliation_events_conflict_idx
    ON reconciliation_events (merchant_id, created_at DESC)
    WHERE agreement = 'MISMATCH';
