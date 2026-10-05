import axios from "axios";

const BREVO_EMAIL_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function createEmailHtml({ heading, message, actionLabel, actionUrl }) {
    const safeMessage = escapeHtml(message).replace(/\r?\n/g, "<br>");
    const action = actionLabel && actionUrl
        ? `<p style="margin:28px 0;text-align:center;"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 24px;border-radius:6px;background:#176b45;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;">${escapeHtml(actionLabel)}</a></p><p style="margin:0;color:#64776e;font-size:13px;line-height:1.6;">If the button does not work, copy and paste this link into your browser:<br><a href="${escapeHtml(actionUrl)}" style="color:#176b45;word-break:break-all;">${escapeHtml(actionUrl)}</a></p>`
        : "";

    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f7f3;font-family:Arial,Helvetica,sans-serif;color:#20372c;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(heading)} from Peyflow</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f7f3;padding:32px 12px;">
        <tr><td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dce8e1;border-radius:10px;overflow:hidden;">
                <tr><td style="padding:24px 32px;background:#176b45;color:#ffffff;font-size:20px;font-weight:bold;">peyflow <span style="display:block;margin-top:5px;color:#dcefe3;font-size:10px;font-weight:normal;letter-spacing:1.5px;">MERCHANT WORKSPACE</span></td></tr>
                <tr><td style="padding:34px 32px 28px;">
                    <h1 style="margin:0 0 16px;color:#193d30;font-size:23px;line-height:1.3;">${escapeHtml(heading)}</h1>
                    <p style="margin:0;color:#52675c;font-size:15px;line-height:1.75;">${safeMessage}</p>
                    ${action}
                    <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e8efe9;color:#829188;font-size:12px;line-height:1.6;">Peyflow helps your business manage M-Pesa collections, payment links, invoices, and transaction records in one workspace.</p>
                </td></tr>
            </table>
            <p style="margin:16px 0 0;color:#829188;font-size:11px;">This is an automated message from Peyflow. Please do not reply.</p>
        </td></tr>
    </table>
</body>
</html>`;
}

function getSender() {
    const configuredSender = process.env.EMAIL_FROM?.trim();
    if (!configuredSender) {
        throw new Error("EMAIL_FROM must be configured to send email");
    }

    const match = configuredSender.match(/^(.*?)\s*<([^<>]+)>$/);
    if (!match) {
        return { email: configuredSender, name: "Peyflow" };
    }

    return {
        email: match[2].trim(),
        name: match[1].trim().replace(/^['"]|['"]$/g, "") || "Peyflow"
    };
}

async function sendEmail({ to, subject, heading, message, actionLabel, actionUrl, developmentUrl }) {
    const apiKey = process.env.BREVO_API_KEY?.trim();
    if (!apiKey) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("BREVO_API_KEY is required for email delivery in production");
        }

        if (developmentUrl) {
            console.info(`Development email for ${to}: ${developmentUrl}`);
        } else {
            console.info(`Development notification email for ${to}: ${subject}\n${message}`);
        }
        return;
    }

    try {
        await axios.post(BREVO_EMAIL_ENDPOINT, {
            sender: getSender(),
            to: [{ email: to }],
            subject,
            htmlContent: createEmailHtml({ heading, message, actionLabel, actionUrl })
        }, {
            headers: {
                "api-key": apiKey,
                "content-type": "application/json",
                accept: "application/json"
            },
            timeout: 10000
        });
    } catch (error) {
        const status = error.response?.status;
        const providerMessage = error.response?.data?.message;
        const details = typeof providerMessage === "string" ? `: ${providerMessage}` : "";
        throw new Error(`Brevo email delivery failed${status ? ` (HTTP ${status})` : ""}${details}`);
    }
}

async function sendAuthEmail({ to, subject, heading, message, actionLabel, actionUrl, developmentUrl }) {
    await sendEmail({ to, subject, heading, message, actionLabel, actionUrl, developmentUrl });
}

export async function sendNotificationEmail({ to, subject, text }) {
    await sendEmail({ to, subject, heading: subject, message: text });
}

function buildAuthUrl(path, token) {
    const baseUrl = process.env.PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 5000}`;
    const url = new URL(path, baseUrl);
    url.searchParams.set("token", token);
    return url.toString();
}

export async function sendVerificationEmail(email, token) {
    const url = buildAuthUrl("/api/auth/verify-email", token);
    await sendAuthEmail({
        to: email,
        subject: "Verify your Peyflow account",
        heading: "Verify your email address",
        message: "Thanks for creating a Peyflow account. Confirm your email address to activate your merchant workspace.",
        actionLabel: "Verify email address",
        actionUrl: url,
        developmentUrl: url
    });
}

export async function sendPasswordResetEmail(email, token) {
    const url = buildAuthUrl("/reset-password", token);
    await sendAuthEmail({
        to: email,
        subject: "Reset your Peyflow password",
        heading: "Reset your password",
        message: "We received a request to reset your Peyflow password. Use the button below to choose a new password.",
        actionLabel: "Reset password",
        actionUrl: url,
        developmentUrl: url
    });
}