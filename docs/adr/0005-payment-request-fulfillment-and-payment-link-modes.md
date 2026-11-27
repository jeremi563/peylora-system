# ADR-005: Payment Request Fulfillment and Payment Link Modes

**Status:** Approved

## Context and problem statement

ADR-001 distinguishes the stable Payment Request from its Payment Attempts and Provider Transactions. The current compatibility `payments.status` is written from attempt outcomes and does not express cumulative fulfillment. The current public Payment Link flow can create a new Payment Request for each submission, and links have no explicit single-use/reusable mode.

These ambiguities can cause duplicate prompts, repeated collection after fulfillment, or a provider success to be confused with satisfaction of the merchant's request.

## Decision

### Payment Request fulfillment

- Payment Request fulfillment is derived from the cumulative amount received across its unique, confirmed successful Provider Transactions.
- The Payment Request is unfulfilled, partially fulfilled, or fulfilled according to the cumulative amount compared with the fixed requested amount.
- Payment Request fulfillment is distinct from an individual Payment Attempt outcome, Invoice fulfillment, and Merchant settlement.
- Provider Transactions and Payment Attempts remain individually queryable and immutable. A compatibility API status must not silently replace these per-attempt outcomes; the fulfillment state is exposed additively.
- Every Provider Transaction contributes at most once. Over-receipt remains governed by ADR-002: invoice allocation is capped at outstanding balance and excess is preserved as Customer Credit or unassigned received funds.
- A fulfilled Payment Request must not accept further collections.

### Payment Link modes

- Each Payment Link binds to exactly one stable Payment Request. Repeated use creates Payment Attempts under that request, not separate Payment Requests.
- Payment Links have explicit `SINGLE_USE` or `REUSABLE` modes. New links default to `REUSABLE`.
- A `SINGLE_USE` link is consumed after any confirmed successful Provider Transaction, including a partial received amount. Failed or cancelled attempts do not consume it.
- A `REUSABLE` link allows additional Payment Attempts while its Payment Request remains unfulfilled. It cannot accept additional collections after fulfillment.
- A PENDING or unresolved TIMEOUT Payment Attempt blocks another prompt. Retry is permitted only after the resolution policy in ADR-003.
- Link/request admission and single-use consumption are atomic under PostgreSQL concurrency controls.
- Existing Payment Requests, Payment Attempts, Provider Transactions, allocations, and callbacks are preserved; historical records are not collapsed to create the new stable link binding.

## Rationale

Cumulative fulfillment models what was actually received without confusing an individual provider outcome with the total collection obligation. Explicit link modes make subsequent collection behavior visible, while the one-request-per-link relationship preserves the stable collection intent and its attempt history.

## Alternatives considered

### Treat any successful Payment Attempt as full Payment Request fulfillment

Rejected because a successful Provider Transaction may report a partial amount. Provider success does not imply that the requested amount was collected.

### Create a new Payment Request for each use of a Payment Link

Rejected because it conflates link use with new collection intent, weakens idempotency, and prevents a stable cumulative fulfillment view.

### Consume a single-use link on dispatch

Rejected because dispatch acknowledgement or an uncertain network outcome does not establish that money was received.

### Allow further collection after Payment Request fulfillment

Rejected because the request's fixed obligation has already been satisfied. Additional funds would create an avoidable overcollection.

### Infer Invoice fulfillment or Settlement from Payment Request fulfillment

Rejected because Invoice allocation follows ADR-002, and settlement is a separate movement/availability-of-funds concept.

## Consequences

- Payment Request read models need a cumulative fulfillment state that is separate from Attempt outcomes.
- Public Payment Links need a stable request binding and a persisted mode.
- Payment Link use and Payment Attempt admission must be serialized in the database, including concurrent callers.
- Existing API fields remain compatible; new fulfillment and link-mode fields are additive.
- Single-use partial success consumes the link even though the request remains partially fulfilled; further collection requires a new merchant-created request/link.

## Scope limitations

This ADR does not define actual refunds, refund behavior, settlement reconciliation, or invoice `OVERDUE` versus `PARTIALLY_PAID` precedence.
