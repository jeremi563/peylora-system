# ADR-004: Provider Evidence Verification and Conflict Handling

**Status:** Approved

## Context and problem statement

Daraja callbacks are asynchronous and arrive through a public HTTP endpoint. The current processing path queries Daraja and compares the query ResultCode with the callback ResultCode. This is a useful outcome cross-check, but it does not cryptographically authenticate the callback and does not independently verify callback-supplied amount, receipt, phone, or transaction association.

Those fields can affect Provider Transaction records, Payment Request fulfillment, invoice allocation, Customer Credit, and reconciliation. Provider evidence must not be overstated, discarded, or silently allowed to rewrite financial history.

## Decision

- Preserve the existing Daraja status-query versus callback ResultCode cross-check.
- Do not treat a matching ResultCode as authentication of the callback or as verification of its amount, receipt, phone, or association with the intended Payment Attempt.
- Independently verify transaction association, amount, and M-Pesa receipt wherever authoritative provider evidence exposes those values. Apply the same rule to other material callback fields when the provider supplies authoritative evidence.
- When authoritative provider evidence does not expose a field, retain the original callback value as provider-reported and document that it is not independently verified. Do not claim stronger verification than the evidence supports.
- Preserve the original callback payload and every provider response used for verification or resolution as auditable evidence.
- Identical duplicate evidence is idempotent. A materially different callback or provider response for the same provider transaction is retained as a reconciliation exception.
- Conflicting evidence must not silently update a Provider Transaction, its received amount, Payment Request fulfillment, allocations, Customer Credit, or unassigned funds. Resolution requires an explicit, audited financial correction or review path.
- Only documented terminal provider results may resolve an attempt. Transient, in-progress, malformed, and unrecognized results remain uncertain.
- Keep provider-result verification distinct from cryptographic callback authentication. Do not invent an unsupported signature or treat network location/result-code matching as a cryptographic proof.

## Rationale

Independent evidence comparison limits the authority granted to an unauthenticated callback without discarding useful provider-reported facts when the provider does not expose a second source for a field. Append-only conflict evidence preserves the original claim and the verification result for audit.

## Alternatives considered

### Treat a ResultCode match as full callback authentication

Rejected because the query and callback can agree on the outcome code while other callback fields remain unverified.

### Trust callback amount and receipt without qualification

Rejected because these values affect the financial ledger. They must be labeled as unverified where independent provider evidence is unavailable.

### Overwrite the callback or Provider Transaction when evidence conflicts

Rejected because it destroys the original claim and can silently alter allocations or balances. Conflicts are retained and require explicit resolution.

### Invent a signature or trust an undocumented callback control

Rejected because Peylora must not imply a provider-supported cryptographic control that has not been established.

## Consequences

- Callback processing must persist both the original callback and the verification query/result.
- Database/event handling must distinguish an identical duplicate from a conflicting payload under the same checkout identifier.
- Reconciliation exceptions become durable, merchant-scoped evidence; they do not automatically mutate financial records.
- Provider fields unavailable for independent comparison remain explicit limitations.
- Current Daraja response fields and terminal-result semantics must be checked against current first-party documentation before implementation claims field-level verification.

## Scope limitations

This ADR does not establish cryptographic callback authentication or implement settlement reconciliation. Provider payment confirmation remains distinct from Merchant settlement.
