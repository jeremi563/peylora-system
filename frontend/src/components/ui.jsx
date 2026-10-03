import { AlertCircle, CheckCircle2, LoaderCircle, RotateCw, X, Info } from "lucide-react";

export function PageHeading({ eyebrow, title, description, actions }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ status, pulse = false }) {
  const normalized = (status || "UNKNOWN").toUpperCase();
  const isPending = normalized === "PENDING";
  return (
    <span className={`status-badge status-${normalized.toLowerCase()} ${pulse && isPending ? "status-pulse" : ""}`}>
      {isPending && pulse ? <LoaderCircle size={10} className="spin" /> : <i />}
      {normalized}
    </span>
  );
}

export function LoadingState({ label = "Loading records" }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <LoaderCircle size={20} className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 6 }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      <div className="skeleton-row skeleton-header">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="skeleton-cell skeleton-pulse" style={{ width: `${60 + (i % 3) * 20}%` }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-row">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton-cell skeleton-pulse" style={{ width: `${40 + ((r + c) % 5) * 12}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-mark">
        {icon || <><i /><i /><i /></>}
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Could not load data", message, onRetry }) {
  return (
    <div className="error-state-card" role="alert">
      <div className="error-state-icon">
        <AlertCircle size={24} />
      </div>
      <h3>{title}</h3>
      <p>{message || "There was an issue communicating with the server. Please check your network and try again."}</p>
      {onRetry && (
        <button className="button button-secondary" type="button" onClick={onRetry}>
          <RotateCw size={14} /> Try again
        </button>
      )}
    </div>
  );
}

export function ErrorNotice({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="notice notice-error" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function SuccessNotice({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="notice notice-success" role="status">
      <CheckCircle2 size={17} />
      <span>{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function Toast({ message, type = "info", onClose }) {
  if (!message) return null;
  return (
    <div className={`app-toast toast-${type}`} role="alert" aria-live="assertive">
      {type === "success" && <CheckCircle2 size={16} />}
      {type === "error" && <AlertCircle size={16} />}
      {type === "info" && <Info size={16} />}
      <span>{message}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-panel ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <h3>{title}</h3>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function formatKes(value, currency = "KES") {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value || 0));
}

export function formatDate(value, options = {}) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", ...options }).format(new Date(value));
}

export function initials(value = "") {
  return value.split(/[\s@]/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "M";
}