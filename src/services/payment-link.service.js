import { randomBytes } from "node:crypto";

import { getDatabasePool } from "../database.js";

export async function createPaymentLink(merchantId, { description, amount, expiresAt, invoiceId }) {
    const reference = randomBytes(24).toString("base64url");
    const result = await getDatabasePool().query(
        `INSERT INTO payment_links (merchant_id, invoice_id, reference, description, amount, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, reference, description, amount, currency, status, expires_at, created_at`,
        [merchantId, invoiceId ?? null, reference, description, amount, expiresAt ?? null]
    );

    return { ...result.rows[0], amount: Number(result.rows[0].amount) };
}

export async function listMerchantPaymentLinks(merchantId) {
    const result = await getDatabasePool().query(
        `SELECT pl.id, pl.reference, pl.description, pl.amount, pl.currency, pl.status,
            pl.expires_at, pl.created_at, pl.updated_at,
            COUNT(p.id)::integer AS payment_count,
            COUNT(p.id) FILTER (WHERE p.status = 'SUCCESS')::integer AS successful_payment_count
         FROM payment_links pl
         LEFT JOIN payments p ON p.payment_link_id = pl.id
         WHERE pl.merchant_id = $1
         GROUP BY pl.id
         ORDER BY pl.created_at DESC`,
        [merchantId]
    );

    return result.rows.map(({ amount, ...link }) => ({ ...link, amount: Number(amount) }));
}

export async function deactivatePaymentLink(merchantId, linkId) {
    const result = await getDatabasePool().query(
        `UPDATE payment_links
         SET status = 'INACTIVE', updated_at = NOW()
         WHERE id = $1 AND merchant_id = $2 AND status = 'ACTIVE'
         RETURNING id, reference, status, updated_at`,
        [linkId, merchantId]
    );

    return result.rows[0] ?? null;
}

export async function getPublicPaymentLink(reference) {
    const result = await getDatabasePool().query(
        `SELECT pl.id, pl.merchant_id, pl.invoice_id, pl.reference, pl.description, pl.amount, pl.currency,
                pl.status, pl.expires_at, m.business_name
         FROM payment_links pl
         JOIN merchants m ON m.id = pl.merchant_id
                 LEFT JOIN invoices i ON i.id = pl.invoice_id
         WHERE pl.reference = $1
           AND pl.status = 'ACTIVE'
           AND m.status = 'ACTIVE'
                     AND (i.id IS NULL OR i.status NOT IN ('PAID', 'CANCELLED'))
           AND (pl.expires_at IS NULL OR pl.expires_at > NOW())`,
        [reference]
    );

    if (!result.rowCount) return null;
    return { ...result.rows[0], amount: Number(result.rows[0].amount) };
}

export async function getPublicLinkedPaymentStatus(reference, paymentId) {
    const result = await getDatabasePool().query(
        `SELECT p.id, p.status, p.amount, p.currency, p.created_at, p.updated_at,
                t.mpesa_receipt_number, t.provider_transaction_date,
                t.result_description
         FROM payment_links pl
         JOIN payments p ON p.payment_link_id = pl.id
         LEFT JOIN LATERAL (
             SELECT mpesa_receipt_number, provider_transaction_date, result_description
             FROM transactions WHERE payment_id = p.id
             ORDER BY created_at DESC LIMIT 1
         ) t ON true
         WHERE pl.reference = $1 AND p.id = $2`,
        [reference, paymentId]
    );

    if (!result.rowCount) return null;
    return { ...result.rows[0], amount: Number(result.rows[0].amount) };
}