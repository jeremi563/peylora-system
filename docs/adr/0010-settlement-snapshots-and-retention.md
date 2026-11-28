# ADR-010: Settlement Snapshots and Evidence Retention

**Status:** Approved

Completed reconciliation runs will create immutable snapshots of canonical batch, line, match and exception state, while live derived state remains queryable. Original imported settlement evidence is retained for the Merchant's financial-history lifetime.

Evidence snapshots and source files are merchant-scoped and auditable. Reprocessing or deleting evidence must not erase historical reconciliation or operator decisions.
