import { getDatabasePool } from "../database.js";

function toCents(value) {
    return BigInt(Math.round(Number(value) * 100));
}

function fromCents(value) {
    return Number(value) / 100;
}

async function lockCreditBalance(client, merchantId, customerId) {
    await client.query(
        `INSERT INTO customer_credit_balances (merchant_id, customer_id, available_amount)
         VALUES ($1, $2, 0)
         ON CONFLICT (merchant_id, customer_id) DO NOTHING`,
        [merchantId, customerId]
    );
    const result = await client.query(
        `SELECT available_amount
         FROM customer_credit_balances
         WHERE merchant_id = $1 AND customer_id = $2
         FOR UPDATE`,
        [merchantId, customerId]
    );
    return result.rows[0];
}

async function increaseCredit(client, {
    merchantId,
    customerId,
    amount,
    providerTransactionId = null,
    allocationReversalId = null,
    eventKey,
    entryType = "CREDIT"
}) {
    const balance = await lockCreditBalance(client, merchantId, customerId);
    const current = toCents(balance.available_amount);
    const increase = toCents(amount);
    const ledger = await client.query(
        `INSERT INTO customer_credit_ledger (
            merchant_id, customer_id, entry_type, direction, amount,
            provider_transaction_id, allocation_reversal_id, event_key
         )
         VALUES ($1, $2, $3, 'INCREASE', $4, $5, $6, $7)
         ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [
            merchantId,
            customerId,
            entryType,
            fromCents(increase),
            providerTransactionId,
            allocationReversalId,
            eventKey
        ]
    );
    if (!ledger.rowCount) return false;
    await client.query(
        `UPDATE customer_credit_balances
         SET available_amount = $3, updated_at = NOW()
         WHERE merchant_id = $1 AND customer_id = $2`,
        [merchantId, customerId, fromCents(current + increase)]
    );
    return true;
}

async function decreaseCredit(client, {
    merchantId,
    customerId,
    amount,
    allocationId,
    eventKey
}) {
    const balance = await lockCreditBalance(client, merchantId, customerId);
    const current = toCents(balance.available_amount);
    const decrease = toCents(amount);
    if (decrease > current) throw new Error("Insufficient customer credit");

    const ledger = await client.query(
        `INSERT INTO customer_credit_ledger (
            merchant_id, customer_id, entry_type, direction, amount,
            allocation_id, event_key
         )
         VALUES ($1, $2, 'DEBIT', 'DECREASE', $3, $4, $5)
         ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [merchantId, customerId, fromCents(decrease), allocationId, eventKey]
    );
    if (!ledger.rowCount) return false;
    await client.query(
        `UPDATE customer_credit_balances
         SET available_amount = $3, updated_at = NOW()
         WHERE merchant_id = $1 AND customer_id = $2`,
        [merchantId, customerId, fromCents(current - decrease)]
    );
    return true;
}

async function recalculateInvoiceStatus(client, merchantId, invoiceId) {
    const invoice = await client.query(
        `SELECT id, total_amount, status
         FROM invoices
         WHERE id = $1 AND merchant_id = $2
         FOR UPDATE`,
        [invoiceId, merchantId]
    );
    if (!invoice.rowCount) return;

    const allocated = await client.query(
        `SELECT COALESCE(SUM(pa.amount), 0)::numeric(12,2) AS total
         FROM payment_allocations pa
         WHERE pa.merchant_id = $1
           AND pa.invoice_id = $2
           AND NOT EXISTS (
               SELECT 1 FROM allocation_reversals ar
               WHERE ar.merchant_id = pa.merchant_id
                 AND ar.original_allocation_id = pa.id
           )`,
        [merchantId, invoiceId]
    );
    const allocatedCents = toCents(allocated.rows[0].total);
    const outstandingCents = toCents(invoice.rows[0].total_amount) - allocatedCents;

    let status = invoice.rows[0].status;
    if (status !== "CANCELLED") {
        if (outstandingCents <= 0n) status = "PAID";
        else if (allocatedCents > 0n) status = "PARTIALLY_PAID";
        else if (status === "PAID" || status === "PARTIALLY_PAID") status = "SENT";
    }

    await client.query(
        "UPDATE invoices SET status = $3, updated_at = NOW() WHERE id = $1 AND merchant_id = $2",
        [invoiceId, merchantId, status]
    );
}

