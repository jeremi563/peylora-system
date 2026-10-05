import { ArrowRight, BarChart3, CheckCircle2, CreditCard, FileText, KeyRound, ShieldCheck, Workflow } from "lucide-react";
import { Link } from "react-router-dom";

import { apiBaseUrl } from "../api.js";

const featureCards = [
  {
    icon: CreditCard,
    title: "M-Pesa payments",
    text: "Create payment requests, trigger STK pushes, and track outcomes cleanly from one workspace."
  },
  {
    icon: FileText,
    title: "Invoices and billing",
    text: "Send professional invoice flows with clear status tracking and invoice-to-payment linking."
  },
  {
    icon: BarChart3,
    title: "Revenue analytics",
    text: "Review successful payments, review payout trends, and monitor payment health with actionable reporting."
  }
];

const processSteps = [
  { label: "1", title: "Create the request", text: "Define the amount, customer, and reference details in the merchant workspace." },
  { label: "2", title: "Collect securely", text: "Send the M-Pesa prompt and keep the customer in a clear, guided payment flow." },
  { label: "3", title: "Track and reconcile", text: "Review status updates, reconcile outcomes, and export transaction activity when needed." }
];

const docLinks = [
  { title: "Getting started", copy: "Configure your merchant workspace and begin collecting payments securely." },
  { title: "Authentication", copy: "Manage login, refresh tokens, password recovery, and verification flows." },
  { title: "Payments API", copy: "Create payment requests, track status, and review STK callback outcomes." },
  { title: "Webhooks", copy: "Handle callback processing and transaction lifecycle updates with confidence." }
];

export default function LandingPage() {
  const docsUrl = `${apiBaseUrl()}/api/docs`;

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <div className="landing-brand" aria-label="peyflow merchant workspace">
          <span className="brand-mark landing-mark"><span /></span>
          <span><strong>peyflow</strong><small>MERCHANT WORKSPACE</small></span>
        </div>
        <nav className="landing-nav" aria-label="Primary navigation">
          <a href="#platform">Platform</a>
          <a href="#features">Features</a>
          <a href="#process">How it works</a>
          <a href="#developers">Developers</a>
        </nav>
        <div className="landing-actions">
          <a className="button button-subtle" href={docsUrl} target="_blank" rel="noreferrer">API docs</a>
          <Link className="button button-primary" to="/login">Log in</Link>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-copy">
            <span className="eyebrow landing-eyebrow">PAYMENT MANAGEMENT FOR MODERN BUSINESSES</span>
            <h1>Collect, track, and reconcile M-Pesa payments with clarity.</h1>
            <p>
              Peyflow brings M-Pesa collections, payment links, invoices, and transaction reporting into one workspace,
              helping your team follow each payment from request through reconciliation.
            </p>
            <div className="landing-cta-row">
              <Link className="button button-primary" to="/register">Create account</Link>
              <a className="button button-subtle" href={docsUrl} target="_blank" rel="noreferrer">View API reference</a>
            </div>
            <ul className="trust-list" aria-label="Key product capabilities">
              <li><CheckCircle2 size={16} /> Payment links</li>
              <li><CheckCircle2 size={16} /> Invoice workflows</li>
              <li><CheckCircle2 size={16} /> Analytics and reporting</li>
            </ul>
          </div>
          <div className="hero-panel" aria-label="Platform overview panel">
            <div className="hero-panel-top">
              <span className="status-pill success">System online</span>
              <span className="status-pill muted">Sandbox</span>
            </div>
            <div className="hero-feature-list">
              <div className="feature-brief">
                <strong>Secure collection</strong>
                <small>STK push requests, payment links, and transaction tracking in one workflow.</small>
              </div>
              <div className="feature-brief">
                <strong>Operational clarity</strong>
                <small>Real-time payment status updates with cleaner reconciliation for your team.</small>
              </div>
              <div className="feature-brief">
                <strong>Developer access</strong>
                <small>Documented APIs and webhook flow to connect your business systems with confidence.</small>
              </div>
            </div>
          </div>
        </section>

        <section className="feature-section" id="features">
          <div className="section-heading">
            <span className="eyebrow">PLATFORM</span>
            <h2>Everything a growing merchant needs.</h2>
          </div>
          <div className="feature-grid">
            {featureCards.map(({ icon: Icon, title, text }) => (
              <article key={title} className="info-card">
                <div className="info-icon"><Icon size={19} /></div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="process-section" id="process">
          <div className="section-heading narrow">
            <span className="eyebrow">WORKFLOW</span>
            <h2>Simple payment operations, clear status.</h2>
          </div>
          <div className="process-grid">
            {processSteps.map(({ label, title, text }) => (
              <article key={label} className="step-card">
                <span className="step-number">{label}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="developer-section" id="developers">
          <div className="section-heading">
            <span className="eyebrow">DEVELOPER EXPERIENCE</span>
            <h2>Documentation built for technical teams.</h2>
          </div>
          <div className="doc-grid">
            {docLinks.map(({ title, copy }) => (
              <article key={title} className="doc-card">
                <div className="doc-card-header">
                  <Workflow size={18} />
                  <strong>{title}</strong>
                </div>
                <p>{copy}</p>
                <a href={docsUrl} target="_blank" rel="noreferrer">Open docs <ArrowRight size={15} /></a>
              </article>
            ))}
          </div>
        </section>

        <section className="security-section" id="platform">
          <div className="security-panel">
            <div className="section-heading narrow left-align">
              <span className="eyebrow">SECURITY</span>
              <h2>Built around the requirements of regulated fintech workflows.</h2>
            </div>
            <div className="security-list">
              <div className="security-item"><ShieldCheck size={18} /><div><strong>Protected access</strong><small>JWT-based merchant authentication and request validation.</small></div></div>
              <div className="security-item"><KeyRound size={18} /><div><strong>Secure configuration</strong><small>Credentials remain on the backend and are never exposed in the browser.</small></div></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-brand footer-brand">
          <span className="brand-mark landing-mark"><span /></span>
          <span><strong>peyflow</strong><small>MERCHANT WORKSPACE</small></span>
        </div>
        <span>Payment management software for modern merchants.</span>
      </footer>
    </div>
  );
}
