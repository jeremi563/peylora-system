# ADR-002: Payment Allocation and Customer Credit Accounting

**Status:** Approved

## Context and problem statement

Peylora records successful M-Pesa payments independently of the collection request and provider execution lifecycle. Received money must be accounted for even when it is less than, equal to, or greater than the amount required to satisfy an invoice.

The financial model must distinguish:

- Amount requested
- Actual amount received
- Amount allocated
- Outstanding invoice balance
- Customer credit
- Unassigned received funds

An automatic or manual allocation must not silently discard excess money or create duplicate accounting effects.

## Relevant financial domain concepts

- **Payment Allocation:** The portion of an actual received amount assigned to an eligible invoice.
- **Customer Credit:** Received money belonging to a reliably identified customer within a specific merchant that remains unapplied.
- **Unassigned Received Funds:** Successful received money that cannot be reliably associated with a customer.
- **Allocation Reversal:** An explicit correction that reverses an original allocation and returns the reversed amount to customer credit or unassigned received funds.

An allocation reversal is not a payment refund.

## Approved allocation rules

### Automatic allocation of invoice-linked payments

When a successful payment originates from an Invoice-linked Payment Request:

- The actual amount received is established from appropriate provider evidence.
- The automatic allocation is the lesser of the received amount and the invoice's outstanding balance.
- The allocation never exceeds the invoice's outstanding balance.
- If the customer is reliably identified, excess received money is recorded as unapplied customer credit.
- If the customer cannot be reliably identified, excess received money is preserved as unassigned received funds.
- The invoice's financial position is recalculated after allocation.

### Standalone payments

Successful payments from standalone Payment Requests remain unapplied.

- Peylora must not automatically search for outstanding invoices.
- If the customer is reliably identified, the received amount is recorded as unapplied customer credit.
- If the customer cannot be reliably identified, the funds remain unassigned.
- The merchant may subsequently allocate identified customer credit to eligible invoices.

### Manual allocation

A merchant can manually select invoices and specify allocation amounts.

An allocation must not exceed:

- The available customer credit.
- The selected invoice's outstanding balance.

### Oldest-first allocation

The merchant must explicitly initiate oldest-first allocation.

This method allocates customer credit against the oldest outstanding invoices first:

1. Invoice issue date is the primary ordering criterion.
2. Invoice creation timestamp is the tie-breaker.

Oldest-first allocation is not an automatic background operation. Partial allocation across multiple invoices is supported.

### Allocation reversals

Allocation reversals must be supported.

- The original allocation is preserved.
- A reversal explicitly references the original allocation.
- If the allocation was funded by existing customer credit, reversing it restores the amount to that customer's available credit.
- If the allocation originated from a received payment, reversing it returns the amount to customer credit if customer identity is reliable; otherwise, it returns to unassigned received funds.
- An allocation reversal never increases or duplicates the recorded amount received.
- The affected invoice's financial position is recalculated.
- The original allocation and reversal remain traceable in financial history.

When a customer cannot be reliably identified, a reversal returns funds to unassigned received funds rather than customer credit.

### Merchant-scoped customer credit

Customer credit belongs to a specific customer within a specific merchant.

- Credit owned by Merchant A cannot be used by Merchant B.
- Matching email addresses or phone numbers do not share customer credit across merchants.

### Initial customer credit usage

Customer credit may initially be used only to settle invoices.

Refund processing is a separate financial operation and is outside this decision.

### Customer ownership protection

Customer credit may settle only invoices belonging to the same customer and merchant.

One customer's credit must never settle another customer's invoice.

### Excess invoice-linked payments

When an Invoice-linked payment exceeds the linked invoice's outstanding balance:

- The allocation settles or partially satisfies only the linked invoice as required.
- The excess remains unapplied.
- The excess is not automatically redirected to another outstanding invoice.
- The merchant may allocate the excess later through manual or oldest-first allocation.

### Invoice cancellation

Cancelling an invoice reverses its existing payment allocations.

