import { ArrowRight, BookOpenText, FileCode2, KeyRound, TerminalSquare, Webhook } from "lucide-react";

import { apiBaseUrl } from "../api.js";

const docSections = [
  {
    title: "Overview",
    summary: "Use the payment platform to create merchant workflows, collect M-Pesa payments, and reconcile transaction lifecycle events.",
    list: ["Merchant authentication", "Payment requests", "Invoice and link management", "Webhooks and callback processing"]
  },
  {
    title: "Authentication",
    summary: "Login to obtain an access token and use that token across protected endpoints.",
    list: ["POST /api/auth/login", "POST /api/auth/refresh", "POST /api/auth/logout", "POST /api/auth/password/forgot"]
  },
  {
    title: "Payments",
    summary: "Create a payment request, track current status, and review each transaction as the callback lifecycle updates.",
    list: ["POST /api/payments", "GET /api/payments", "GET /api/payments/:paymentId", "GET /api/transactions/:transactionId"]
  },
  {
    title: "Webhooks and callbacks",
    summary: "The business logic receives Daraja callbacks, validates payloads, and updates payment records asynchronously.",
    list: ["POST /api/mpesa/callback", "GET /api/admin/webhook-events", "GET /api/admin/audit-logs"]
  }
];

export default function DeveloperPage() {
  const swaggerUrl = `${apiBaseUrl()}/api/docs`;

  return (
    <div className="developer-shell">
      <aside className="developer-sidebar">
        <div className="developer-brand">
          <span className="brand-mark landing-mark"><span /></span>
          <div>
            <strong>peyflow</strong>
            <small>DEVELOPER PORTAL</small>
          </div>
        </div>
        <nav className="developer-nav" aria-label="Developer documentation nav">
          <a href="#overview">Overview</a>
          <a href="#auth">Authentication</a>
          <a href="#payments">Payments</a>
          <a href="#webhooks">Webhooks</a>
        </nav>
        <a className="button button-primary docs-button" href={swaggerUrl} target="_blank" rel="noreferrer">
          Open Swagger
          <ArrowRight size={16} />
        </a>
      </aside>

      <main className="developer-content">
        <header className="developer-header">
          <div>
            <span className="eyebrow">DEVELOPER RESOURCES</span>
            <h1>Documentation for the payment platform.</h1>
          </div>
          <a className="button button-subtle" href={swaggerUrl} target="_blank" rel="noreferrer">Swagger / OpenAPI</a>
        </header>

        <section className="developer-intro">
          <div className="intro-card">
            <BookOpenText size={18} />
            <div>
              <strong>Build on a secure, documented API</strong>
              <p>Connect merchant services to the existing backend through the protected REST endpoints and M-Pesa callback flow.</p>
            </div>
          </div>
        </section>

        <div className="developer-grid">
          {docSections.map(({ title, summary, list }, index) => (
            <article key={title} className="developer-card" id={index === 0 ? "overview" : title.toLowerCase().replace(/\s+/g, "-") }>
              <div className="card-topline">
                {index === 0 && <FileCode2 size={17} />}
                {index === 1 && <KeyRound size={17} />}
                {index === 2 && <TerminalSquare size={17} />}
                {index === 3 && <Webhook size={17} />}
                <span>{title}</span>
              </div>
              <p>{summary}</p>
              <ul>
                {list.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
