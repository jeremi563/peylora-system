import { ArrowRight, CheckCircle2, LockKeyhole, Mail, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiRequest } from "../api.js";
import { ErrorNotice, SuccessNotice } from "../components/ui.jsx";
import { useAuth } from "../state/auth.jsx";

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const { applyLogin } = useAuth();
  const initialEmail = useMemo(() => new URLSearchParams(window.location.search).get("email") || "", []);
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const session = await apiRequest("/api/auth/email/complete-verification", {
        method: "POST",
        body: JSON.stringify({ email, otp, password })
      }, false);
      applyLogin(session);
      navigate("/", { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError("");
    setSuccess("");
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }

    setResending(true);
    try {
      await apiRequest("/api/auth/email/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email })
      }, false);
      setSuccess("A new verification code has been sent.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="auth-page single-column-auth">
      <main className="auth-main slim-auth-main">
        <div className="auth-form-wrap compact-auth">
          <span className="eyebrow">ACCOUNT ACTIVATION</span>
          <h2>Verify your email</h2>
          <p className="auth-subtitle">Enter the six-digit code we sent you, then choose a password for your workspace.</p>
          <ErrorNotice message={error} />
          <SuccessNotice message={success} />
          <form className="auth-form" onSubmit={submit}>
            <label>Email address
              <span className="input-wrap"><Mail size={17} /><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@business.com" /></span>
            </label>
            <label>Verification code
              <span className="input-wrap"><CheckCircle2 size={17} /><input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></span>
            </label>
            <label>Create password
              <span className="input-wrap"><LockKeyhole size={17} /><input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /></span>
            </label>
            <label>Confirm password
              <span className="input-wrap"><LockKeyhole size={17} /><input type="password" autoComplete="new-password" required minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat your password" /></span>
            </label>
            <button className="button button-primary auth-submit" disabled={busy} type="submit">
              {busy ? "Activating…" : "Verify and enter workspace"}<ArrowRight size={17} />
            </button>
          </form>
          <button className="text-button" type="button" disabled={resending} onClick={resend}>
            <RefreshCw size={13} /> {resending ? "Sending…" : "Resend verification code"}
          </button>
          <div className="auth-switch"><Link to="/login">Return to sign in</Link></div>
        </div>
      </main>
    </div>
  );
}
