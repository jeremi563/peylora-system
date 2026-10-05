import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Store, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { apiRequest } from "../api.js";
import { useAuth } from "../state/auth.jsx";
import { ErrorNotice, SuccessNotice } from "../components/ui.jsx";

export default function AuthPage({ mode }) {
  const isRegister = mode === "register";
  const navigate = useNavigate();
  const { applyLogin } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [redirectTimer, setRedirectTimer] = useState(null);
  const [form, setForm] = useState({ name: "", businessName: "", email: "", password: "", phoneNumber: "" });

  useEffect(() => {
    return () => {
      if (redirectTimer) {
        clearTimeout(redirectTimer);
      }
    };
  }, [redirectTimer]);

  function change(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (redirectTimer) {
      clearTimeout(redirectTimer);
      setRedirectTimer(null);
    }

    let registrationPhone = "";
    if (isRegister && form.phoneNumber.trim()) {
      const enteredPhone = form.phoneNumber.replace(/\s+/g, "");
      registrationPhone = /^07\d{8}$/.test(enteredPhone)
        ? `254${enteredPhone.slice(1)}`
        : enteredPhone;

      if (!/^254[17]\d{8}$/.test(registrationPhone)) {
        setError("Enter a valid M-Pesa number starting with 254. Numbers starting with 07 are converted automatically.");
        return;
      }

      if (registrationPhone !== enteredPhone) {
        setForm((previous) => ({ ...previous, phoneNumber: registrationPhone }));
      }
    }

    setBusy(true);
    try {
      if (isRegister) {
        await apiRequest("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            businessName: form.businessName || form.name,
            email: form.email,
            password: form.password,
            ...(registrationPhone ? { phoneNumber: registrationPhone } : {})
          })
        });

        const timer = setTimeout(() => {
          navigate("/login", { replace: true });
        }, 3000);

        setRedirectTimer(timer);
        setSuccess("Account created. A verification email has been sent. Redirecting to sign in...");
      } else {
        const session = await apiRequest("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: form.email, password: form.password })
        });
        applyLogin(session);
        navigate("/", { replace: true });
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="brand-lockup auth-brand"><span className="brand-mark"><span /></span><span><strong>peyflow</strong><small>MERCHANT WORKSPACE</small></span></div>
        <div className="auth-aside-copy"><span className="eyebrow">MPESA · MERCHANT TOOLS</span><h1>Clear payments.<br /><em>Calmer business.</em></h1><p>Manage payment requests, follow transactions, and keep your records in one place.</p></div>
        <div className="auth-aside-foot"><span className="status-pulse" /> Connected to Safaricom sandbox</div>
        <div className="auth-lines" aria-hidden="true"><span /><span /><span /><span /></div>
      </aside>
      <main className="auth-main">
        <div className="auth-form-wrap">
          <span className="eyebrow">MERCHANT WORKSPACE</span>
          <h2>{isRegister ? "Create your account" : "Welcome back"}</h2>
          <p className="auth-subtitle">{isRegister ? "Set up your business workspace to get started." : "Sign in to your merchant workspace."}</p>
          <ErrorNotice message={error} />
          <SuccessNotice message={success} />
          <form className="auth-form" onSubmit={submit}>
            {isRegister && <>
              <label>Full name<span className="input-wrap"><UserRound size={17} /><input autoComplete="name" required value={form.name} onChange={(event) => change("name", event.target.value)} placeholder="Your name" /></span></label>
              <label>Business name <small>Optional</small><span className="input-wrap"><Store size={17} /><input autoComplete="organization" value={form.businessName} onChange={(event) => change("businessName", event.target.value)} placeholder="Business name" /></span></label>
              <label>M-Pesa phone <small>Optional · enter 254… or 07…</small><span className="input-wrap"><input inputMode="numeric" value={form.phoneNumber} onChange={(event) => change("phoneNumber", event.target.value)} placeholder="2547XXXXXXXX" /></span></label>
            </>}
            <label>Email address<span className="input-wrap"><Mail size={17} /><input type="email" autoComplete="email" required value={form.email} onChange={(event) => change("email", event.target.value)} placeholder="name@business.com" /></span></label>
            <label>Password<span className="input-wrap"><LockKeyhole size={17} /><input type={showPassword ? "text" : "password"} autoComplete={isRegister ? "new-password" : "current-password"} required minLength={isRegister ? 12 : 1} value={form.password} onChange={(event) => change("password", event.target.value)} placeholder={isRegister ? "At least 12 characters" : "Your password"} /><button className="input-action" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
            {!isRegister && <div className="auth-aux"><span>Email verification is required to sign in.</span><button type="button" onClick={async () => {
              if (!form.email) return setError("Enter your email address first.");
              try { await apiRequest("/api/auth/password/forgot", { method: "POST", body: JSON.stringify({ email: form.email }) }); setSuccess("If the account exists, password reset instructions have been sent."); setError(""); }
              catch (requestError) { setError(requestError.message); }
            }}>Forgot password?</button></div>}
            <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}<ArrowRight size={17} /></button>
          </form>
          <div className="auth-switch">{isRegister ? "Already have an account?" : "New to peyflow?"} <Link to={isRegister ? "/login" : "/register"}>{isRegister ? "Sign in" : "Create account"}</Link></div>
          <div className="auth-legal">By continuing, you agree to use this application in accordance with your organization’s policies.</div>
        </div>
      </main>
    </div>
  );
}