import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleDollarSign, Clock3, Plus, ReceiptText, RotateCw, TriangleAlert } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";

import { apiRequest } from "../api.js";
import { EmptyState, ErrorNotice, ErrorState, formatDate, formatKes, LoadingState, PageHeading, StatusBadge } from "../components/ui.jsx";

function Metric({ icon: Icon, label, value, detail, tone = "green" }) {
  return (
    <section className="metric">
      <div className={`metric-icon metric-${tone}`}>
        <Icon size={19} />
      </div>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function MetricSkeleton() {
  return (
    <div className="metric metric-skeleton">
      <div className="skeleton-pulse" style={{ width: 34, height: 34, borderRadius: 8 }} />
      <div className="skeleton-pulse" style={{ width: "60%", height: 12, marginTop: 14 }} />
      <div className="skeleton-pulse" style={{ width: "80%", height: 24, marginTop: 8 }} />
      <div className="skeleton-pulse" style={{ width: "50%", height: 11, marginTop: 6 }} />
    </div>
  );
}

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [analytics, recent] = await Promise.all([
        apiRequest(`/api/analytics/dashboard?from=${from}&to=${today}&interval=day`),
        apiRequest("/api/payments?page=1&limit=6")
      ]);
      setDashboard(analytics.dashboard);
      setPayments(recent.payments || []);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading && !dashboard) {
    return (
      <div className="page-stack">
        <PageHeading eyebrow="WORKSPACE DASHBOARD" title="Business at a glance" description="A live view of payments across your workspace." />
        <div className="metric-grid">
          <MetricSkeleton />
          <MetricSkeleton />
          <MetricSkeleton />
          <MetricSkeleton />
        </div>
        <LoadingState label="Gathering verified revenue and recent activity..." />
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className="page-stack">
        <PageHeading eyebrow="WORKSPACE DASHBOARD" title="Business at a glance" />
        <ErrorState title="Could not load dashboard data" message={error} onRetry={() => load()} />
      </div>
    );
  }

  const summary = dashboard?.summary || {};
  const chartRows = dashboard?.series || [];

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="LAST 30 DAYS · UTC"
        title="Business at a glance"
        description="A live view of payments across your workspace."
        actions={
          <>
            <button className="button button-subtle" type="button" onClick={() => load(true)} disabled={refreshing}>
              <RotateCw size={15} className={refreshing ? "spin" : ""} /> Refresh
            </button>
            <Link className="button button-primary" to="/payments">
              <Plus size={16} /> New payment
            </Link>
          </>
        }
      />
      <ErrorNotice message={error} onDismiss={() => setError("")} />
      <div className="metric-grid">
        <Metric icon={CircleDollarSign} label="Verified revenue" value={formatKes(summary.revenue)} detail="Amount-matched successful payments" />
        <Metric icon={ReceiptText} label="Successful payments" value={summary.successfulPayments ?? 0} detail={`Average ${formatKes(summary.averageSuccessfulPayment)}`} tone="blue" />
        <Metric icon={Clock3} label="Awaiting outcome" value={summary.pendingPayments ?? 0} detail="Customer action or callback pending" tone="amber" />
        <Metric icon={TriangleAlert} label="Needs review" value={summary.amountMismatchCount ?? 0} detail={`${summary.failedPayments ?? 0} failed · ${summary.cancelledPayments ?? 0} cancelled`} tone="red" />
      </div>

      <div className="dashboard-grid">
        <section className="surface chart-surface">
          <div className="surface-heading">
            <div>
              <span className="eyebrow">PERFORMANCE</span>
              <h3>Verified revenue</h3>
            </div>
            <span className="surface-meta"><i className="chart-legend-dot" /> Revenue</span>
          </div>
          {chartRows.length ? (
            <div className="chart-holder">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartRows} margin={{ top: 10, right: 10, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2c766b" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#2c766b" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e8eeeb" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" })} tickLine={false} axisLine={false} tick={{ fill: "#82908d", fontSize: 11 }} minTickGap={25} />
                  <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} tickLine={false} axisLine={false} tick={{ fill: "#82908d", fontSize: 11 }} />
                  <Tooltip formatter={(value) => [formatKes(value), "Revenue"]} labelFormatter={(value) => formatDate(value, { timeZone: "UTC" })} contentStyle={{ border: "1px solid #e0e8e4", borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="revenue" stroke="#287568" strokeWidth={2.5} fill="url(#revenueFill)" activeDot={{ r: 4, fill: "#287568" }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No revenue in this period" description="Matched successful M-Pesa callbacks will appear here." />
          )}
          <div className="chart-footnote">
            <span><ArrowUpRight size={14} /> {summary.transactionVolume ?? 0} transactions</span>
            <span>Revenue counts only matched callback amounts</span>
          </div>
        </section>

        <section className="surface activity-surface">
          <div className="surface-heading">
            <div>
              <span className="eyebrow">LATEST ACTIVITY</span>
              <h3>Recent payments</h3>
            </div>
            <Link className="subtle-link" to="/payments">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          {payments.length ? (
            <div className="activity-list">
              {payments.map((payment) => (
                <Link className="activity-row" key={payment.id} to={`/payments?selected=${payment.id}`}>
                  <span className="activity-symbol">
                    {payment.status === "SUCCESS" ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                  </span>
                  <span className="activity-info">
                    <strong>{payment.description || payment.reference}</strong>
                    <small>{formatDate(payment.created_at)}</small>
                  </span>
                  <span className="activity-amount">
                    <strong>{formatKes(payment.amount)}</strong>
                    <StatusBadge status={payment.status} pulse={payment.status === "PENDING"} />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No payments yet"
              description="Create a payment request to start tracking activity."
              action={<Link className="button button-secondary" to="/payments">Create payment</Link>}
            />
          )}
        </section>
      </div>
    </div>
  );
}