import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "phase-ten-database-foundation-test-secret-at-least-32";

test("financial foundation protects provider, allocation, credit, and unassigned-funds invariants", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const suffix = randomUUID();
    const email = `financial-${suffix}@example.test`;
    const secondEmail = `financial-second-${suffix}@example.test`;

    let merchantId;
    let secondMerchantId;
    let customerId;
    let secondCustomerId;
    let paymentId;
    let secondPaymentId;
    let thirdPaymentId;
    let attemptId;
    let secondAttemptId;
    let thirdAttemptId;
    let crossAttemptId;
    let invoiceId;
    let creditInvoiceId;
    let secondInvoiceId;

    try {
        const merchantUser = await pool.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES ('Financial Merchant', $1, 'test-password-hash')
             RETURNING id`,
            [email]
        );
        merchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Financial Merchant Ltd', $2)
             RETURNING id`,
            [merchantUser.rows[0].id, email]
        )).rows[0].id;

        const secondMerchantUser = await pool.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES ('Second Financial Merchant', $1, 'test-password-hash')
             RETURNING id`,
            [secondEmail]
        );
        secondMerchantId = (await pool.query(
            `INSERT INTO merchants (user_id, business_name, business_email)
             VALUES ($1, 'Second Financial Merchant Ltd', $2)
             RETURNING id`,
            [secondMerchantUser.rows[0].id, secondEmail]
        )).rows[0].id;

        customerId = (await pool.query(
            `INSERT INTO customers (merchant_id, name, phone_number)
             VALUES ($1, 'Primary Customer', $2)
             RETURNING id`,
            [merchantId, `254700${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;
        secondCustomerId = (await pool.query(
            `INSERT INTO customers (merchant_id, name, phone_number)
             VALUES ($1, 'Second Customer', $2)
             RETURNING id`,
            [secondMerchantId, `254710${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;

        invoiceId = (await pool.query(
            `INSERT INTO invoices (merchant_id, customer_id, invoice_number, total_amount, status)
             VALUES ($1, $2, $3, 10000, 'SENT')
             RETURNING id`,
            [merchantId, customerId, `INV-${suffix}`]
        )).rows[0].id;
        creditInvoiceId = (await pool.query(
            `INSERT INTO invoices (merchant_id, customer_id, invoice_number, total_amount, status)
             VALUES ($1, $2, $3, 1000, 'SENT')
             RETURNING id`,
            [merchantId, customerId, `INV-CREDIT-${suffix}`]
        )).rows[0].id;
        secondInvoiceId = (await pool.query(
            `INSERT INTO invoices (merchant_id, customer_id, invoice_number, total_amount, status)
             VALUES ($1, $2, $3, 1000, 'SENT')
             RETURNING id`,
            [secondMerchantId, secondCustomerId, `INV-SECOND-${suffix}`]
        )).rows[0].id;

        const crossPaymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, customer_id, invoice_id, reference, amount, phone_number, status)
             VALUES ($1, $2, $3, $4, 100, $5, 'PENDING')
             RETURNING id`,
            [secondMerchantId, secondCustomerId, secondInvoiceId, `PAY-CROSS-${suffix}`, `254710${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;
        crossAttemptId = (await pool.query(
            `INSERT INTO transactions (payment_id, merchant_id, account_reference, amount, phone_number, provider, status)
             VALUES ($1, $2, $3, 100, $4, 'MPESA', 'PENDING')
             RETURNING id`,
            [crossPaymentId, secondMerchantId, `ACC-CROSS-${suffix}`, `254710${suffix.replace(/-/g, "").slice(0, 6)}`]
        )).rows[0].id;

        const phone = `254700${suffix.replace(/-/g, "").slice(0, 6)}`;
        paymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, customer_id, invoice_id, reference, amount, phone_number, status)
             VALUES ($1, $2, $3, $4, 10000, $5, 'PENDING')
             RETURNING id`,
            [merchantId, customerId, invoiceId, `PAY-${suffix}`, phone]
        )).rows[0].id;
        secondPaymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, customer_id, invoice_id, reference, amount, phone_number, status)
             VALUES ($1, $2, $3, $4, 1000, $5, 'PENDING')
             RETURNING id`,
            [merchantId, customerId, creditInvoiceId, `PAY-CREDIT-${suffix}`, phone]
        )).rows[0].id;
        thirdPaymentId = (await pool.query(
            `INSERT INTO payments (merchant_id, reference, amount, phone_number, status)
             VALUES ($1, $2, 500, $3, 'PENDING')
             RETURNING id`,
            [merchantId, `PAY-UNASSIGNED-${suffix}`, phone]
        )).rows[0].id;

        attemptId = (await pool.query(
            `INSERT INTO transactions (payment_id, merchant_id, account_reference, amount, phone_number, provider, status)
             VALUES ($1, $2, $3, 10000, $4, 'MPESA', 'PENDING')
             RETURNING id`,
            [paymentId, merchantId, `ACC-${suffix}`, phone]
        )).rows[0].id;
        secondAttemptId = (await pool.query(
            `INSERT INTO transactions (payment_id, merchant_id, account_reference, amount, phone_number, provider, status)
             VALUES ($1, $2, $3, 1000, $4, 'MPESA', 'PENDING')
             RETURNING id`,
            [secondPaymentId, merchantId, `ACC-CREDIT-${suffix}`, phone]
        )).rows[0].id;
        thirdAttemptId = (await pool.query(
            `INSERT INTO transactions (payment_id, merchant_id, account_reference, amount, phone_number, provider, status)
             VALUES ($1, $2, $3, 500, $4, 'MPESA', 'PENDING')
             RETURNING id`,
            [thirdPaymentId, merchantId, `ACC-UNASSIGNED-${suffix}`, phone]
        )).rows[0].id;

        // STK initiation has no Provider Transaction until provider evidence exists.
        const beforeEvidence = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM provider_transactions WHERE attempt_transaction_id = $1",
            [attemptId]
        );
        assert.equal(beforeEvidence.rows[0].count, 0);

        const transactionService = await import("../src/services/transaction.service.js");
        await pool.query(
            `UPDATE transactions
             SET status = 'FAILED', dispatch_state = 'REJECTED', updated_at = NOW()
             WHERE id = $1`,
            [attemptId]
        );
        const retryAttempt = await transactionService.createPaymentAttempt({
            merchantId,
            paymentId,
            accountReference: `ACC-RETRY-${suffix}`,
            phoneNumber: `254700${suffix.replace(/-/g, "").slice(0, 6)}`,
            requestedAmount: 10000,
            description: "Retry attempt"
        });
        assert.ok(retryAttempt);
        assert.equal(retryAttempt.paymentId, paymentId);
        const attemptCount = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM transactions WHERE payment_id = $1",
            [paymentId]
        );
        assert.equal(attemptCount.rows[0].count, 2);

        const providerOne = (await pool.query(
            `INSERT INTO provider_transactions (
                merchant_id, attempt_transaction_id, provider, outcome,
                provider_reference, received_amount, evidence_type, evidence_event_key
             )
             VALUES ($1, $2, 'MPESA', 'SUCCESS', $3, 4000, 'CALLBACK', $4)
             RETURNING id`,
            [merchantId, attemptId, `RECEIPT-4000-${suffix}`, `callback-${suffix}-4000`]
        )).rows[0];

        await assert.rejects(
            pool.query(
                `INSERT INTO provider_transactions (
                    merchant_id, attempt_transaction_id, provider, outcome,
                    provider_reference, received_amount, evidence_type
                 )
                 VALUES ($1, $2, 'MPESA', 'SUCCESS', $3, 6000, 'CALLBACK')`,
                [merchantId, attemptId, `RECEIPT-DUPLICATE-${suffix}`]
            ),
            /provider_transactions_attempt_unique/
        );

        // A composite merchant/attempt relationship rejects cross-merchant evidence.
        await assert.rejects(
            pool.query(
                `INSERT INTO provider_transactions (
                    merchant_id, attempt_transaction_id, provider, outcome,
                    provider_reference, received_amount, evidence_type
                 )
                 VALUES ($1, $2, 'MPESA', 'SUCCESS', $3, 100, 'CALLBACK')`,
                [merchantId, crossAttemptId, `RECEIPT-CROSS-${suffix}`]
            ),
            /provider_transactions_attempt_fk/
        );

        const providerTwo = (await pool.query(
            `INSERT INTO provider_transactions (
                merchant_id, attempt_transaction_id, provider, outcome,
                provider_reference, received_amount, evidence_type
             )
             VALUES ($1, $2, 'MPESA', 'SUCCESS', $3, 6000, 'STATUS_QUERY')
             RETURNING id`,
            [merchantId, secondAttemptId, `RECEIPT-6000-${suffix}`]
        )).rows[0];

        const allocationOne = (await pool.query(
            `INSERT INTO payment_allocations (
                merchant_id, invoice_id, customer_id, source_type,
                provider_transaction_id, amount, event_key
             )
             VALUES ($1, $2, $3, 'RECEIVED_PAYMENT', $4, 4000, $5)
             RETURNING id`,
            [merchantId, invoiceId, customerId, providerOne.id, `allocation-${suffix}-4000`]
        )).rows[0];
        const allocationTwo = (await pool.query(
            `INSERT INTO payment_allocations (
                merchant_id, invoice_id, customer_id, source_type,
                provider_transaction_id, amount, event_key
             )
             VALUES ($1, $2, $3, 'RECEIVED_PAYMENT', $4, 6000, $5)
             RETURNING id`,
            [merchantId, invoiceId, customerId, providerTwo.id, `allocation-${suffix}-6000`]
        )).rows[0];

        const allocatedTotal = await pool.query(
            "SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS total FROM payment_allocations WHERE invoice_id = $1",
            [invoiceId]
        );
        assert.equal(Number(allocatedTotal.rows[0].total), 10000);

        await assert.rejects(
            pool.query(
                `INSERT INTO payment_allocations (
                    merchant_id, invoice_id, customer_id, source_type,
                    provider_transaction_id, amount
                 )
                 VALUES ($1, $2, $3, 'RECEIVED_PAYMENT', $4, 1)`,
                [merchantId, invoiceId, customerId, providerOne.id]
            ),
            /payment_allocations_received_source_unique/
        );

        await pool.query(
            `INSERT INTO allocation_reversals (
                merchant_id, original_allocation_id, reason, event_key
             )
             VALUES ($1, $2, 'Database foundation test', $3)`,
            [merchantId, allocationOne.id, `reversal-${suffix}-4000`]
        );
        await assert.rejects(
            pool.query(
                `INSERT INTO allocation_reversals (
                    merchant_id, original_allocation_id, reason, event_key
                 )
                 VALUES ($1, $2, 'Duplicate reversal test', $3)`,
                [merchantId, allocationOne.id, `reversal-${suffix}-duplicate`]
            ),
            /allocation_reversals_original_unique/
        );

        // Customer credit is merchant/customer scoped and the balance must not become negative.
        await pool.query(
            `INSERT INTO customer_credit_balances (merchant_id, customer_id, available_amount)
             VALUES ($1, $2, 1000)`,
            [merchantId, customerId]
        );
        await pool.query(
            `INSERT INTO customer_credit_ledger (
                merchant_id, customer_id, entry_type, direction, amount,
                provider_transaction_id, event_key
             )
             VALUES ($1, $2, 'CREDIT', 'INCREASE', 1000, $3, $4)`,
            [merchantId, customerId, providerOne.id, `credit-${suffix}-1000`]
        );
        await assert.rejects(
            pool.query(
                "UPDATE customer_credit_balances SET available_amount = -1 WHERE merchant_id = $1 AND customer_id = $2",
                [merchantId, customerId]
            ),
            /customer_credit_balances_available_amount_check/
        );

        const creditAllocation = (await pool.query(
            `INSERT INTO payment_allocations (
                merchant_id, invoice_id, customer_id, source_type, amount, event_key
             )
             VALUES ($1, $2, $3, 'CUSTOMER_CREDIT', 600, $4)
             RETURNING id`,
            [merchantId, creditInvoiceId, customerId, `credit-allocation-${suffix}`]
        )).rows[0];
        await pool.query(
            `INSERT INTO customer_credit_ledger (
                merchant_id, customer_id, entry_type, direction, amount,
                allocation_id, event_key
             )
             VALUES ($1, $2, 'DEBIT', 'DECREASE', 600, $3, $4)`,
            [merchantId, customerId, creditAllocation.id, `credit-debit-${suffix}-600`]
        );
        await pool.query(
            "UPDATE customer_credit_balances SET available_amount = 400 WHERE merchant_id = $1 AND customer_id = $2",
            [merchantId, customerId]
        );

        await assert.rejects(
            pool.query(
                `INSERT INTO customer_credit_ledger (
                    merchant_id, customer_id, entry_type, direction, amount,
                    provider_transaction_id, event_key
                 )
                 VALUES ($1, $2, 'CREDIT', 'INCREASE', 1000, $3, $4)`,
                [merchantId, customerId, providerOne.id, `credit-${suffix}-1000`]
            ),
            /customer_credit_ledger_event_key_unique/
        );

        await assert.rejects(
            pool.query(
                `INSERT INTO payment_allocations (
                    merchant_id, invoice_id, customer_id, source_type, amount
                 )
                 VALUES ($1, $2, $3, 'CUSTOMER_CREDIT', 100)`,
                [secondMerchantId, secondInvoiceId, customerId]
            ),
            /payment_allocations_customer_fk/
        );

        // Credit-funded allocation reversal restores available credit.
        const creditReversal = (await pool.query(
            `INSERT INTO allocation_reversals (
                merchant_id, original_allocation_id, reason, event_key
             )
             VALUES ($1, $2, 'Restore customer credit', $3)
             RETURNING id`,
            [merchantId, creditAllocation.id, `reversal-credit-${suffix}`]
        )).rows[0];
        await pool.query(
            `INSERT INTO customer_credit_ledger (
                merchant_id, customer_id, entry_type, direction, amount,
                allocation_reversal_id, event_key
             )
             VALUES ($1, $2, 'REVERSAL', 'INCREASE', 600, $3, $4)`,
            [merchantId, customerId, creditReversal.id, `credit-reversal-${suffix}`]
        );
        await pool.query(
            "UPDATE customer_credit_balances SET available_amount = 1000 WHERE merchant_id = $1 AND customer_id = $2",
            [merchantId, customerId]
        );

        // Unassigned received funds remain separate and cannot be over-allocated.
        const unassignedProvider = (await pool.query(
            `INSERT INTO provider_transactions (
                merchant_id, attempt_transaction_id, provider, outcome,
                provider_reference, received_amount, evidence_type
             )
             VALUES ($1, $2, 'MPESA', 'SUCCESS', $3, 500, 'CALLBACK')
             RETURNING id`,
            [merchantId, thirdAttemptId, `RECEIPT-UNASSIGNED-${suffix}`]
        )).rows[0];
        const unassigned = (await pool.query(
            `INSERT INTO unassigned_received_funds (
                merchant_id, provider_transaction_id, received_amount
             )
             VALUES ($1, $2, 500)
             RETURNING id`,
            [merchantId, unassignedProvider.id]
        )).rows[0];
        await assert.rejects(
            pool.query(
                "UPDATE unassigned_received_funds SET allocated_amount = 501 WHERE id = $1",
                [unassigned.id]
            ),
            /unassigned_received_funds_allocation_check/
        );
        const unassignedAllocation = (await pool.query(
            `INSERT INTO payment_allocations (
                merchant_id, invoice_id, source_type,
                unassigned_received_funds_id, amount
             )
             VALUES ($1, $2, 'UNASSIGNED_FUNDS', $3, 200)
             RETURNING id`,
            [merchantId, creditInvoiceId, unassigned.id]
        )).rows[0];
        await pool.query(
            "UPDATE unassigned_received_funds SET allocated_amount = 200 WHERE id = $1",
            [unassigned.id]
        );
        await pool.query(
            `INSERT INTO allocation_reversals (
                merchant_id, original_allocation_id, reason, event_key
             )
             VALUES ($1, $2, 'Return unassigned funds', $3)`,
            [merchantId, unassignedAllocation.id, `reversal-unassigned-${suffix}`]
        );
        await pool.query(
            "UPDATE unassigned_received_funds SET allocated_amount = 0 WHERE id = $1",
            [unassigned.id]
        );

        // Concurrent credit-funded allocations serialize on the merchant/customer balance row.
        const allocateConcurrently = async (amount, eventKey) => {
            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                const balance = await client.query(
                    `SELECT available_amount
                     FROM customer_credit_balances
                     WHERE merchant_id = $1 AND customer_id = $2
                     FOR UPDATE`,
                    [merchantId, customerId]
                );
                if (Number(balance.rows[0].available_amount) < amount) {
                    throw new Error("Insufficient customer credit");
                }
                const allocation = await client.query(
                    `INSERT INTO payment_allocations (
                        merchant_id, invoice_id, customer_id, source_type, amount, event_key
                     )
                     VALUES ($1, $2, $3, 'CUSTOMER_CREDIT', $4, $5)
                     RETURNING id`,
                    [merchantId, creditInvoiceId, customerId, amount, eventKey]
                );
                await client.query(
                    `INSERT INTO customer_credit_ledger (
                        merchant_id, customer_id, entry_type, direction, amount,
                        allocation_id, event_key
                     )
                     VALUES ($1, $2, 'DEBIT', 'DECREASE', $3, $4, $5)`,
                    [merchantId, customerId, amount, allocation.rows[0].id, `ledger-${eventKey}`]
                );
                await client.query(
                    `UPDATE customer_credit_balances
                     SET available_amount = available_amount - $3, updated_at = NOW()
                     WHERE merchant_id = $1 AND customer_id = $2`,
                    [merchantId, customerId, amount]
                );
                await client.query("COMMIT");
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            } finally {
                client.release();
            }
        };

        const concurrent = await Promise.allSettled([
            allocateConcurrently(600, `concurrent-${suffix}-600`),
            allocateConcurrently(500, `concurrent-${suffix}-500`)
        ]);
        assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
    } finally {
        const cleanup = async (merchant) => {
            if (!merchant) return;
            await pool.query("DELETE FROM allocation_reversals WHERE merchant_id = $1", [merchant]).catch(() => {});
            await pool.query("DELETE FROM customer_credit_ledger WHERE merchant_id = $1", [merchant]).catch(() => {});
            await pool.query("DELETE FROM customer_credit_balances WHERE merchant_id = $1", [merchant]).catch(() => {});
            await pool.query("DELETE FROM payment_allocations WHERE merchant_id = $1", [merchant]).catch(() => {});
            await pool.query("DELETE FROM unassigned_received_funds WHERE merchant_id = $1", [merchant]).catch(() => {});
            await pool.query("DELETE FROM provider_transactions WHERE merchant_id = $1", [merchant]).catch(() => {});
            await pool.query("DELETE FROM transactions WHERE merchant_id = $1", [merchant]).catch(() => {});
            await pool.query("DELETE FROM payments WHERE merchant_id = $1", [merchant]).catch(() => {});
            await pool.query("DELETE FROM invoices WHERE merchant_id = $1", [merchant]).catch(() => {});
            await pool.query("DELETE FROM customers WHERE merchant_id = $1", [merchant]).catch(() => {});
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchant]).catch(() => {});
        };
        await cleanup(merchantId);
        await cleanup(secondMerchantId);
        await pool.query("DELETE FROM users WHERE email = $1", [email]).catch(() => {});
        await pool.query("DELETE FROM users WHERE email = $1", [secondEmail]).catch(() => {});
        await closeDatabase();
    }
});
