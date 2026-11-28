# Worker Operations and Recovery

## Workers

Run the PostgreSQL-backed workers with the application environment:

```bash
npm run worker:webhooks
npm run worker:timeouts
npm run worker:notifications
```

Start multiple worker processes only when `SKIP LOCKED` and the configured batch and lease settings are acceptable. No Redis queue or external worker database is required.

## Leases

- Webhook and notification jobs use database leases and `FOR UPDATE SKIP LOCKED`.
- An expired lease is reclaimed by another worker.
- Timeout processing only changes aged PENDING attempts; it cannot override terminal attempts.
- Bounded retries move exhausted webhook and notification work to FAILED.
- Reconciliation conflicts are retained as review evidence and never silently applied.

## Health and alerts

Use `GET /health` or `GET /api/health` for database and operational queue visibility. The response includes webhook, notification, unresolved-payment, and reconciliation-conflict counts.

`OPERATION_ALERT_THRESHOLD` sets the minimum failed-work or conflict count that makes health degraded. The default threshold is 1.

Workers emit `REVIEW_REQUIRED` console alerts when work exhausts its retry budget. Route application logs to the deployment's existing alerting or log-monitoring mechanism.

## Manual recovery

- Review failed webhook events through `GET /api/admin/webhook-events`.
- Retry a failed webhook only with `POST /api/admin/webhook-events/:eventId/retry`.
- Retry authorization requires the ADMIN role, a reason of at least 8 characters, and supporting evidence.
- Repeated retries are idempotent and create at most one audit event per webhook event.
- Review unqueryable Payment Attempts through `POST /api/admin/payment-attempts/:transactionId/recovery-dispositions`.
- Recovery requires ADMIN authorization and supporting evidence; it does not create a Provider Transaction or provider outcome.
- Retry operator actions are auditable in `GET /api/admin/audit-logs`.

## Alert response

1. Open `GET /api/admin/operations`.
2. Identify FAILED, PROCESSING, PENDING, TIMEOUT, and MISMATCH work.
3. Check audit logs and reconciliation evidence before changing financial state.
4. Resolve provider evidence or retry only when the approved policy permits it.
5. Verify that no duplicate Provider Transaction, allocation, credit, or notification was created.

## Shutdown

Workers handle SIGINT and SIGTERM and stop accepting new batches. Database leases expire and can be reclaimed after a worker restart.
