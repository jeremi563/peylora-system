# ADR-006: Settlement Evidence and the Settlement Data Model

**Status:** Approved

Provider payment confirmation remains separate from settlement. Peylora will model immutable settlement evidence, settlement batches, settlement lines, settlement adjustments and bank deposits as merchant-scoped records. Settlement evidence will never create or rewrite Provider Transactions, allocations, Customer Credit or unassigned received funds.

Peylora will preserve raw source evidence and separate provider transaction dates, settlement/effective dates and bank deposit/value dates. A settlement or bank deposit without documented provider settlement evidence remains unresolved.
