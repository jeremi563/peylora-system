import { randomBytes } from "node:crypto";

import { getDatabasePool } from "../database.js";

export async function createPaymentLink(merchantId, {
    description,
    amount,
    expiresAt,
    invoiceId,
    useMode = "REUSABLE"
}) {
    const client = await getDatabasePool().connect();
    const reference = randomBytes(24).toString("base64url");
    try {
        await client.query("BEGIN");
        const payment = await client.query(
            `INSERT INTO payments (
                merchant_id, invoice_id, reference, amount, currency,
                phone_number, description, status
             )
             VALUES ($1, $2, $3, $4, 'KES', '254700000000', $5, 'PENDING')
             RETURNING id`,
            [
                merchantId,
                invoiceId ?? null,
                `PAY-LINK-${randomBytes(12).toString("base64url")}`,
                amount,
                description
            ]
        );
        const link = await client.query(
            `INSERT INTO payment_links (
                merchant_id, invoice_id, payment_id, reference, description,
                amount, currency, use_mode, expires_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, 'KES', $7, $8)
             RETURNING id, reference, description, amount, currency, status,
                       use_mode, expires_at, payment_id, created_at`,
            [
                merchantId,
                invoiceId ?? null,
                payment.rows[0].id,
                reference,
                description,
                amount,
                useMode,
                expiresAt ?? null
            ]
        );
        await client.query(
            `UPDATE payments
             SET payment_link_id = $2, updated_at = NOW()
             WHERE id = $1 AND merchant_id = $3`,
            [payment.rows[0].id, link.rows[0].id, merchantId]
        );
        await client.query("COMMIT");
        return { ...link.rows[0], amount: Number(link.rows[0].amount) };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function listMerchantPaymentLinks(merchantId) {
    const result = await getDatabasePool().query(
        `SELECT pl.id, pl.reference, pl.description, pl.amount, pl.currency, pl.status,
            pl.use_mode, pl.consumed_at, pl.payment_id, pl.expires_at,
            pl.created_at, pl.updated_at,
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
                pl.status, pl.use_mode, pl.payment_id, pl.consumed_at, pl.expires_at, m.business_name,
                pr.status AS payment_status,
                COALESCE(payment_fulfillment.amount_received, 0) AS amount_received
         FROM payment_links pl
         JOIN merchants m ON m.id = pl.merchant_id
         LEFT JOIN invoices i ON i.id = pl.invoice_id
         JOIN payments pr ON pr.id = pl.payment_id AND pr.merchant_id = pl.merchant_id
         LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(pt.received_amount), 0)::numeric(12,2) AS amount_received
             FROM transactions attempt
             JOIN provider_transactions pt
               ON pt.attempt_transaction_id = attempt.id
              AND pt.merchant_id = attempt.merchant_id
              AND pt.outcome = 'SUCCESS'
             WHERE (
                 attempt.payment_id = pr.id
                 OR attempt.payment_id IN (
                     SELECT historical_payment.id
                     FROM payments historical_payment
                     WHERE historical_payment.payment_link_id = pl.id
                       AND historical_payment.merchant_id = pl.merchant_id
                 )
             )
               AND attempt.merchant_id = pr.merchant_id
         ) payment_fulfillment ON true
         WHERE pl.reference = $1
           AND pl.status = 'ACTIVE'
           AND m.status = 'ACTIVE'
           AND (i.id IS NULL OR i.status NOT IN ('PAID', 'CANCELLED'))
           AND COALESCE(payment_fulfillment.amount_received, 0) < pr.amount
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
         JOIN payments p ON p.id = pl.payment_id
                        AND p.merchant_id = pl.merchant_id
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