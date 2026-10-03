import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, FilePlus2, Link2, Plus, Printer, Search } from "lucide-react";

import { apiRequest } from "../api.js";
import { EmptyState, ErrorNotice, ErrorState, formatDate, formatKes, Modal, PageHeading, SkeletonTable, StatusBadge, Toast } from "../components/ui.jsx";

const freshItem = () => ({ description: "", quantity: 1, unitAmount: "" });

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, pages: 0 });
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ invoiceNumber: "", customerName: "", phoneNumber: "", email: "", dueAt: "", items: [freshItem()] });

  async function load(page = 1) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (status) params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const result = await apiRequest(`/api/invoices?${params}`);
      setInvoices(result.invoices || []);
      setPagination(result.pagination);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1); }, [status]);

  async function openInvoice(id) {
    try {
      const result = await apiRequest(`/api/invoices/${id}`);
      setSelected(result.invoice);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function updateItem(index, field, value) {
    setForm((previous) => ({
      ...previous,
      items: previous.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)
    }));
  }

  async function createInvoice(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest("/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          ...(form.invoiceNumber ? { invoiceNumber: form.invoiceNumber } : {}),
          customer: { name: form.customerName, phoneNumber: form.phoneNumber, ...(form.email ? { email: form.email } : {}) },
          items: form.items.map((item) => ({ description: item.description, quantity: Number(item.quantity), unitAmount: Number(item.unitAmount) })),
          ...(form.dueAt ? { dueAt: new Date(`${form.dueAt}T23:59:00`).toISOString() } : {})
        })
      });
      setCreating(false);
      setForm({ invoiceNumber: "", customerName: "", phoneNumber: "", email: "", dueAt: "", items: [freshItem()] });
      setToast({ type: "success", message: `Invoice ${result.invoice.invoice_number} created successfully` });
      await load(1);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function makePaymentLink(invoice) {
    setBusy(true);
    try {
      const result = await apiRequest(`/api/invoices/${invoice.id}/payment-link`, { method: "POST" });
      const url = `${window.location.origin}/pay/${result.paymentLink.reference}`;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
      setToast({ type: "success", message: `Invoice payment link created and copied to clipboard!` });
      if (selected) await openInvoice(invoice.id);
      await load(pagination.page);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function setInvoiceStatus(invoiceId, nextStatus) {
    try {
      await apiRequest(`/api/invoices/${invoiceId}/status`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
      await openInvoice(invoiceId);
      await load(pagination.page);
      setToast({ type: "info", message: `Invoice status updated to ${nextStatus}` });
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function handlePrintInvoice() {
    window.print();
  }

  const total = form.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitAmount) || 0), 0);

  return (
    <div className="page-stack">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <PageHeading
        eyebrow="BILLING & INVOICING"
        title="Invoices"
        description="Build itemized invoices and turn them into trackable M-Pesa payment links."
        actions={
          <button className="button button-primary" type="button" onClick={() => setCreating(true)}>
            <FilePlus2 size={16} /> Create invoice
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
              placeholder="Search invoice, customer or phone"
            />
            <button type="button" onClick={() => load(1)}>Search</button>
          </div>
          <label className="filter-label">
            Status{" "}
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {["DRAFT", "SENT", "PENDING", "PAID", "OVERDUE", "CANCELLED"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <SkeletonTable rows={6} cols={6} />
        ) : error && !invoices.length ? (
          <ErrorState message={error} onRetry={() => load(1)} />
        ) : invoices.length ? (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Due date</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="clickable-row" onClick={() => openInvoice(invoice.id)}>
                      <td><span className="table-primary">{invoice.invoice_number}</span></td>
                      <td>
                        <span>{invoice.customer_name || "—"}</span>
                        <small className="table-secondary">{invoice.customer_phone}</small>
                      </td>
                      <td>{formatDate(invoice.due_at)}</td>
                      <td className="amount-cell">{formatKes(invoice.total_amount)}</td>
                      <td><StatusBadge status={invoice.status} /></td>
                      <td>{formatDate(invoice.created_at)}</td>
                      <td>
                        <button className="row-action" type="button" onClick={(event) => { event.stopPropagation(); makePaymentLink(invoice); }}>
                          <Link2 size={14} /> Link
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>{pagination.total} invoice{pagination.total === 1 ? "" : "s"}</span>
              <div>
                <button className="icon-button" type="button" disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)} aria-label="Previous">
                  <ChevronLeft size={16} />
                </button>
                <span>Page {pagination.page} of {Math.max(1, pagination.pages)}</span>
                <button className="icon-button" type="button" disabled={pagination.page >= pagination.pages} onClick={() => load(pagination.page + 1)} aria-label="Next">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="No invoices yet"
            description="Create an invoice with line items and a customer to start."
            action={
              <button className="button button-secondary" type="button" onClick={() => setCreating(true)}>
                Create first invoice
              </button>
            }
          />
        )}
      </section>

      {creating && (
        <Modal title="Create invoice" wide onClose={() => setCreating(false)}>
          <form className="stack-form invoice-form" onSubmit={createInvoice}>
            <div className="form-grid">
              <label>
                Invoice number <small>Optional</small>
                <input value={form.invoiceNumber} onChange={(event) => setForm({ ...form, invoiceNumber: event.target.value })} placeholder="Generated automatically" />
              </label>
              <label>
                Due date <small>Optional</small>
                <input type="date" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} />
              </label>
            </div>
            <div className="form-section-heading"><span>Customer</span></div>
            <div className="form-grid">
              <label>
                Name
                <input required value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} />
              </label>
              <label>
                Phone
                <input required pattern="254[17][0-9]{8}" value={form.phoneNumber} onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })} placeholder="2547XXXXXXXX" />
              </label>
              <label>
                Email <small>Optional</small>
                <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              </label>
            </div>
            <div className="form-section-heading">
              <span>Line items</span>
              <button className="text-button" type="button" onClick={() => setForm({ ...form, items: [...form.items, freshItem()] })}>
                <Plus size={14} /> Add item
              </button>
            </div>
            <div className="invoice-item-head">
              <span>Description</span>
              <span>Qty</span>
              <span>Unit amount</span>
              <span />
            </div>
            {form.items.map((item, index) => (
              <div className="invoice-item-row" key={index}>
                <input required value={item.description} onChange={(event) => updateItem(index, "description", event.target.value)} placeholder="Service or product" />
                <input required type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} />
                <input required type="number" min="0" step="0.01" value={item.unitAmount} onChange={(event) => updateItem(index, "unitAmount", event.target.value)} placeholder="0.00" />
                <button className="icon-button remove-item" disabled={form.items.length === 1} type="button" aria-label="Remove item" onClick={() => setForm({ ...form, items: form.items.filter((_, itemIndex) => itemIndex !== index) })}>
                  ×
                </button>
              </div>
            ))}
            <div className="invoice-total">
              <span>Calculated total</span>
              <strong>{formatKes(total)}</strong>
              <small>Final total must be whole KES for M-Pesa STK.</small>
            </div>
            <div className="modal-actions">
              <button className="button button-subtle" type="button" onClick={() => setCreating(false)}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create invoice"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {selected && (
        <Modal title={`Invoice ${selected.invoice_number}`} wide onClose={() => setSelected(null)}>
          <div className="invoice-print-area">
            <div className="invoice-detail-head">
              <div>
                <span className="eyebrow">CUSTOMER</span>
                <strong>{selected.customer?.name}</strong>
                <small>{selected.customer?.phoneNumber} · {selected.customer?.email || "No email"}</small>
              </div>
              <div>
                <span className="eyebrow">TOTAL DUE</span>
                <strong className="invoice-detail-total">{formatKes(selected.total_amount)}</strong>
                <StatusBadge status={selected.status} />
              </div>
            </div>
            <div className="detail-section-title">Items</div>
            <div className="invoice-detail-items">
              {selected.items?.map((item) => (
                <div key={item.id}>
                  <span>{item.description}<small>{item.quantity} × {formatKes(item.unitAmount)}</small></span>
                  <strong>{formatKes(item.lineTotal)}</strong>
                </div>
              ))}
            </div>
            <div className="detail-section-title">Payment activity</div>
            {selected.payments?.length ? (
              selected.payments.map((payment) => (
                <div className="transaction-attempt" key={payment.id}>
                  <span>
                    <StatusBadge status={payment.status} />
                    <small>{payment.reference}</small>
                  </span>
                  <strong>{formatKes(payment.amount)}</strong>
                </div>
              ))
            ) : (
              <p className="muted-copy">No payment attempts recorded.</p>
            )}
          </div>

          <div className="modal-actions modal-actions-spread">
            <div className="modal-left-actions">
              <button className="button button-subtle" type="button" onClick={handlePrintInvoice}>
                <Printer size={15} /> Print / Save
              </button>
              {["DRAFT", "OVERDUE"].includes(selected.status) && (
                <button className="button button-subtle" type="button" onClick={() => setInvoiceStatus(selected.id, "SENT")}>
                  Mark sent
                </button>
              )}
              {["DRAFT", "SENT", "OVERDUE"].includes(selected.status) && (
                <button className="button button-danger-subtle" type="button" onClick={() => setInvoiceStatus(selected.id, "CANCELLED")}>
                  Cancel invoice
                </button>
              )}
            </div>
            <button
              className="button button-primary"
              type="button"
              disabled={busy || ["PAID", "CANCELLED"].includes(selected.status)}
              onClick={() => makePaymentLink(selected)}
            >
              <Link2 size={15} /> Create payment link
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}