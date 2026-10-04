import { ArrowRight, BookText, Code } from "lucide-react";

import { apiBaseUrl } from "../api.js";
import { PageHeading } from "../components/ui.jsx";

export default function SwaggerPage() {
  const swaggerUrl = `${apiBaseUrl()}/api/docs`;
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="API DOCUMENTATION"
        title="peyflow API reference"
        description="This project serves the live backend specification directly from the API layer. Use the Swagger UI to inspect the real endpoints, callback payloads, and payment lifecycle flows."
        actions={
          <a className="button button-primary" href={swaggerUrl} target="_blank" rel="noreferrer">
            Open live docs <ArrowRight size={15} />
          </a>
        }
      />

      <section className="surface settings-section">
        <div className="settings-title">
          <div className="metric-icon metric-green"><BookText size={18} /></div>
          <div>
            <h3>Developer access</h3>
            <p>The backend exposes the OpenAPI definition at the route below.</p>
          </div>
        </div>
        <div className="swagger-box">
          <div className="swagger-route"><Code size={15} /> {swaggerUrl}</div>
          <p>Use this documentation for request formats, auth headers, callback payloads, and M-Pesa payment flows. Authentication remains handled by the backend and should never be embedded in the frontend.</p>
        </div>
      </section>
    </div>
  );
}
