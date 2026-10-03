import nodemailer from "nodemailer";

let transporter;

function getTransporter() {
    if (!process.env.SMTP_HOST) {
        return null;
    }

    if (!transporter) {
        const port = Number(process.env.SMTP_PORT || 587);
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465,
            auth: process.env.SMTP_USER ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASSWORD
            } : undefined
        });
    }

    return transporter;
}

async function sendAuthEmail({ to, subject, text, developmentUrl }) {
    const mailer = getTransporter();
    if (!mailer) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("SMTP_HOST is required for authentication emails in production");
        }

        console.info(`Development email for ${to}: ${developmentUrl}`);
        return;
    }

    await mailer.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to,
        subject,
        text
    });
}

export async function sendNotificationEmail({ to, subject, text }) {
    const mailer = getTransporter();
    if (!mailer) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("SMTP_HOST is required for notification email delivery in production");
        }

        console.info(`Development notification email for ${to}: ${subject}\n${text}`);
        return;
    }

    await mailer.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to,
        subject,
        text
    });
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
        subject: "Verify your M-Pesa platform account",
        text: `Verify your email by opening this link: ${url}`,
        developmentUrl: url
    });
}

export async function sendPasswordResetEmail(email, token) {
    const url = buildAuthUrl("/reset-password", token);
    await sendAuthEmail({
        to: email,
        subject: "Reset your M-Pesa platform password",
        text: `Reset your password by opening this link: ${url}`,
        developmentUrl: url
    });
}