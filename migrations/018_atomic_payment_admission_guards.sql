DO $$
DECLARE
    duplicate_payment_count bigint;
BEGIN
    SELECT COUNT(*)::bigint
    INTO duplicate_payment_count
    FROM (
        SELECT payment_id
        FROM transactions
        WHERE status = 'PENDING'
        GROUP BY payment_id
        HAVING COUNT(*) > 1
    ) duplicate_payments;

    IF duplicate_payment_count > 0 THEN
        RAISE EXCEPTION
            'Cannot apply atomic payment admission guard: % payment requests have multiple PENDING attempts',
            duplicate_payment_count
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_pending_per_payment_unique
    ON transactions (payment_id)
    WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION enforce_payment_attempt_admission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment_row payments%ROWTYPE;
    latest_attempt transactions%ROWTYPE;
    recovery_exists boolean;
    fulfillment_received numeric(12,2);
    bound_link payment_links%ROWTYPE;
BEGIN
    SELECT *
    INTO payment_row
    FROM payments
    WHERE id = NEW.payment_id
      AND merchant_id = NEW.merchant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_REQUEST_NOT_FOUND'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT *
    INTO latest_attempt
    FROM transactions
    WHERE payment_id = NEW.payment_id
      AND merchant_id = NEW.merchant_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF latest_attempt.status = 'PENDING' THEN
        RAISE EXCEPTION 'UNRESOLVED_PAYMENT_ATTEMPT'
            USING ERRCODE = 'P0001';
    END IF;

    IF latest_attempt.status = 'TIMEOUT' THEN
        SELECT EXISTS (
            SELECT 1
            FROM payment_attempt_recovery_dispositions recovery
            WHERE recovery.attempt_transaction_id = latest_attempt.id
              AND recovery.merchant_id = NEW.merchant_id
              AND NOT EXISTS (
                  SELECT 1
                  FROM transactions recovered_attempt
                  WHERE recovered_attempt.recovery_disposition_id = recovery.id
              )
        ) INTO recovery_exists;

        IF NOT COALESCE(recovery_exists, false) THEN
            RAISE EXCEPTION 'UNRESOLVED_PAYMENT_ATTEMPT'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    SELECT COALESCE(SUM(pt.received_amount), 0)
    INTO fulfillment_received
    FROM transactions attempt
    JOIN provider_transactions pt
      ON pt.attempt_transaction_id = attempt.id
     AND pt.merchant_id = attempt.merchant_id
     AND pt.outcome = 'SUCCESS'
    WHERE attempt.merchant_id = NEW.merchant_id
      AND (
          attempt.payment_id = NEW.payment_id
          OR (
              payment_row.payment_link_id IS NOT NULL
              AND attempt.payment_id IN (
                  SELECT historical.id
                  FROM payments historical
                  WHERE historical.payment_link_id = payment_row.payment_link_id
                    AND historical.merchant_id = NEW.merchant_id
              )
          )
      );

    IF fulfillment_received >= payment_row.amount THEN
        RAISE EXCEPTION 'PAYMENT_REQUEST_FULFILLED'
            USING ERRCODE = 'P0001';
    END IF;

    IF payment_row.payment_link_id IS NOT NULL THEN
        SELECT *
        INTO bound_link
        FROM payment_links
        WHERE id = payment_row.payment_link_id
          AND merchant_id = NEW.merchant_id
        FOR UPDATE;

        IF NOT FOUND
           OR bound_link.status <> 'ACTIVE'
           OR bound_link.consumed_at IS NOT NULL
           OR (bound_link.expires_at IS NOT NULL AND bound_link.expires_at <= NOW()) THEN
            RAISE EXCEPTION 'PAYMENT_LINK_UNAVAILABLE'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_enforce_payment_attempt_admission
    ON transactions;

CREATE TRIGGER transactions_enforce_payment_attempt_admission
BEFORE INSERT ON transactions
FOR EACH ROW
EXECUTE FUNCTION enforce_payment_attempt_admission();
