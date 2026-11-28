# ADR-009: Settlement Adjustments and Statuses

**Status:** Approved

Canonical settlement statuses are `EXPECTED`, `PARTIAL`, `SETTLED`, `DELAYED`, `ADJUSTED`, `CONFLICT` and `UNKNOWN`. Provider or source states not represented by those meanings remain `UNKNOWN`.

Reversals and adjustments are append-only settlement evidence. Actual refund processing and settlement-account money movement are deferred from v0.3.0 and must not be implemented by treating an allocation reversal as a provider refund.
