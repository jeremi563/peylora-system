import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Plus, Power } from "lucide-react";

import { apiRequest } from "../api.js";
import { EmptyState, ErrorNotice, ErrorState, formatDate, formatKes, Modal, PageHeading, SkeletonTable, StatusBadge, Toast } from "../components/ui.jsx";

export default function LinksPage() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ description: "", amount: "", expiresAt: "" });

  async function load() {
    setLoading(true);
    try {
      const result = await apiRequest("/api/payment-links");
      setLinks(result.paymentLinks || []);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createLink(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await apiRequest("/api/payment-links", {
        method: "POST",
        body: JSON.stringify({
          description: form.description,
          amount: Number(form.amount),
          ...(form.expiresAt ? { expiresAt: new Date(`${form.expiresAt}T23:59:00`).toISOString() } : {})
        })
      });
      setModal(false);
      setForm({ description: "", amount: "", expiresAt: "" });
      setToast({ type: "success", message: "Payment link created and copied!" });
      await load();
      await copyLink(result.paymentLink.reference);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(reference) {
    const url = `${window.location.origin}/pay/${reference}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(reference);
      window.setTimeout(() => setCopied(""), 1800);
      setToast({ type: "success", message: `Link copied: /pay/${reference}` });
    } catch {
      setError("Could not access clipboard. Open the link preview directly.");
    }
  }

  async function deactivate(link) {
    try {
      await apiRequest(`/api/payment-links/${link.id}`, { method: "DELETE" });
      setToast({ type: "info", message: "Payment link deactivated" });
      await load();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className="page-stack">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <PageHeading
        eyebrow="CUSTOMER CHECKOUT"
        title="Payment links"
        description="Share a fixed-amount checkout with a customer. No account required on their side."
        actions={
          <button className="button button-primary" type="button" onClick={() => setModal(true)}>
            <Plus size={16} /> Create link
          </button>
        }
      />
      <ErrorNotice message={error} onDismiss={() => setError("")} />
      <section className="surface table-surface">
        {loading ? (
          <SkeletonTable rows={5} cols={7} />
        ) : error && !links.length ? (
          <ErrorState message={error} onRetry={load} />
        ) : links.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Reference</th>
                  <th>Amount</th>
                  <th>Payments</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {links.map((link) => (
                  <tr key={link.id}>
                    <td>
                      <span className="table-primary">{link.description}</span>
                      <small className="table-secondary">Created {formatDate(link.created_at)}</small>
                    </td>
                    <td className="monospace">{link.reference.slice(0, 14)}…</td>
                    <td className="amount-cell">{formatKes(link.amount)}</td>
                    <td>
                      {link.payment_count ?? 0}
                      <small className="table-secondary">{link.successful_payment_count ?? 0} successful</small>
                    </td>
                    <td><StatusBadge status={link.status} /></td>
                    <td>{formatDate(link.expires_at)}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => copyLink(link.reference)}
                          title="Copy customer link"
                          aria-label="Copy customer link"
                        >
                          {copied === link.reference ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                        <a
                          className="icon-button"
                          href={`/pay/${link.reference}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open customer page"
                          aria-label="Open customer page"
                        >
                          <ExternalLink size={16} />
                        </a>
                        {link.status === "ACTIVE" && (
                          <button
                            className="icon-button danger-icon"
                            type="button"
                            onClick={() => deactivate(link)}
                            title="Deactivate link"
                            aria-label="Deactivate link"
                          >
                            <Power size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No payment links"
            description="Create a shareable checkout with a fixed amount and description."
            action={
              <button className="button button-secondary" type="button" onClick={() => setModal(true)}>
                <Link2 size={15} /> Create first link
              </button>
            }
          />
        )}
      </section>

      {modal && (
        <Modal title="Create payment link" onClose={() => setModal(false)}>
          <form className="stack-form" onSubmit={createLink}>
            <div className="form-note">
              The amount is fixed on the server. Customers enter only their M-Pesa phone number.
            </div>
            <label>
              Description
              <input autoFocus required maxLength="500" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What is this payment for?" />
            </label>
            <label>
              Amount (KES)
              <input required type="number" min="1" max="250000" step="1" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0" />
            </label>
            <label>
              Expiry date <small>Optional</small>
              <input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} />
            </label>
            <div className="modal-actions">
              <button className="button button-subtle" type="button" onClick={() => setModal(false)}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create & copy link"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}