- The original payments remain preserved.
- Original allocation records remain preserved.
- Explicit reversals reference the original allocations.
- Reversed amounts return to the appropriate customer's unapplied credit when identity is reliable.
- Otherwise, reversed amounts remain as unassigned received funds.
- The invoice lifecycle status becomes `CANCELLED`.

Invoice cancellation is not a payment refund.

### Customer credit expiry

Customer credit does not expire automatically.

It remains available until allocated or explicitly adjusted through an authorised financial operation. No automatic expiry or forfeiture mechanism is introduced.

## Financial integrity requirements

All financial allocation operations must enforce:

### Atomicity

Payment recording, allocation and excess-credit or unassigned-funds recording must be consistent. The system must not persist only part of a financial operation.

### Idempotency

Duplicate provider callbacks or repeated processing must not create duplicate allocations or customer credits. Reprocessing the same financial event must not duplicate its accounting effects.

### Auditability

Historical financial records must not be silently overwritten or deleted.

Corrections must use explicit reversals or authorised adjustment records. Financial history must remain traceable between payments, allocations, reversals and resulting balances.

## Unidentified payments

When a successful payment cannot be reliably associated with a Customer:

- The actual received payment remains recorded in the merchant's financial records.
- Peylora does not automatically create a Customer record.
- Peylora does not assign the payment to an existing Customer based on uncertain identity.
- The funds remain unassigned received funds until reliable identification and assignment are possible.

Unassigned received funds are distinct from customer credit. They are not attributed to a Customer until appropriately identified.

## Decision and rationale

Peylora should preserve received money and account for it through explicit allocations. Invoice-linked payments allocate only against the linked invoice, while standalone payments remain unapplied.

Customer credit is isolated by customer and merchant and may be applied only to eligible invoices. Allocation reversals preserve the original accounting history rather than deleting or rewriting it.

These rules prevent excess money from being silently discarded, prevent cross-customer or cross-merchant credit use, and keep customer credit distinct from unassigned received funds.

## Alternatives considered

### No automatic allocation

This option would leave every invoice-linked payment unapplied.

It was rejected because it would require all successful invoice collections to receive a separate allocation operation and would not maintain an accurate invoice balance automatically.

### Automatically allocating all payments to invoices

This option would search an invoice or set of invoices for every successful payment, including standalone payments.

It was rejected because standalone payments must remain unapplied and Peylora must not automatically match them to outstanding invoices.

### Treating every received payment as customer credit

This option would assign all invoice-linked and standalone payments directly to customer credit.

It was rejected because invoice-linked payments must first settle the linked invoice balance, and excess alone becomes customer credit or unassigned received funds.

### Automatically creating customer records for unidentified payers

This option would create or infer Customer identities for uncertain payers.

It was rejected because uncertain identity must not automatically assign a customer or customer credit.

### Deleting or modifying allocations when correcting accounting records

This option would overwrite or remove an allocation to reflect a correction.

It was rejected because it destroys financial history. Explicit reversals preserve the original allocation and its correction.

## Consequences

### Benefits

- Invoice balances reflect the amount allocated from received money.
- Partial and excess payments remain traceable.
- Identified customer credit is reusable for eligible invoice settlement.
- Unidentified funds remain distinct from customer credit.
- Corrections preserve financial history.
- Invoice cancellation returns allocated amounts without representing a refund.

### Trade-offs

- Allocation and credit accounting require explicit financial operations.
- Identifying reliable customer ownership may leave legitimate funds unassigned.
- Manual and oldest-first allocation require merchant-initiated operations.
- Oldest-first allocation may require considering issue date and creation timestamp for ordering.

## Scope limitations and unresolved matters

This ADR does not decide:

- Refund processing or refund entries.
- Automatic invoice matching for standalone payments.
- Automatic oldest-first allocation.
- Automatic customer-credit expiry or forfeiture.
- Detailed invoice status precedence or overdue rules.
- Which provider or banking record is authoritative for settlement.
- How unassigned received funds are later identified or reassigned.
- How customer credit is adjusted outside allocation and reversal operations.
- Physical database tables, columns, indexes or migrations.
