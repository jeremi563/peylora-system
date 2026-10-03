import { useEffect, useState } from "react";
import { ArrowDownToLine, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, LoaderCircle, Plus, Search, TriangleAlert } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { apiRequest, downloadReport } from "../api.js";
import { EmptyState, ErrorNotice, ErrorState, formatDate, formatKes, Modal, PageHeading, SkeletonTable, StatusBadge, Toast } from "../components/ui.jsx";

export default function PaymentsPage() {
  const [query, setQuery] = useSearchParams();
  const [payments, setPayments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, pages: 0 });
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ amount: "", phoneNumber: "", description: "" });

  async function load(page = 1) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (status) params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const result = await apiRequest(`/api/payments?${params}`);
      setPayments(result.payments || []);
      setPagination(result.pagination);
      setError("");
      const selectedId = query.get("selected");
      if (selectedId) {
        const match = result.payments?.find((item) => item.id === selectedId);
        if (match) openPayment(match.id);
        setQuery({}, { replace: true });
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1); }, [status]);

  // Phase 17: Live polling for open pending payment
  useEffect(() => {
    if (!selected?.id || selected.status !== "PENDING") return undefined;
    const timer = window.setInterval(async () => {
      try {
        const result = await apiRequest(`/api/payments/${selected.id}`);
        if (result.payment) {
          setSelected(result.payment);
          if (result.payment.status !== "PENDING") {
            load(pagination.page);
            if (result.payment.status === "SUCCESS") {
              setToast({ type: "success", message: `Payment ${result.payment.reference} confirmed!` });
            }
          }
        }
      } catch {
        // Continue silently on transient poll errors
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.status, pagination.page]);

  async function openPayment(id) {
    try {
      const result = await apiRequest(`/api/payments/${id}`);
      setSelected(result.payment);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createPayment(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest("/api/payments", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ amount: Number(form.amount), phoneNumber: form.phoneNumber, description: form.description || undefined })
      });
      setModal(false);
      const initialPayment = {
        id: result.paymentId,
        reference: result.accountReference,
        amount: Number(form.amount),
        phone_number: form.phoneNumber,
        description: form.description,
        status: result.status,
        created_at: new Date().toISOString(),
        transactions: [{ id: result.transactionId, status: result.status, checkoutRequestId: result.daraja?.CheckoutRequestID }]
      };
      setForm({ amount: "", phoneNumber: "", description: "" });
      setSelected(initialPayment);
      setToast({ type: "info", message: `STK push sent to ${initialPayment.phone_number}` });
      await load(1);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1800);
      setToast({ type: "success", message: "Copied to clipboard" });
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  async function exportCsv() {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    try {
      await downloadReport(`/api/analytics/reports/transactions?from=${from}&to=${to}&format=csv`, `payments-${from}-to-${to}.csv`);
      setToast({ type: "success", message: "Transactions exported successfully" });
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className="page-stack">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <PageHeading
        eyebrow="PAYMENT MANAGEMENT"
        title="Payments"
        description="Create M-Pesa requests and follow every payment attempt in real-time."
        actions={
          <>
            <button className="button button-subtle" type="button" onClick={exportCsv}>
              <ArrowDownToLine size={15} /> Export CSV
            </button>
            <button className="button button-primary" type="button" onClick={() => setModal(true)}>
              <Plus size={16} /> New payment
            </button>
          </>
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
            <button type="button" aria-label="Search payments" onClick={() => load(1)}>Search</button>
          </div>
          <label className="filter-label">
            Status{" "}
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {["PENDING", "SUCCESS", "FAILED", "CANCELLED", "TIMEOUT"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <SkeletonTable rows={6} cols={6} />
        ) : error && !payments.length ? (
          <ErrorState message={error} onRetry={() => load(1)} />
        ) : payments.length ? (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Description</th>
                    <th>Customer phone</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} onClick={() => openPayment(payment.id)} className="clickable-row">
                      <td><span className="table-primary">{payment.reference}</span></td>
                      <td>{payment.description || "—"}</td>
                      <td>{payment.phone_number}</td>
                      <td className="amount-cell">{formatKes(payment.amount)}</td>
                      <td><StatusBadge status={payment.status} pulse={payment.status === "PENDING"} /></td>
                      <td>{formatDate(payment.created_at)}</td>
                      <td>
                        <button className="row-action" type="button" onClick={(event) => { event.stopPropagation(); openPayment(payment.id); }}>
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>{pagination.total} payment{pagination.total === 1 ? "" : "s"}</span>
              <div>
                <button className="icon-button" type="button" disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)} aria-label="Previous page">
                  <ChevronLeft size={16} />
                </button>
                <span>Page {pagination.page} of {Math.max(1, pagination.pages)}</span>
                <button className="icon-button" type="button" disabled={pagination.page >= pagination.pages} onClick={() => load(pagination.page + 1)} aria-label="Next page">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="No matching payments"
            description="Adjust the filters or create a new payment request."
            action={
              <button className="button button-secondary" type="button" onClick={() => { setStatus(""); setSearch(""); }}>
                Clear filters
              </button>
            }
          />
        )}
      </section>

      {modal && (
        <Modal title="New M-Pesa payment" onClose={() => setModal(false)}>
          <form className="stack-form" onSubmit={createPayment}>
            <div className="form-note">
              The customer will receive an STK prompt immediately. Payment is verified and completed only after Safaricom returns the callback.
            </div>
            <label>
              Amount (KES)
              <input autoFocus type="number" min="1" max="250000" step="1" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0" />
            </label>
            <label>
              Customer phone
              <input required inputMode="numeric" pattern="254[17][0-9]{8}" value={form.phoneNumber} onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })} placeholder="2547XXXXXXXX" />
            </label>
            <label>
              Description <small>Optional</small>
              <input maxLength="500" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Order or invoice memo" />
            </label>
            <div className="modal-actions">
              <button className="button button-subtle" type="button" onClick={() => setModal(false)}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={busy}>
                {busy ? "Sending STK…" : "Send STK prompt"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {selected && (
        <Modal title="Payment details" wide onClose={() => setSelected(null)}>
          {selected.status === "PENDING" && (
            <div className="live-callout callout-pending">
              <LoaderCircle size={16} className="spin" />
              <div>
                <strong>STK push sent to {selected.phone_number}</strong>
                <p>Waiting for customer to enter PIN on their handset. Updating automatically...</p>
              </div>
            </div>
          )}
          {selected.status === "SUCCESS" && (
            <div className="live-callout callout-success">
              <CheckCircle2 size={16} />
              <div>
                <strong>Payment confirmed by Safaricom</strong>
                <p>Funds transferred successfully via M-Pesa.</p>
              </div>
            </div>
          )}
          {["FAILED", "CANCELLED", "TIMEOUT"].includes(selected.status) && (
            <div className="live-callout callout-failed">
              <TriangleAlert size={16} />
              <div>
                <strong>Payment {selected.status.toLowerCase()}</strong>
                <p>The transaction was not completed.</p>
              </div>
            </div>
          )}

          <div className="detail-grid">
            <div className="detail-item">
              <small>Reference</small>
              <div className="copy-field">
                <strong>{selected.reference}</strong>
                <button type="button" className="icon-copy-btn" onClick={() => copyText(selected.reference, "ref")}>
                  {copied === "ref" ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            </div>
            <div className="detail-item">
              <small>Amount</small>
              <strong>{formatKes(selected.amount)}</strong>
            </div>
            <div className="detail-item">
              <small>Status</small>
              <StatusBadge status={selected.status} pulse={selected.status === "PENDING"} />
            </div>
            <div className="detail-item">
              <small>Customer phone</small>
              <strong>{selected.phone_number}</strong>
            </div>
            <div className="detail-item">
              <small>Description</small>
              <strong>{selected.description || "—"}</strong>
            </div>
            <div className="detail-item">
              <small>Payment ID</small>
              <strong className="monospace">{selected.id}</strong>
            </div>
          </div>

          <div className="detail-section-title">Transactions & Callbacks</div>
          {(selected.transactions || []).length ? (
            selected.transactions.map((item) => (
              <div className="transaction-attempt" key={item.id}>
                <span>
                  <StatusBadge status={item.status} />
                  <small>{item.checkoutRequestId || item.checkout_request_id || item.id}</small>
                </span>
                <div className="receipt-tag">
                  {item.mpesaReceiptNumber || item.mpesa_receipt_number ? (
                    <span className="receipt-badge">
                      Receipt: <strong>{item.mpesaReceiptNumber || item.mpesa_receipt_number}</strong>
                    </span>
                  ) : (
                    <span className="receipt-pending">Awaiting callback receipt</span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="muted-copy">No transaction records available.</p>
          )}

          <div className="modal-actions">
            <button className="button button-subtle" type="button" onClick={() => setSelected(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}