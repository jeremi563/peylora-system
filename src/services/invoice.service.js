import { randomBytes } from "node:crypto";

import { getDatabasePool } from "../database.js";

function mapInvoice(row) {
    if (!row) return null;
    return {
        ...row,
        total_amount: Number(row.total_amount),
        items: row.items ?? [],
        payments: row.payments ?? [],
        paymentLinks: row.payment_links ?? []
    };
}

export async function createInvoice(merchantId, { invoiceNumber, customer, items, dueAt }) {
    const pool = getDatabasePool();
    const client = await pool.connect();
    const finalInvoiceNumber = invoiceNumber || `INV-${randomBytes(6).toString("hex").toUpperCase()}`;

    try {
        await client.query("BEGIN");
        const customerResult = await client.query(
            `INSERT INTO customers (merchant_id, name, phone_number, email)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (merchant_id, phone_number)
             DO UPDATE SET name = EXCLUDED.name,
                           email = COALESCE(EXCLUDED.email, customers.email),
                           updated_at = NOW()
             RETURNING id`,
            [merchantId, customer.name, customer.phoneNumber, customer.email ?? null]
        );
        const invoice = await client.query(
            `INSERT INTO invoices (merchant_id, customer_id, invoice_number, status, due_at)
             VALUES ($1, $2, $3, 'DRAFT', $4)
             RETURNING id, merchant_id, customer_id, invoice_number, currency,
                       total_amount, status, due_at, created_at, updated_at`,
            [merchantId, customerResult.rows[0].id, finalInvoiceNumber, dueAt ?? null]
        );

        for (const item of items) {
            await client.query(
                `INSERT INTO invoice_items (invoice_id, description, quantity, unit_amount)
                 VALUES ($1, $2, $3, $4)`,
                [invoice.rows[0].id, item.description, item.quantity, item.unitAmount]
            );
        }

        const total = await client.query(
            "SELECT COALESCE(SUM(line_total), 0)::numeric(12, 2) AS total FROM invoice_items WHERE invoice_id = $1",
            [invoice.rows[0].id]
        );
        const updated = await client.query(
            `UPDATE invoices SET total_amount = $2, updated_at = NOW()
             WHERE id = $1
             RETURNING id, merchant_id, customer_id, invoice_number, currency,
                       total_amount, status, due_at, created_at, updated_at`,
            [invoice.rows[0].id, total.rows[0].total]
        );
        await client.query("COMMIT");

        return {
            ...updated.rows[0],
            total_amount: Number(updated.rows[0].total_amount),
            items: items.map((item) => ({
                ...item,
                lineTotal: Math.round(item.unitAmount * 100) * item.quantity / 100
            }))
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function listMerchantInvoices(merchantId, { status, search, page, limit }) {
    const values = [merchantId];
    const filters = ["i.merchant_id = $1"];
    if (status) {
        values.push(status);
        filters.push(`i.status = $${values.length}`);
    }
    if (search) {
        values.push(`%${search}%`);
        filters.push(`(i.invoice_number ILIKE $${values.length} OR c.name ILIKE $${values.length} OR c.phone_number ILIKE $${values.length})`);
    }

    const where = filters.join(" AND ");
    const offset = (page - 1) * limit;
    const pool = getDatabasePool();
    const rows = await pool.query(
        `SELECT i.id, i.invoice_number, i.total_amount, i.currency, i.status, i.due_at,
                i.created_at, i.updated_at, c.name AS customer_name, c.phone_number AS customer_phone,
                COUNT(*) OVER()::integer AS total_count
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         WHERE ${where}
         ORDER BY i.created_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
    );
    const total = rows.rows[0]?.total_count ?? (await pool.query(
        `SELECT COUNT(*)::integer AS total
         FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
         WHERE ${where}`,
        values
    )).rows[0].total;

    return {
        items: rows.rows.map(({ total_count: _totalCount, total_amount, ...invoice }) => ({
            ...invoice,
            total_amount: Number(total_amount)
        })),
        total
    };
}

export async function getMerchantInvoice(merchantId, invoiceId) {
    const result = await getDatabasePool().query(
        `SELECT i.id, i.invoice_number, i.total_amount, i.currency, i.status, i.due_at,
                i.created_at, i.updated_at,
                jsonb_build_object('id', c.id, 'name', c.name, 'phoneNumber', c.phone_number, 'email', c.email) AS customer,
                COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'id', ii.id, 'description', ii.description, 'quantity', ii.quantity,
                        'unitAmount', ii.unit_amount, 'lineTotal', ii.line_total
                    ) ORDER BY ii.created_at)
                    FROM invoice_items ii WHERE ii.invoice_id = i.id
                ), '[]'::jsonb) AS items,
                COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'id', p.id, 'reference', p.reference, 'status', p.status,
                        'amount', p.amount, 'createdAt', p.created_at
                    ) ORDER BY p.created_at DESC)
                    FROM payments p WHERE p.invoice_id = i.id
                ), '[]'::jsonb) AS payments,
                COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'id', pl.id, 'reference', pl.reference, 'status', pl.status,
                        'createdAt', pl.created_at
                    ) ORDER BY pl.created_at DESC)
                    FROM payment_links pl WHERE pl.invoice_id = i.id
                ), '[]'::jsonb) AS payment_links
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
         WHERE i.id = $1 AND i.merchant_id = $2`,
        [invoiceId, merchantId]
    );

    return mapInvoice(result.rows[0]);
}

export async function updateInvoiceStatus(merchantId, invoiceId, requestedStatus) {
    const client = await getDatabasePool().connect();
    const transitions = {
        DRAFT: ["SENT", "CANCELLED"],
        SENT: ["CANCELLED", "OVERDUE"],
        PENDING: ["CANCELLED", "OVERDUE"],
        OVERDUE: ["SENT", "CANCELLED"]
    };

    try {
        await client.query("BEGIN");
        const current = await client.query(
            "SELECT id, status, due_at FROM invoices WHERE id = $1 AND merchant_id = $2 FOR UPDATE",
            [invoiceId, merchantId]
        );
        if (!current.rowCount || !transitions[current.rows[0].status]?.includes(requestedStatus) ||
            (requestedStatus === "OVERDUE" && (!current.rows[0].due_at || new Date(current.rows[0].due_at) > new Date()))) {
            await client.query("ROLLBACK");
            return null;
        }

        if (requestedStatus === "CANCELLED") {
            const pendingPayment = await client.query(
                "SELECT 1 FROM payments WHERE invoice_id = $1 AND status = 'PENDING' LIMIT 1",
                [invoiceId]
            );
            if (pendingPayment.rowCount) {
                await client.query("ROLLBACK");
                return null;
            }
        }

        const updated = await client.query(
            `UPDATE invoices SET status = $3, updated_at = NOW()
             WHERE id = $1 AND merchant_id = $2
             RETURNING id, invoice_number, total_amount, currency, status, due_at, updated_at`,
            [invoiceId, merchantId, requestedStatus]
        );
        if (requestedStatus === "CANCELLED") {
            await client.query(
                `UPDATE payment_links SET status = 'INACTIVE', updated_at = NOW()
                 WHERE invoice_id = $1 AND status = 'ACTIVE'`,
                [invoiceId]
            );
        }
        await client.query("COMMIT");
        return { ...updated.rows[0], total_amount: Number(updated.rows[0].total_amount) };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function createInvoicePaymentLink(merchantId, invoiceId) {
    const client = await getDatabasePool().connect();
    const reference = randomBytes(24).toString("base64url");

    try {
        await client.query("BEGIN");
        const invoice = await client.query(
            `SELECT id, invoice_number, total_amount, status, due_at
             FROM invoices WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
            [invoiceId, merchantId]
        );
        if (!invoice.rowCount || ["PAID", "CANCELLED"].includes(invoice.rows[0].status) || Number(invoice.rows[0].total_amount) <= 0) {
            await client.query("ROLLBACK");
            return null;
        }

        const existing = await client.query(
            `SELECT id, reference, description, amount, currency, status, expires_at, created_at
             FROM payment_links
             WHERE invoice_id = $1 AND merchant_id = $2 AND status = 'ACTIVE'
               AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY created_at DESC LIMIT 1`,
            [invoiceId, merchantId]
        );
        if (existing.rowCount) {
            await client.query("COMMIT");
            return { ...existing.rows[0], amount: Number(existing.rows[0].amount), reused: true };
        }

        const link = await client.query(
            `INSERT INTO payment_links (merchant_id, invoice_id, reference, description, amount)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, reference, description, amount, currency, status, expires_at, created_at`,
            [merchantId, invoiceId, reference, `Invoice ${invoice.rows[0].invoice_number}`, invoice.rows[0].total_amount]
        );

        if (invoice.rows[0].status === "DRAFT") {
            await client.query(
                "UPDATE invoices SET status = 'SENT', updated_at = NOW() WHERE id = $1",
                [invoiceId]
            );
        }
        await client.query("COMMIT");
        return { ...link.rows[0], amount: Number(link.rows[0].amount), reused: false };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}