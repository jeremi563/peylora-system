import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Search, ShieldAlert } from "lucide-react";

import { apiRequest, downloadReport } from "../api.js";
import {
  EmptyState,
  ErrorNotice,
  ErrorState,
  PageHeading,
  SkeletonTable,
  StatusBadge,
  Toast,
  formatDate,
  formatKes
} from "../components/ui.jsx";

export default function TransactionsPage() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [exporting, setExporting] = useState(false);

  async function load(nextPage = 1) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: "25" });
      if (status) params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const result = await apiRequest(`/api/payments?${params}`);
      setItems(result.payments || []);
      setPage(result.pagination?.page || nextPage);
      setPages(result.pagination?.pages || 1);
      setTotal(result.pagination?.total || 0);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(1);
  }, [status]);

  async function exportCsv() {
    if (!exporting) {
      setExporting(true);
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      try {
        await downloadReport(`/api/analytics/reports/transactions?from=${from}&to=${to}&format=csv`, `transactions-${from}-to-${to}.csv`);
        setToast({ type: "success", message: "Transactions exported successfully" });
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setExporting(false);
      }
    }
  }

  return (
    <div className="page-stack">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <PageHeading
        eyebrow="TRANSACTION HISTORY"
        title="Transactions"
        description="Review every M-Pesa request, callback result, and customer payment outcome."
        actions={
          <button className="button button-subtle" type="button" disabled={exporting} onClick={exportCsv}>
            <Download size={15} /> {exporting ? "Preparing…" : "Export CSV"}
          </button>
        }
      />
      <ErrorNotice message={error} onDismiss={() => setError("")} />
      <section className="surface table-surface">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && load(1)}
              placeholder="Search reference, phone or receipt"
            />
            <button type="button" onClick={() => load(1)}>Search</button>
          </div>
          <label className="filter-label">
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {"SUCCESS,PENDING,FAILED,CANCELLED,TIMEOUT".split(",").map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <SkeletonTable rows={6} cols={7} />
        ) : error && !items.length ? (
          <ErrorState message={error} onRetry={() => load(1)} />
        ) : items.length ? (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Receipt</th>
                    <th>Created</th>
                    <th>Checkout</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span className="table-primary">{item.reference}</span>
                        <small className="table-secondary">{item.description || "Payment request"}</small>
                      </td>
                      <td>
                        <span>{item.phone_number}</span>
                        <small className="table-secondary">{item.customer_name || "Merchant request"}</small>
                      </td>
                      <td className="amount-cell">{formatKes(item.amount)}</td>
                      <td><StatusBadge status={item.status} pulse={item.status === "PENDING"} /></td>
                      <td className="monospace">{item.receipt_number || "—"}</td>
                      <td>{formatDate(item.created_at)}</td>
                      <td className="monospace">{item.checkout_request_id || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>{total} transaction{total === 1 ? "" : "s"}</span>
              <div>
                <button className="icon-button" type="button" disabled={page <= 1} onClick={() => load(page - 1)} aria-label="Previous page">
                  <ChevronLeft size={16} />
                </button>
                <span>Page {page} of {Math.max(1, pages)}</span>
                <button className="icon-button" type="button" disabled={page >= pages} onClick={() => load(page + 1)} aria-label="Next page">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="No transactions found"
            description="Create a payment request or adjust your filters to review transaction history."
            action={
              <button className="button button-secondary" type="button" onClick={() => { setStatus(""); setSearch(""); }}>
                Clear filters
              </button>
            }
            icon={<ShieldAlert size={16} />}
          />
        )}
      </section>
    </div>
  );
}
