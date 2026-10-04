import { useEffect, useState } from "react";
import { Bell, CheckCheck, Eye, Search } from "lucide-react";

import { apiRequest } from "../api.js";
import {
  EmptyState,
  ErrorNotice,
  ErrorState,
  PageHeading,
  SkeletonTable,
  StatusBadge,
  formatDate
} from "../components/ui.jsx";

export default function NotificationsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await apiRequest("/api/notifications?limit=25&unreadOnly=false");
      setItems(result.notifications || []);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function markRead(id) {
    try {
      await apiRequest(`/api/notifications/${id}/read`, { method: "PATCH" });
      await load();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function markAllRead() {
    setBusy(true);
    try {
      await apiRequest("/api/notifications/read-all", { method: "PATCH" });
      await load();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="COMMUNICATION"
        title="Notifications"
        description="Track payment lifecycle updates, verification messages, and workflow alerts across your merchant workspace."
        actions={
          <button className="button button-primary" type="button" disabled={busy || !items.some((item) => !item.read_at)} onClick={markAllRead}>
            <CheckCheck size={15} /> {busy ? "Updating…" : "Mark all read"}
          </button>
        }
      />
      <ErrorNotice message={error} onDismiss={() => setError("")} />
      <section className="surface table-surface">
        {loading ? (
          <SkeletonTable rows={6} cols={4} />
        ) : error && !items.length ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length ? (
          <div className="notification-list-panel">
            {items.map((item) => (
              <article key={item.id} className={`notification-item ${item.read_at ? "is-read" : "is-unread"}`}>
                <div className="notification-item-icon"><Bell size={16} /></div>
                <div className="notification-item-copy">
                  <div className="notification-item-header">
                    <strong>{item.payload?.title || item.type || "Account update"}</strong>
                    {!item.read_at && <StatusBadge status="PENDING" />}
                  </div>
                  <p>{item.payload?.message || item.payload?.reference || "No additional message was provided."}</p>
                  <div className="notification-item-meta">
                    <span>{item.payload?.status || item.type || "SYSTEM"}</span>
                    <span>{formatDate(item.created_at)}</span>
                  </div>
                </div>
                {!item.read_at && (
                  <button className="button button-subtle" type="button" onClick={() => markRead(item.id)}>
                    <Eye size={14} /> Mark read
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No alerts yet"
            description="Critical payment and account updates will appear here when they are published."
            action={<button className="button button-secondary" type="button" onClick={load}><Search size={15} /> Refresh</button>}
          />
        )}
      </section>
    </div>
  );
}
