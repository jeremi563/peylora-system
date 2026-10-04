import { ArrowLeft, ArrowRight, Mail } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { apiRequest } from "../api.js";
import { ErrorNotice, SuccessNotice } from "../components/ui.jsx";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await apiRequest("/api/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email })
      }, false);
      setSuccess("If the account exists, a password reset link has been sent to your email.");
      setEmail("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page single-column-auth">
      <main className="auth-main slim-auth-main">
        <div className="auth-form-wrap compact-auth">
          <span className="eyebrow">PASSWORD RECOVERY</span>
          <h2>Reset your password</h2>
          <p className="auth-subtitle">Enter the email tied to your merchant account and we’ll send a secure reset link.</p>
          <ErrorNotice message={error} />
          <SuccessNotice message={success} />
          <form className="auth-form" onSubmit={submit}>
            <label>Email address
              <span className="input-wrap">
                <Mail size={17} />
                <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@business.com" />
              </span>
            </label>
            <button className="button button-primary auth-submit" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="auth-switch">
            <Link to="/login"><ArrowLeft size={14} /> Back to sign in</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
