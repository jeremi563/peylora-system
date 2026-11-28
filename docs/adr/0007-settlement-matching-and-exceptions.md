# ADR-007: Settlement Matching and Operator Review

**Status:** Approved

Settlement reconciliation will auto-confirm only exact, merchant-scoped provider receipt/reference matches with consistent currency and amount/date evidence. Ambiguous, duplicate or conflicting matches remain append-only reconciliation exceptions.

Operator review is record-only in v0.3.0: it may confirm or reject evidence relationships and document resolution, but it may not fabricate a Provider Transaction or mutate the received-payment, allocation or customer-credit ledger.
