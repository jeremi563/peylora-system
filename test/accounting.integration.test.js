import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "phase-accounting-test-secret-at-least-32";

test("invoice and customer credit accounting is atomic, idempotent, and reversible", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const email = `accounting-${suffix}@example.test`;
    let merchantId;
    let customerId;
    let invoiceId;
    let paymentId;
    let attemptId;
    let providerTransactionId;

    try {
        const user = await pool.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES ('Accounting Merchant', $1, 'test-password-hash')
             RETURNING id`,
            [email]
        );
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Accounting Ltd', $2)
             RETURNING id`,
            [user.rows[0].id, email]
        )).rows[0].id;
        customerId = (await pool.query(
            `INSERT INTO customers (merchant_id, name, phone_number)
             VALUES ($1, 'Accounting Customer', $2)
             RETURNING id`,
            [merchantId, `254720${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;
        invoiceId = (await pool.query(
            `INSERT INTO invoices (merchant_id, customer_id, invoice_number, total_amount, status)
             VALUES ($1, $2, $3, 1000, 'SENT')
             RETURNING id`,
            [merchantId, customerId, `INV-ACC-${suffix}`]
        )).rows[0].id;
        paymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, customer_id, invoice_id, reference, amount, phone_number, status)
             VALUES ($1, $2, $3, $4, 1200, $5, 'PENDING')
             RETURNING id`,
            [merchantId, customerId, invoiceId, `PAY-ACC-${suffix}`, `254720${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;
        attemptId = (await pool.query(
            `INSERT INTO transactions (payment_id, merchant_id, account_reference, amount, phone_number, provider, status)
             VALUES ($1, $2, $3, 1200, $4, 'MPESA', 'PENDING')
             RETURNING id`,
            [paymentId, merchantId, `ACC-${suffix}`, `254720${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;
        providerTransactionId = (await pool.query(
            `INSERT INTO provider_transactions (
                merchant_id, attempt_transaction_id, provider, outcome,
                provider_reference, received_amount, evidence_type
             )
             VALUES ($1, $2, 'MPESA', 'SUCCESS', $3, 1200, 'CALLBACK')
             RETURNING id`,
            [merchantId, attemptId, `RECEIPT-ACC-${suffix}`]
        )).rows[0].id;

        const accounting = await import("../src/services/accounting.service.js");
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await accounting.processSuccessfulProviderTransaction(client, {
                merchantId,
                providerTransactionId,
                receivedAmount: 1200,
                paymentId
            });
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

        const invoiceState = await pool.query(
            `SELECT i.status,
                    COALESCE(SUM(pa.amount) FILTER (
                        WHERE NOT EXISTS (
                            SELECT 1 FROM allocation_reversals ar
                            WHERE ar.original_allocation_id = pa.id
                        )
                    ), 0)::numeric(12,2) AS allocated
             FROM invoices i
             LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
             WHERE i.id = $1
             GROUP BY i.id`,
            [invoiceId]
        );
        assert.equal(invoiceState.rows[0].status, "PAID");
        assert.equal(Number(invoiceState.rows[0].allocated), 1000);

        const credit = await pool.query(
            "SELECT available_amount FROM customer_credit_balances WHERE merchant_id = $1 AND customer_id = $2",
            [merchantId, customerId]
        );
        assert.equal(Number(credit.rows[0].available_amount), 200);

        const allocation = await pool.query(
            `SELECT id
             FROM payment_allocations
             WHERE merchant_id = $1
               AND invoice_id = $2
               AND source_type = 'RECEIVED_PAYMENT'
             LIMIT 1`,
            [merchantId, invoiceId]
        );
        const reversalClient = await pool.connect();
        try {
            await reversalClient.query("BEGIN");
            await accounting.reversePaymentAllocation(reversalClient, {
                merchantId,
                allocationId: allocation.rows[0].id,
                reason: "Test reversal",
                eventKey: `test-reversal:${allocation.rows[0].id}`
            });
            await reversalClient.query("COMMIT");
        } catch (error) {
            await reversalClient.query("ROLLBACK");
            throw error;
        } finally {
            reversalClient.release();
        }

        const reversedState = await pool.query(
            "SELECT status FROM invoices WHERE id = $1",
            [invoiceId]
        );
        assert.equal(reversedState.rows[0].status, "SENT");

        const reversedCredit = await pool.query(
            "SELECT available_amount FROM customer_credit_balances WHERE merchant_id = $1 AND customer_id = $2",
            [merchantId, customerId]
        );
        assert.equal(Number(reversedCredit.rows[0].available_amount), 1200);
    } finally {
        await pool.query("DELETE FROM allocation_reversals WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM customer_credit_ledger WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM customer_credit_balances WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM payment_allocations WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM unassigned_received_funds WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM provider_transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM invoices WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM customers WHERE merchant_id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        await pool.query("DELETE FROM users WHERE email = $1", [email]).catch(() => {});
        await closeDatabase();
    }
});
