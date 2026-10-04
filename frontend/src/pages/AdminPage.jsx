import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import { apiRequest } from "../api.js";
import { useAuth } from "../state/auth.jsx";
import { EmptyState, ErrorNotice, ErrorState, PageHeading, SkeletonTable, StatusBadge, formatDate } from "../components/ui.jsx";

export default function AdminPage() {
  const { user } = useAuth();
  const [webhooks, setWebhooks] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || user.role !== "ADMIN") return;

    async function load() {
      setLoading(true);
      try {
        const [webhookResult, auditResult] = await Promise.all([
          apiRequest("/api/admin/webhook-events?limit=10"),
          apiRequest("/api/admin/audit-logs?limit=10")
        ]);
        setWebhooks(webhookResult.webhookEvents || []);
        setAuditLogs(auditResult.auditLogs || []);
        setError("");
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user]);

  if (!user || user.role !== "ADMIN") {
    return (
      <div className="page-stack">
        <PageHeading eyebrow="ADMIN" title="Access restricted" description="Administrative controls are protected and only visible to users with the ADMIN role." />
        <section className="surface settings-section">
          <div className="settings-title">
            <div className="metric-icon metric-red"><AlertTriangle size={18} /></div>
            <div>
              <h3>Unauthorized</h3>
              <p>This workspace is not authorized to access the administrative system.</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="ADMIN CONSOLE"
        title="System activity"
        description="Review webhook reliability and audit-level activity for the platform."
      />
      <ErrorNotice message={error} onDismiss={() => setError("")} />

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : (
        <>
          <section className="surface table-surface">
            <div className="table-toolbar">
              <div className="settings-title" style={{ padding: 0, border: 0 }}>
                <div className="metric-icon metric-green"><ShieldCheck size={18} /></div>
                <div>
                  <h3 style={{ margin: 0 }}>Webhook events</h3>
                </div>
              </div>
            </div>
            {webhooks.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Event type</th>
                      <th>Status</th>
                      <th>Attempted</th>
                      <th>Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.map((event) => (
                      <tr key={event.id}>
                        <td className="table-primary">{event.source || "M-Pesa"}</td>
                        <td>{event.event_type || "callback"}</td>
                        <td><StatusBadge status={event.status || "PENDING"} /></td>
                        <td>{event.retry_count ?? 0}</td>
                        <td>{formatDate(event.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No webhook events" description="Platform callback activity will appear here once webhooks are received." />
            )}
          </section>

          <section className="surface table-surface">
            <div className="table-toolbar">
              <div className="settings-title" style={{ padding: 0, border: 0 }}>
                <div className="metric-icon metric-blue"><ShieldCheck size={18} /></div>
                <div>
                  <h3 style={{ margin: 0 }}>Audit logs</h3>
                </div>
              </div>
            </div>
            {auditLogs.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Action</th>
                      <th>Action type</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((entry) => (
                      <tr key={entry.id}>
                        <td className="table-primary">{entry.user_name || entry.user_id || "System"}</td>
                        <td>{entry.action || "Audit event"}</td>
                        <td>{entry.action_type || "system"}</td>
                        <td>{formatDate(entry.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No audit entries" description="Audit log entries will show here when privileged actions are recorded." />
            )}
          </section>
        </>
      )}
    </div>
  );
}