export async function processSuccessfulProviderTransaction(client, {
    merchantId,
    providerTransactionId,
    receivedAmount,
    paymentId
}) {
    const payment = await client.query(
        `SELECT p.id, p.invoice_id, p.customer_id, i.customer_id AS invoice_customer_id
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id AND i.merchant_id = p.merchant_id
         WHERE p.id = $1 AND p.merchant_id = $2
         FOR UPDATE OF p`,
        [paymentId, merchantId]
    );
    if (!payment.rowCount) return;

    const row = payment.rows[0];
    const received = toCents(receivedAmount);

    if (!row.invoice_id) {
        if (row.customer_id) {
            await increaseCredit(client, {
                merchantId,
                customerId: row.customer_id,
                amount: fromCents(received),
                providerTransactionId,
                eventKey: `provider:${providerTransactionId}:credit`
            });
        } else {
            await client.query(
                `INSERT INTO unassigned_received_funds (
                    merchant_id, provider_transaction_id, received_amount
                 )
                 VALUES ($1, $2, $3)
                 ON CONFLICT (provider_transaction_id) DO NOTHING`,
                [merchantId, providerTransactionId, fromCents(received)]
            );
        }
        return;
    }

    const invoice = await client.query(
        `SELECT id, total_amount
         FROM invoices
         WHERE id = $1 AND merchant_id = $2
         FOR UPDATE`,
        [row.invoice_id, merchantId]
    );
    if (!invoice.rowCount) return;

    const allocatedExisting = await client.query(
        `SELECT COALESCE(SUM(pa.amount), 0)::numeric(12,2) AS total
         FROM payment_allocations pa
         WHERE pa.merchant_id = $1
           AND pa.invoice_id = $2
           AND NOT EXISTS (
               SELECT 1 FROM allocation_reversals ar
               WHERE ar.merchant_id = pa.merchant_id
                 AND ar.original_allocation_id = pa.id
           )`,
        [merchantId, row.invoice_id]
    );
    const outstanding = toCents(invoice.rows[0].total_amount) -
        toCents(allocatedExisting.rows[0].total);
    const allocated = received < outstanding
        ? received
        : (outstanding > 0n ? outstanding : 0n);

    if (allocated > 0n) {
        await client.query(
            `INSERT INTO payment_allocations (
                merchant_id, invoice_id, customer_id, source_type,
                provider_transaction_id, amount, event_key
             )
             VALUES ($1, $2, $3, 'RECEIVED_PAYMENT', $4, $5, $6)
             ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
            [
                merchantId,
                row.invoice_id,
                row.customer_id ?? row.invoice_customer_id,
                providerTransactionId,
                fromCents(allocated),
                `provider:${providerTransactionId}:allocation:${row.invoice_id}`
            ]
        );
        await recalculateInvoiceStatus(client, merchantId, row.invoice_id);
    }

    const excess = received - allocated;
    if (excess <= 0n) return;

    const reliableCustomerId = row.customer_id ?? row.invoice_customer_id;
    if (reliableCustomerId) {
        await increaseCredit(client, {
            merchantId,
            customerId: reliableCustomerId,
            amount: fromCents(excess),
            providerTransactionId,
            eventKey: `provider:${providerTransactionId}:credit`
        });
    } else {
        await client.query(
            `INSERT INTO unassigned_received_funds (
                merchant_id, provider_transaction_id, received_amount
             )
             VALUES ($1, $2, $3)
             ON CONFLICT (provider_transaction_id) DO NOTHING`,
            [merchantId, providerTransactionId, fromCents(excess)]
        );
    }
}

export async function reversePaymentAllocation(client, {
    merchantId,
    allocationId,
    reason,
    eventKey
}) {
    const allocation = await client.query(
        `SELECT pa.*
         FROM payment_allocations pa
         WHERE pa.id = $1 AND pa.merchant_id = $2
         FOR UPDATE`,
        [allocationId, merchantId]
    );
    if (!allocation.rowCount) return null;

    const existing = await client.query(
        `SELECT id FROM allocation_reversals
         WHERE merchant_id = $1 AND original_allocation_id = $2
         FOR UPDATE`,
        [merchantId, allocationId]
    );
    if (existing.rowCount) return { reversalId: existing.rows[0].id, duplicate: true };

    const row = allocation.rows[0];
    const reversal = await client.query(
        `INSERT INTO allocation_reversals (
            merchant_id, original_allocation_id, reason, event_key
         )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (original_allocation_id) DO NOTHING
         RETURNING id`,
        [merchantId, allocationId, reason ?? null, eventKey ?? null]
    );
    if (!reversal.rowCount) return { duplicate: true };

    if (row.source_type === "CUSTOMER_CREDIT") {
        await increaseCredit(client, {
            merchantId,
            customerId: row.customer_id,
            amount: row.amount,
            allocationReversalId: reversal.rows[0].id,
            eventKey: `reversal:${reversal.rows[0].id}:credit`,
            entryType: "REVERSAL"
        });
    } else if (row.source_type === "RECEIVED_PAYMENT") {
        if (row.customer_id) {
            await increaseCredit(client, {
                merchantId,
                customerId: row.customer_id,
                amount: row.amount,
                allocationReversalId: reversal.rows[0].id,
                eventKey: `reversal:${reversal.rows[0].id}:credit`,
                entryType: "REVERSAL"
            });
        } else if (row.provider_transaction_id) {
            await client.query(
                `UPDATE unassigned_received_funds
                 SET allocated_amount = GREATEST(allocated_amount - $3, 0), updated_at = NOW()
                 WHERE merchant_id = $1 AND provider_transaction_id = $2`,
                [merchantId, row.provider_transaction_id, row.amount]
            );
        }
    } else if (row.source_type === "UNASSIGNED_FUNDS" && row.unassigned_received_funds_id) {
        await client.query(
            `UPDATE unassigned_received_funds
             SET allocated_amount = GREATEST(allocated_amount - $3, 0), updated_at = NOW()
             WHERE merchant_id = $1 AND id = $2`,
            [merchantId, row.unassigned_received_funds_id, row.amount]
        );
    }

    await recalculateInvoiceStatus(client, merchantId, row.invoice_id);
    return { reversalId: reversal.rows[0].id, duplicate: false };
}

export async function reverseInvoiceAllocations(client, merchantId, invoiceId) {
    const allocations = await client.query(
        `SELECT pa.id
         FROM payment_allocations pa
         WHERE pa.merchant_id = $1
           AND pa.invoice_id = $2
           AND NOT EXISTS (
               SELECT 1 FROM allocation_reversals ar
               WHERE ar.merchant_id = pa.merchant_id
                 AND ar.original_allocation_id = pa.id
           )
         ORDER BY pa.created_at, pa.id`,
        [merchantId, invoiceId]
    );
    for (const allocation of allocations.rows) {
        await reversePaymentAllocation(client, {
            merchantId,
            allocationId: allocation.id,
            reason: "Invoice cancelled",
            eventKey: `invoice-cancellation:${invoiceId}:${allocation.id}`
        });
    }
}

export async function allocateCustomerCreditToInvoice({
    merchantId,
    invoiceId,
    amount,
    operationKey
}) {
    const client = await getDatabasePool().connect();
    try {
        await client.query("BEGIN");
        const invoice = await client.query(
            `SELECT id, customer_id, total_amount
             FROM invoices
             WHERE id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [invoiceId, merchantId]
        );
        if (!invoice.rowCount || !invoice.rows[0].customer_id) {
            await client.query("ROLLBACK");
            return { status: "INVALID" };
        }
        const customerId = invoice.rows[0].customer_id;
        const balance = await lockCreditBalance(client, merchantId, customerId);
        const available = toCents(balance.available_amount);
        const requested = toCents(amount);
        if (requested <= 0n) {
            await client.query("ROLLBACK");
            return { status: "INVALID" };
        }
        if (requested > available) {
            await client.query("ROLLBACK");
            return { status: "INSUFFICIENT_CREDIT" };
        }

        const existing = await client.query(
            `SELECT COALESCE(SUM(pa.amount), 0)::numeric(12,2) AS total
             FROM payment_allocations pa
             WHERE pa.merchant_id = $1
               AND pa.invoice_id = $2
               AND NOT EXISTS (
                   SELECT 1 FROM allocation_reversals ar
                   WHERE ar.merchant_id = pa.merchant_id
                     AND ar.original_allocation_id = pa.id
               )`,
            [merchantId, invoiceId]
        );
        const outstanding = toCents(invoice.rows[0].total_amount) -
            toCents(existing.rows[0].total);
        if (requested > outstanding) {
            await client.query("ROLLBACK");
            return { status: "EXCEEDS_OUTSTANDING" };
        }

        const allocation = await client.query(
            `INSERT INTO payment_allocations (
                merchant_id, invoice_id, customer_id, source_type, amount, event_key
             )
             VALUES ($1, $2, $3, 'CUSTOMER_CREDIT', $4, $5)
             ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
             RETURNING id`,
            [
                merchantId,
                invoiceId,
                customerId,
                fromCents(requested),
                `${operationKey}:credit-allocation:${invoiceId}`
            ]
        );
        if (!allocation.rowCount) {
            await client.query("COMMIT");
            return { status: "DUPLICATE" };
        }
        await decreaseCredit(client, {
            merchantId,
            customerId,
            amount: fromCents(requested),
            allocationId: allocation.rows[0].id,
            eventKey: `credit-debit:${allocation.rows[0].id}`
        });
        await recalculateInvoiceStatus(client, merchantId, invoiceId);
        await client.query("COMMIT");
        return { status: "ALLOCATED", allocationId: allocation.rows[0].id };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function allocateCustomerCreditOldest({
    merchantId,
    customerId,
    amount,
    operationKey
}) {
    const client = await getDatabasePool().connect();
    try {
        await client.query("BEGIN");
        const balance = await lockCreditBalance(client, merchantId, customerId);
        let requested = toCents(amount);
        const available = toCents(balance.available_amount);
        if (requested <= 0n) {
            await client.query("ROLLBACK");
            return { status: "INVALID", allocations: [] };
        }
        if (requested > available) {
            await client.query("ROLLBACK");
            return { status: "INSUFFICIENT_CREDIT", allocations: [] };
        }

        const invoices = await client.query(
            `SELECT i.id, i.total_amount
             FROM invoices i
             WHERE i.merchant_id = $1
               AND i.customer_id = $2
               AND i.status NOT IN ('PAID', 'CANCELLED')
             ORDER BY i.created_at ASC, i.id ASC
             FOR UPDATE`,
            [merchantId, customerId]
        );
        const allocations = [];

        for (const invoice of invoices.rows) {
            if (requested <= 0n) break;
            const existing = await client.query(
                `SELECT COALESCE(SUM(pa.amount), 0)::numeric(12,2) AS total
                 FROM payment_allocations pa
                 WHERE pa.merchant_id = $1
                   AND pa.invoice_id = $2
                   AND NOT EXISTS (
                       SELECT 1 FROM allocation_reversals ar
                       WHERE ar.merchant_id = pa.merchant_id
                         AND ar.original_allocation_id = pa.id
                   )`,
                [merchantId, invoice.id]
            );
            const outstanding = toCents(invoice.total_amount) -
                toCents(existing.rows[0].total);
            if (outstanding <= 0n) continue;
            const allocatedAmount = requested < outstanding ? requested : outstanding;
            const allocation = await client.query(
                `INSERT INTO payment_allocations (
                    merchant_id, invoice_id, customer_id, source_type, amount, event_key
                 )
                 VALUES ($1, $2, $3, 'CUSTOMER_CREDIT', $4, $5)
                 ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
                 RETURNING id`,
                [
                    merchantId,
                    invoice.id,
                    customerId,
                    fromCents(allocatedAmount),
                    `${operationKey}:oldest:${invoice.id}:${fromCents(allocatedAmount)}`
                ]
            );
            if (!allocation.rowCount) continue;
            await decreaseCredit(client, {
                merchantId,
                customerId,
                amount: fromCents(allocatedAmount),
                allocationId: allocation.rows[0].id,
                eventKey: `credit-debit:${allocation.rows[0].id}`
            });
            await recalculateInvoiceStatus(client, merchantId, invoice.id);
            allocations.push(allocation.rows[0].id);
            requested -= allocatedAmount;
        }

        await client.query("COMMIT");
        return { status: "ALLOCATED", allocations };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function getInvoiceAccountingSummary(merchantId, invoiceId) {
    const pool = getDatabasePool();
    const invoice = await pool.query(
        `SELECT id, merchant_id, customer_id, total_amount, status
         FROM invoices
         WHERE id = $1 AND merchant_id = $2`,
        [invoiceId, merchantId]
    );
    if (!invoice.rowCount) return null;

    const allocations = await pool.query(
        `SELECT pa.id, pa.customer_id, pa.source_type, pa.amount,
                pa.provider_transaction_id, pa.unassigned_received_funds_id,
                pa.created_at,
                ar.id AS reversal_id, ar.created_at AS reversed_at
         FROM payment_allocations pa
         LEFT JOIN allocation_reversals ar
           ON ar.merchant_id = pa.merchant_id
          AND ar.original_allocation_id = pa.id
         WHERE pa.merchant_id = $1 AND pa.invoice_id = $2
         ORDER BY pa.created_at DESC, pa.id`,
        [merchantId, invoiceId]
    );
    const active = allocations.rows
        .filter((row) => !row.reversal_id)
        .reduce((sum, row) => sum + toCents(row.amount), 0n);
    const total = toCents(invoice.rows[0].total_amount);
    const outstanding = total - active;

    return {
        invoiceId,
        status: invoice.rows[0].status,
        totalAmount: fromCents(total),
        allocatedAmount: fromCents(active),
        outstandingAmount: fromCents(outstanding > 0n ? outstanding : 0n),
        allocations: allocations.rows.map((row) => ({
            id: row.id,
            customerId: row.customer_id,
            sourceType: row.source_type,
            amount: Number(row.amount),
            providerTransactionId: row.provider_transaction_id,
            unassignedReceivedFundsId: row.unassigned_received_funds_id,
            createdAt: row.created_at,
            reversedAt: row.reversed_at
        }))
    };
}

export async function getCustomerAccountingSummary(merchantId, customerId) {
    const pool = getDatabasePool();
    const customer = await pool.query(
        `SELECT id, name, phone_number
         FROM customers
         WHERE id = $1 AND merchant_id = $2`,
        [customerId, merchantId]
    );
    if (!customer.rowCount) return null;

    const credit = await pool.query(
        `SELECT available_amount
         FROM customer_credit_balances
         WHERE merchant_id = $1 AND customer_id = $2`,
        [merchantId, customerId]
    );
    const ledger = await pool.query(
        `SELECT id, entry_type, direction, amount, provider_transaction_id,
                allocation_id, allocation_reversal_id, event_key, created_at
         FROM customer_credit_ledger
         WHERE merchant_id = $1 AND customer_id = $2
         ORDER BY created_at DESC, id`,
        [merchantId, customerId]
    );

    return {
        customerId,
        customerName: customer.rows[0].name,
        availableCredit: credit.rowCount ? Number(credit.rows[0].available_amount) : 0,
        ledger: ledger.rows.map((row) => ({
            id: row.id,
            entryType: row.entry_type,
            direction: row.direction,
            amount: Number(row.amount),
            providerTransactionId: row.provider_transaction_id,
            allocationId: row.allocation_id,
            allocationReversalId: row.allocation_reversal_id,
            eventKey: row.event_key,
            createdAt: row.created_at
        }))
    };
}
