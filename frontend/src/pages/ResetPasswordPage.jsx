import { ArrowRight, CheckCircle2, LockKeyhole } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { apiRequest } from "../api.js";
import { ErrorNotice, SuccessNotice } from "../components/ui.jsx";

export default function ResetPasswordPage() {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [token, setToken] = useState(searchParams.get("token") || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (password.length < 12) {
      setError("Password must be at least 12 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await apiRequest("/api/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ token, password })
      }, false);
      setSuccess("Your password has been reset successfully. You can now sign in.");
      setPassword("");
      setConfirmPassword("");
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
          <span className="eyebrow">NEW PASSWORD</span>
          <h2>Create a new password</h2>
          <p className="auth-subtitle">Choose a secure password for your merchant account.</p>
          <ErrorNotice message={error} />
          <SuccessNotice message={success} />
          <form className="auth-form" onSubmit={submit}>
            <label>Reset token
              <span className="input-wrap">
                <CheckCircle2 size={17} />
                <input type="text" required value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste your reset token" />
              </span>
            </label>
            <label>New password
              <span className="input-wrap">
                <LockKeyhole size={17} />
                <input type="password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" />
              </span>
            </label>
            <label>Confirm password
              <span className="input-wrap">
                <LockKeyhole size={17} />
                <input type="password" required minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat your password" />
              </span>
            </label>
            <button className="button button-primary auth-submit" type="submit" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="auth-switch">
            <Link to="/login">Return to sign in</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
