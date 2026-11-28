# ADR-008: Settlement Import and Source Profiles

**Status:** Approved

The v0.3.0 import MVP accepts CSV, Excel and manual bank-deposit evidence. CSV and Excel inputs are limited to operator-managed source profiles; unknown or changed headers are validation exceptions, not inferred merchant mappings.

Every import retains original bytes and parsed rows, uses a content fingerprint for duplicate recognition, and remains merchant-scoped. Gross, fee/deduction and net fields come from the source; Peylora will not infer missing fees or net values.
