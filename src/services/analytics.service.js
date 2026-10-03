import { getDatabasePool } from "../database.js";

const DAY_MS = 86_400_000;

export function resolveAnalyticsRange({ from, to }) {
    const today = new Date().toISOString().slice(0, 10);
    const end = to || today;
    const start = from || new Date(Date.parse(`${end}T00:00:00Z`) - 29 * DAY_MS).toISOString().slice(0, 10);
    return { from: start, to: end };
}

export async function getMerchantDashboard(merchantId, query) {
    const { from, to } = resolveAnalyticsRange(query);
    const pool = getDatabasePool();
    const rangeValues = [merchantId, from, to];

    const summary = await pool.query(
        `WITH scoped_transactions AS (
             SELECT t.*
             FROM transactions t
             WHERE t.merchant_id = $1
               AND t.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
               AND t.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
         ), successful_payments AS (
             SELECT DISTINCT ON (payment_id) payment_id, paid_amount
             FROM scoped_transactions
             WHERE status = 'SUCCESS' AND amount_matches IS TRUE
             ORDER BY payment_id, callback_received_at DESC NULLS LAST, created_at DESC
         )
         SELECT COALESCE((SELECT SUM(paid_amount) FROM successful_payments), 0)::numeric(14,2) AS revenue,
                (SELECT COUNT(*)::integer FROM successful_payments) AS successful_payments,
                (SELECT COUNT(DISTINCT payment_id)::integer FROM scoped_transactions WHERE status = 'PENDING') AS pending_payments,
                (SELECT COUNT(DISTINCT payment_id)::integer FROM scoped_transactions WHERE status = 'FAILED') AS failed_payments,
                (SELECT COUNT(DISTINCT payment_id)::integer FROM scoped_transactions WHERE status = 'CANCELLED') AS cancelled_payments,
                (SELECT COUNT(*)::integer FROM scoped_transactions) AS transaction_volume,
                (SELECT COUNT(*)::integer FROM scoped_transactions WHERE status = 'SUCCESS' AND amount_matches IS FALSE) AS amount_mismatch_count,
                COALESCE((SELECT AVG(paid_amount) FROM successful_payments), 0)::numeric(14,2) AS average_payment` ,
        rangeValues
    );

    const interval = query.interval || "day";
    const series = await pool.query(
        `WITH buckets AS (
             SELECT generate_series(
                 CASE WHEN $4 = 'week' THEN date_trunc('week', $2::date::timestamp) ELSE date_trunc($4, $2::date::timestamp) END,
                 CASE WHEN $4 = 'week' THEN date_trunc('week', $3::date::timestamp) ELSE date_trunc($4, $3::date::timestamp) END,
                 CASE $4
                     WHEN 'day' THEN interval '1 day'
                     WHEN 'week' THEN interval '1 week'
                     ELSE interval '1 month'
                 END
             ) AS bucket
         ), scoped AS (
             SELECT t.*,
                    CASE WHEN $4 = 'week' THEN date_trunc('week', t.created_at AT TIME ZONE 'UTC')
                         ELSE date_trunc($4, t.created_at AT TIME ZONE 'UTC') END AS bucket
             FROM transactions t
             WHERE t.merchant_id = $1
               AND t.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
               AND t.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
         ), aggregate_by_bucket AS (
             SELECT bucket,
                    COUNT(*)::integer AS transaction_volume,
                    COUNT(*) FILTER (WHERE status = 'SUCCESS' AND amount_matches IS TRUE)::integer AS successful_transactions,
                    COALESCE(SUM(paid_amount) FILTER (WHERE status = 'SUCCESS' AND amount_matches IS TRUE), 0)::numeric(14,2) AS revenue
             FROM scoped
             GROUP BY bucket
         )
         SELECT buckets.bucket AT TIME ZONE 'UTC' AS bucket,
                COALESCE(aggregate_by_bucket.transaction_volume, 0)::integer AS transaction_volume,
                COALESCE(aggregate_by_bucket.successful_transactions, 0)::integer AS successful_transactions,
                COALESCE(aggregate_by_bucket.revenue, 0)::numeric(14,2) AS revenue
         FROM buckets
         LEFT JOIN aggregate_by_bucket USING (bucket)
         ORDER BY buckets.bucket`,
        [...rangeValues, interval]
    );

    const statuses = await pool.query(
        `SELECT status, COUNT(*)::integer AS transactions,
                COUNT(DISTINCT payment_id)::integer AS payments
         FROM transactions
         WHERE merchant_id = $1
           AND created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
           AND created_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
         GROUP BY status
         ORDER BY status`,
        rangeValues
    );

    const totals = summary.rows[0];
    return {
        range: { from, to },
        summary: {
            revenue: Number(totals.revenue),
            successfulPayments: totals.successful_payments,
            pendingPayments: totals.pending_payments,
            failedPayments: totals.failed_payments,
            cancelledPayments: totals.cancelled_payments,
            transactionVolume: totals.transaction_volume,
            amountMismatchCount: totals.amount_mismatch_count,
            averageSuccessfulPayment: Number(totals.average_payment)
        },
        series: series.rows.map((row) => ({
            date: row.bucket.toISOString(),
            revenue: Number(row.revenue),
            transactionVolume: row.transaction_volume,
            successfulTransactions: row.successful_transactions
        })),
        statusBreakdown: statuses.rows.map((row) => ({
            status: row.status,
            transactions: row.transactions,
            payments: row.payments
        }))
    };
}

export async function getMerchantTransactionReport(merchantId, query) {
    const { from, to } = resolveAnalyticsRange(query);
    const result = await getDatabasePool().query(
        `SELECT t.id AS transaction_id, p.id AS payment_id, p.reference,
                COALESCE(i.invoice_number, p.reference) AS invoice_number,
                t.status, t.amount AS requested_amount, t.paid_amount,
                t.currency, t.amount_matches, t.phone_number,
                t.mpesa_receipt_number, t.result_code, t.result_description,
                t.created_at, t.callback_received_at
         FROM transactions t
         JOIN payments p ON p.id = t.payment_id
         LEFT JOIN invoices i ON i.id = p.invoice_id
         WHERE t.merchant_id = $1
           AND t.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
           AND t.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
         ORDER BY t.created_at DESC`,
        [merchantId, from, to]
    );

    return { range: { from, to }, rows: result.rows };
}