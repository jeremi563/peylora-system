CREATE INDEX webhook_events_mpesa_checkout_request_idx
    ON webhook_events ((payload->'callback'->>'CheckoutRequestID'))
    WHERE provider = 'MPESA' AND event_type = 'STK_CALLBACK';
