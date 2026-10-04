import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Clock3, LockKeyhole, Smartphone, TriangleAlert } from "lucide-react";
import { useParams } from "react-router-dom";

import { apiRequest } from "../api.js";
import { ErrorNotice, formatDate, formatKes, LoadingState, StatusBadge } from "../components/ui.jsx";

const terminalStatuses = new Set(["SUCCESS", "FAILED", "CANCELLED", "TIMEOUT"]);

export default function PublicPaymentPage() {
  const { reference } = useParams();
  const [link, setLink] = useState(null);
  const [payment, setPayment] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest(`/api/public/payment-links/${reference}`)
      .then((result) => { if (active) setLink(result.paymentLink); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reference]);

  useEffect(() => {
    if (!payment?.id || terminalStatuses.has(payment.status)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const result = await apiRequest(`/api/public/payment-links/${reference}/payments/${payment.id}/status`);
        setPayment(result.payment);
      } catch {
        setNotice("Status refresh is temporarily unavailable. Keep this page open and try again shortly.");
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [payment?.id, payment?.status, reference]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest(`/api/public/payment-links/${reference}/pay`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ phoneNumber })
      }, false);
      setPayment({ id: result.paymentId, status: result.status, amount: link.amount, currency: link.currency });
      setNotice("The request has been sent. Check your phone and enter your M-Pesa PIN.");
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="public-loading"><LoadingState label="Loading payment details" /></div>;
  if (!link) return <div className="public-loading"><section className="public-card"><span className="public-brand">peyflow <i>PAY</i></span><div className="public-state-icon state-failed"><TriangleAlert size={25} /></div><h1>Payment link unavailable</h1><p>{error || "This link may have expired or been deactivated."}</p></section></div>;

  const successful = payment?.status === "SUCCESS";
  const failed = payment && ["FAILED", "CANCELLED", "TIMEOUT"].includes(payment.status);

  return (
    <div className="public-payment-page">
      <div className="public-topline"><span className="public-brand">peyflow <i>PAY</i></span><span><LockKeyhole size={13} /> Secure M-Pesa checkout</span></div>
      <main className="public-card">
        <span className="public-business">{link.businessName}</span>
        <p className="public-description">{link.description}</p>
        <div className="public-amount-label">AMOUNT DUE</div>
        <div className="public-amount">{formatKes(link.amount, link.currency)}</div>
        <div className="public-divider" />

        {successful ? <div className="public-result"><div className="public-state-icon state-success"><CheckCircle2 size={27} /></div><h1>Payment received</h1><p>Your payment is confirmed.</p><div className="public-result-line"><span>Status</span><StatusBadge status={payment.status} /></div>{payment.receiptNumber && <div className="public-result-line"><span>M-Pesa receipt</span><strong>{payment.receiptNumber}</strong></div>}</div> : failed ? <div className="public-result"><div className="public-state-icon state-failed"><TriangleAlert size={27} /></div><h1>Payment {payment.status.toLowerCase()}</h1><p>{payment.resultDescription || "The payment was not completed."}</p><button className="button button-secondary public-retry" type="button" onClick={() => { setPayment(null); setNotice(""); }}>Try again</button></div> : payment ? <div className="public-result"><div className="public-state-icon state-pending"><Clock3 size={27} /></div><h1>Waiting for payment</h1><p>{notice || "Check your phone and approve the M-Pesa prompt."}</p><div className="public-result-line"><span>Status</span><StatusBadge status={payment.status} /></div><small className="polling-label">Updating payment status automatically</small></div> : <form className="public-pay-form" onSubmit={submit}>
          <label htmlFor="customer-phone">M-Pesa phone number</label>
          <div className="public-phone-input"><span>KE +254</span><input id="customer-phone" autoFocus inputMode="numeric" pattern="254[17][0-9]{8}" required value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="2547XXXXXXXX" /></div>
          <p className="public-input-hint"><Smartphone size={14} /> Enter the number that will receive the STK prompt.</p>
          <ErrorNotice message={error} />
          <button className="button button-primary public-submit" type="submit" disabled={busy}>{busy ? "Sending request…" : "Pay with M-Pesa"}<ArrowRight size={17} /></button>
          {notice && <p className="public-notice">{notice}</p>}
        </form>}
      </main>
      <footer className="public-footer">Payment is processed by Safaricom M-Pesa · {link.expiresAt ? `Link expires ${formatDate(link.expiresAt)}` : "Secure checkout"}</footer>
    </div>
  );
}