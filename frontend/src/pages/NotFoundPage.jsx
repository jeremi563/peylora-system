import { ArrowLeft, Compass } from "lucide-react";
import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="not-found-page">
      <div className="not-found-card">
        <div className="not-found-icon">
          <Compass size={32} />
        </div>
        <span className="eyebrow">404 · PAGE NOT FOUND</span>
        <h2>Page or link does not exist</h2>
        <p>The page, checkout link, or resource you are looking for has moved, expired, or does not exist.</p>
        <div className="not-found-actions">
          <Link className="button button-primary" to="/">
            <ArrowLeft size={16} /> Return to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
