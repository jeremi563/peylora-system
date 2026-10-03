import { useEffect, useState } from "react";
import { ArrowDownToLine, BarChart3, CalendarDays, CircleDollarSign, ReceiptText, TriangleAlert } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { apiRequest, downloadReport } from "../api.js";
import { EmptyState, ErrorNotice, ErrorState, formatDate, formatKes, LoadingState, PageHeading, StatusBadge, Toast } from "../components/ui.jsx";

function initialRange() {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

export default function AnalyticsPage() {
  const [range, setRange] = useState(initialRange);
  const [interval, setInterval] = useState("day");
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");
  const [toast, setToast] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ ...range, interval });
      const result = await apiRequest(`/api/analytics/dashboard?${params}`);
      setDashboard(result.dashboard);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [interval]);

  async function exportReport(format) {
    setExporting(format);
    try {
      await downloadReport(
        `/api/analytics/reports/transactions?from=${range.from}&to=${range.to}&format=${format}`,
        `transactions-${range.from}-to-${range.to}.${format}`
      );
      setToast({ type: "success", message: `Downloaded ${format.toUpperCase()} report successfully` });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setExporting("");
    }
  }

  return (
    <div className="page-stack">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <PageHeading
        eyebrow="REPORTING & AUDIT"
        title="Analytics"
        description="Track transaction volume and callback-confirmed revenue over time."
        actions={
          <div className="export-group">
            {["csv", "xlsx", "pdf"].map((format) => (
              <button
                className="button button-subtle"
                key={format}
                type="button"
                disabled={Boolean(exporting)}
                onClick={() => exportReport(format)}
              >
                <ArrowDownToLine size={14} /> {exporting === format ? "Preparing…" : format.toUpperCase()}
              </button>
            ))}
          </div>
        }
      />
      <ErrorNotice message={error} onDismiss={() => setError("")} />
      <section className="surface analytics-filter">
        <CalendarDays size={17} />
        <label>
          From
          <input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} />
        </label>
        <label>
          To
          <input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} />
        </label>
        <label>
          Interval
          <select value={interval} onChange={(event) => setInterval(event.target.value)}>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </label>
        <button className="button button-secondary" type="button" onClick={load}>
          Apply
        </button>
      </section>

      {loading ? (
        <LoadingState label="Calculating merchant analytics and revenue curves..." />
      ) : error && !dashboard ? (
        <ErrorState title="Could not calculate analytics" message={error} onRetry={load} />
      ) : dashboard ? (
        <>
          <div className="analytics-kpis">
            <section className="metric">
              <div className="metric-icon metric-green"><CircleDollarSign size={18} /></div>
              <span className="metric-label">Verified revenue</span>
              <strong>{formatKes(dashboard.summary.revenue)}</strong>
              <small>Matched successful callbacks only</small>
            </section>
            <section className="metric">
              <div className="metric-icon metric-blue"><ReceiptText size={18} /></div>
              <span className="metric-label">Transaction volume</span>
              <strong>{dashboard.summary.transactionVolume}</strong>
              <small>{dashboard.summary.successfulPayments} successful payments</small>
            </section>
            <section className="metric">
              <div className="metric-icon metric-amber"><BarChart3 size={18} /></div>
              <span className="metric-label">Average payment</span>
              <strong>{formatKes(dashboard.summary.averageSuccessfulPayment)}</strong>
              <small>Successful, amount-matched payments</small>
            </section>
            <section className="metric">
              <div className="metric-icon metric-red"><TriangleAlert size={18} /></div>
              <span className="metric-label">Amount mismatches</span>
              <strong>{dashboard.summary.amountMismatchCount}</strong>
              <small>Require manual review</small>
            </section>
          </div>

          <section className="surface chart-surface analytics-chart">
            <div className="surface-heading">
              <div>
                <span className="eyebrow">
                  {formatDate(`${dashboard.range.from}T00:00:00Z`, { timeZone: "UTC" })} — {formatDate(`${dashboard.range.to}T00:00:00Z`, { timeZone: "UTC" })}
                </span>
                <h3>Revenue and transaction activity</h3>
              </div>
              <span className="surface-meta"><i className="chart-legend-dot" /> Revenue</span>
            </div>
            {dashboard.series.length ? (
              <div className="chart-holder">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dashboard.series} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2c766b" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#2c766b" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e8eeeb" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" })} tickLine={false} axisLine={false} tick={{ fill: "#82908d", fontSize: 11 }} minTickGap={28} />
                    <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} tickLine={false} axisLine={false} tick={{ fill: "#82908d", fontSize: 11 }} />
                    <Tooltip formatter={(value, key) => [key === "revenue" ? formatKes(value) : value, key === "revenue" ? "Revenue" : "Transactions"]} labelFormatter={(value) => formatDate(value, { timeZone: "UTC" })} contentStyle={{ border: "1px solid #e0e8e4", borderRadius: 8, fontSize: 12 }} />
                    <Area type="monotone" dataKey="revenue" stroke="#287568" strokeWidth={2.5} fill="url(#analyticsFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState title="No activity for this date range" description="Choose another period to inspect payment activity." />
            )}
          </section>

          <section className="surface status-breakdown">
            <div className="surface-heading">
              <div>
                <span className="eyebrow">LIFECYCLE</span>
                <h3>Payment outcomes</h3>
              </div>
            </div>
            <div className="breakdown-list">
              {dashboard.statusBreakdown.length ? (
                dashboard.statusBreakdown.map((item) => (
                  <div className="breakdown-row" key={item.status}>
                    <StatusBadge status={item.status} />
                    <div className="breakdown-meter">
                      <i style={{ width: `${dashboard.summary.transactionVolume ? Math.max(3, item.transactions / dashboard.summary.transactionVolume * 100) : 0}%` }} />
                    </div>
                    <strong>{item.transactions}</strong>
                    <small>{item.payments} payments</small>
                  </div>
                ))
              ) : (
                <EmptyState title="No transactions" description="Status breakdown will appear after payment requests are created." />
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}