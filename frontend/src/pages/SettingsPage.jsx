import { useState } from "react";
import { Check, KeyRound, LogOut, Mail, ShieldCheck, UserRound } from "lucide-react";

import { apiRequest } from "../api.js";
import { useAuth } from "../state/auth.jsx";
import { ErrorNotice, PageHeading, SuccessNotice } from "../components/ui.jsx";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestPasswordReset() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await apiRequest("/api/auth/password/forgot", { method: "POST", body: JSON.stringify({ email: user.email }) }, false);
      setSuccess("If the account is active, password reset instructions have been sent to your email.");
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="page-stack">
      <PageHeading eyebrow="PREFERENCES" title="Settings" description="Review your account and sign-in security." />
      <ErrorNotice message={error} /><SuccessNotice message={success} />
      <section className="surface settings-section"><div className="settings-title"><div className="metric-icon metric-green"><UserRound size={18} /></div><div><h3>Account profile</h3><p>Your merchant workspace identity.</p></div></div><div className="settings-fields"><div><span>Name</span><strong>{user?.name || "—"}</strong></div><div><span>Email address</span><strong>{user?.email || "—"}</strong></div><div><span>Phone number</span><strong>{user?.phoneNumber || "Not provided"}</strong></div><div><span>Account role</span><strong className="role-label">{user?.role || "MERCHANT"}</strong></div></div></section>
      <section className="surface settings-section"><div className="settings-title"><div className="metric-icon metric-blue"><ShieldCheck size={18} /></div><div><h3>Security</h3><p>Manage account verification and credentials.</p></div></div><div className="security-row"><div className="security-row-icon"><Mail size={17} /></div><div><strong>Email verification</strong><small>Your account is verified and can sign in.</small></div><span className="verified-tag"><Check size={13} /> Verified</span></div><div className="security-row"><div className="security-row-icon"><KeyRound size={17} /></div><div><strong>Password reset</strong><small>We’ll send a one-time reset link to your account email.</small></div><button className="button button-subtle" type="button" disabled={busy} onClick={requestPasswordReset}>{busy ? "Sending…" : "Send reset link"}</button></div></section>
      <section className="surface settings-section signout-section"><div className="settings-title"><div className="metric-icon metric-red"><LogOut size={18} /></div><div><h3>Sign out</h3><p>End this browser session and revoke its refresh token.</p></div></div><button className="button button-danger-subtle" type="button" onClick={logout}>Sign out of this device</button></section>
    </div>
  );
}