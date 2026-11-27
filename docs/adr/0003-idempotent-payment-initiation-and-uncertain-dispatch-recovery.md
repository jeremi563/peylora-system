# ADR-003: Idempotent Payment Initiation and Uncertain Dispatch Recovery

**Status:** Approved

## Context and problem statement

Payment initiation spans a PostgreSQL transaction and a network request to Daraja. A caller can repeat an HTTP request, concurrent callers can race, and the application can lose the Daraja response after the provider may have accepted the STK request. The application cannot safely interpret a network timeout as provider failure or automatically resend an uncertain request.

The current integration creates a Payment Request and Payment Attempt before calling Daraja. Idempotency is optional for initial requests, and retry keys are not persisted. A lost response can leave the attempt without a CheckoutRequestID, making the existing status-query endpoint unusable for that dispatch.

## Decision

### Idempotency

- Every logical Payment initiation or retry is an operation with a client-supplied Idempotency-Key.
- The key is scoped to the Merchant and operation; the operation's canonical request hash is persisted in PostgreSQL under a database uniqueness constraint.
- A repeated key with the same request returns the original Payment Request/Payment Attempt and does not issue another Daraja request.
- Reusing a key with a different request or operation returns a conflict. An intentional new retry uses a new key and creates a new Payment Attempt under the same Payment Request.
- Idempotency data is durable for the lifetime of the operation's financial history; it is not an in-memory cache.
- `/api/v1` requires the key immediately. Keyless legacy `/api` requests are instrumented and deprecated for 90 days after an announced start date, after which they are rejected. The migration must not silently change existing legacy behavior before that grace period expires.
- A client keeps the key stable for transport retries of one user intent and uses a new key only for a deliberate new operation.

### Dispatch and uncertainty

- Dispatch intent and attempt identity are persisted before the Daraja network call.
- A response that is lost after dispatch produces an uncertain outcome, not FAILED and not proof of non-payment.
- An uncertain dispatch is never automatically resent.
- If an attempt has a provider identifier, a final, documented Daraja status-query result may resolve the provider outcome and establish at most one Provider Transaction. In-progress, transient, malformed, and unrecognized responses remain unresolved.
- If no provider identifier exists for a status query, only an authorized Peylora operator may resolve whether a new retry is allowed. The resolution records the actor, reason, time, and evidence. It does not fabricate a provider response or Provider Transaction, and it does not convert an unknown provider outcome into a provider-reported failure.
- A new Payment Attempt can be admitted only after the prior attempt is terminally resolved by provider evidence or has an audited operator recovery disposition.
- At most one unresolved Payment Attempt may exist for a Payment Request. This invariant is enforced transactionally and at the database boundary, not by an application-memory check alone.

## Rationale

Database-enforced idempotency protects against repeated and concurrent client requests. Separating an operator-authorized recovery disposition from provider outcome preserves uncertainty honestly while still allowing an audited business decision to restore collection capability.

The design uses the existing PostgreSQL persistence and worker approach. It does not claim exactly-once delivery to Daraja: without a provider-supported idempotency mechanism, Peylora must prevent its own duplicate dispatches and stop automatic retries when the provider outcome is uncertain.

## Alternatives considered

### Optional or process-local idempotency

Rejected because requests without keys and concurrent application instances could create duplicate Payment Attempts or STK prompts. An in-memory cache is not durable and cannot be the financial integrity boundary.

### Treating TIMEOUT as FAILED and retrying automatically

Rejected because Daraja may have accepted the original request. A second prompt can cause a second successful charge.

### Retrying an uncertain network request automatically

Rejected because a local transport failure does not establish that the provider did not receive the request.

### Letting a Merchant override an unqueryable dispatch

Rejected for this milestone because the Merchant cannot independently establish whether Daraja accepted the original request. An authorized Peylora operator review is required, with an explicit audit record.

### Adding Redis or a new queue platform

Rejected because PostgreSQL-backed durable processing already exists and no queue replacement is required to meet these decisions.

## Consequences

- Initiation and retry endpoints must persist operation keys and hashes and return an idempotent response on replay.
- The compatibility rollout requires instrumentation and an announced 90-day legacy grace period.
- Dispatch state and recovery disposition are distinct from Provider Transaction outcome.
- Operator recovery requires authorization and audit evidence.
- The system preserves uncertain outcomes for review rather than manufacturing a clean failure state.

## Scope limitations

This ADR does not define refund processing, settlement reconciliation, or a provider-independent dispatch framework. Provider result-code classification must use current authoritative Daraja documentation; unknown or nonterminal results remain unresolved.
