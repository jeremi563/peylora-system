import { BadgeCheck, CreditCard, Layers3 } from "lucide-react";

import { PageHeading } from "../components/ui.jsx";

const featureCards = [
  { title: "Merchant access", description: "Create and manage payment requests, invoices, and payment links from the merchant workspace." },
  { title: "Payment visibility", description: "Review real-time payment outcomes, transaction history, and callback-confirmed revenue data." },
  { title: "Developer tooling", description: "Use the authenticated API and Swagger UI to build integrations against the live backend." }
];

export default function SubscriptionPage() {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="WORKSPACE STATUS"
        title="Subscription"
        description="The current backend does not expose billing or subscription metadata for merchants, so this view shows the active product access available in the workspace."
      />

      <section className="surface settings-section">
        <div className="settings-title">
          <div className="metric-icon metric-green"><BadgeCheck size={18} /></div>
          <div>
            <h3>Current access</h3>
            <p>No subscription plan data is exposed by the backend API at the moment.</p>
          </div>
        </div>
        <div className="settings-fields">
          <div>
            <span>Plan visibility</span>
            <strong>Unavailable in current API</strong>
          </div>
          <div>
            <span>Billing status</span>
            <strong>Not exposed by backend</strong>
          </div>
        </div>
      </section>

      <section className="surface settings-section">
        <div className="settings-title">
          <div className="metric-icon metric-blue"><Layers3 size={18} /></div>
          <div>
            <h3>Available workspace features</h3>
            <p>These are the live capabilities currently supported by the payment platform.</p>
          </div>
        </div>
        <div className="subscription-grid">
          {featureCards.map((card) => (
            <article key={card.title} className="subscription-card">
              <div className="metric-icon metric-green"><CreditCard size={17} /></div>
              <strong>{card.title}</strong>
              <p>{card.description}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
