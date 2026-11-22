# ADR-001: Separate Payment Requests, Payment Attempts, and Provider Transactions

**Status:** Approved

## Context and problem statement

Peylora collects payments through M-Pesa STK Push and currently represents collection intent and execution with concepts that can mix responsibilities. The existing payment and transaction records can be understood as both a collection request and the provider outcome.

This is ambiguous when a Payment Request is retried: a retry must create a new execution history item without replacing or creating a new Payment Request. It is also ambiguous when an STK initiation is pending or has failed but no confirmed provider transaction exists.

## Concept distinction

- **Payment Request:** The merchant's intention to collect a specified amount. It may be standalone or associated with an Invoice.
- **Payment Attempt:** An individual effort to fulfil a Payment Request. The initial implementation supports M-Pesa STK Push attempts.
- **Provider Transaction:** The provider-side transaction record and reported financial outcome associated with a confirmed provider transaction.

These concepts describe three different responsibilities:

1. A Payment Request records collection intent.
2. A Payment Attempt records one initiation and execution effort.
3. A Provider Transaction records the provider-side transaction and reported financial outcome.

## Approved relationships

- One Payment Request can have zero or more Payment Attempts.
- A newly created Payment Request may exist before any Payment Attempt is initiated.
- One Payment Attempt belongs to one Payment Request.
- One Payment Attempt can have zero or one Provider Transaction.
- A pending, failed or cancelled Payment Attempt can exist before, or without, a confirmed Provider Transaction.
- Failed, cancelled and timed-out Payment Attempts remain in the historical record.
- Retrying a Payment Request creates a new Payment Attempt under the same Payment Request. It does not create another Payment Request.

The architecture should preserve room for Provider Transactions from additional payment providers in the future. It does not introduce generic multi-provider support for the initial implementation.

## Decision

Peylora separates the responsibilities of Payment Request, Payment Attempt and Provider Transaction.

The domain model uses:

- A stable Payment Request for the merchant's collection intention.
- One or more Payment Attempts for individual collection efforts.
- A confirmed Provider Transaction, when provider evidence establishes the provider-side transaction, for the reported financial outcome.

Each Payment Attempt has its own execution lifecycle and associated Daraja identifiers and initiation information.

An STK initiation acknowledgement alone does not necessarily establish a Provider Transaction. A Payment Attempt may remain pending while waiting for customer action. A Provider Transaction is recorded when appropriate provider evidence establishes the provider-side transaction.

## Rationale

Separating these concepts preserves collection intent independently of provider execution. It also preserves the history of cancelled, failed and timed-out attempts and permits retries without replacing the original Payment Request.

The Payment Attempt remains a separate concept while no Provider Transaction exists, including during pending customer action. A Provider Transaction is not required merely because a Payment Attempt was initiated.

## Alternatives considered

### Retaining the existing combined model

This option would continue using the existing payment and transaction records to represent collection intent and provider execution together.

It was rejected because it makes retry history and the distinction between initiation, provider confirmation and collection intent ambiguous.

### Renaming existing concepts without changing responsibilities

This option would rename existing records but retain their combined responsibilities.

It was rejected because naming alone would not prevent a retry or pending attempt from being conflated with an existing request or provider transaction.

### Separating the three domain concepts

This option separates collection intent, execution attempts and provider-side financial records.

It was accepted because it matches the existing requirements and preserves the correct cardinalities and historical states.

## Consequences

### Benefits

- Retrying a Payment Request creates distinct attempt history instead of overwriting it.
- Pending Payment Attempts can exist before provider confirmation.
- Failed, cancelled and timed-out attempts remain visible in history.
- Provider Transaction evidence remains conceptually separate from the Payment Attempt.
- Future provider support remains possible without establishing a generic multi-provider implementation now.

### Trade-offs

- The domain model requires explicit relationships and lifecycle handling between three concepts.
- Existing combined records may require future migration or compatibility work.
- Consumers of payment history must distinguish a collection request from its attempts and provider transactions.

## Scope limitations

This ADR does not decide:

- Timeout detection or transition rules.
- Daraja dispatch recovery or uncertain upstream initiation outcomes.
- Callback authenticity or provider signature verification.
- Financial allocations, partial payments or invoice accounting.
- Payment Reconciliation or Settlement.
- Idempotency-key storage, retry endpoint behaviour or physical database design.
- Physical database tables, columns, indexes or migrations.
- Generic provider abstractions or additional payment providers for the initial implementation.
