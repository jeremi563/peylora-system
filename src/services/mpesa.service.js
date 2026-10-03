import axios  from "axios";
import dotenv from "dotenv";
dotenv.config();

const SANDBOX_API_ORIGIN = "https://sandbox.safaricom.co.ke";
const DARAJA_REQUEST_TIMEOUT_MS = Number(process.env.MPESA_REQUEST_TIMEOUT_MS || 15_000);

if (!Number.isInteger(DARAJA_REQUEST_TIMEOUT_MS) || DARAJA_REQUEST_TIMEOUT_MS < 1_000 || DARAJA_REQUEST_TIMEOUT_MS > 120_000) {
    throw new Error("MPESA_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000");
}

function sandboxEndpoint(path) {
    const url = new URL(path, SANDBOX_API_ORIGIN);

    if (url.origin !== SANDBOX_API_ORIGIN) {
        throw new Error("Daraja requests must use the sandbox API origin");
    }

    return url.toString();
}

export async function getAccessToken() {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
        throw new Error("MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET must be configured");
    }

    const credentials = `${consumerKey}:${consumerSecret}`;
    const encodedCredentials = Buffer
        .from(credentials)
        .toString("base64");
    const authorization = `Basic ${encodedCredentials}`;
    const url = sandboxEndpoint("/oauth/v1/generate?grant_type=client_credentials");
    const response  = await axios.get(url,{
        headers: {
            Authorization: authorization
        },
        maxRedirects: 0,
        timeout: DARAJA_REQUEST_TIMEOUT_MS
    }
    )
    if (typeof response.data?.access_token !== "string" || !response.data.access_token) {
        throw new Error("Daraja OAuth response did not include an access token");
    }

    return response.data.access_token;

}

export function generateTimestamp() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

export function generateStkPassword(shortCode, passkey, timestamp) {
  const passwordString = `${shortCode}${passkey}${timestamp}`;
  const password = Buffer
    .from(passwordString)
    .toString("base64");
    return password;
}

export function buildStkPayload({
    shortCode,
    password,
    timestamp,
    amount,
    phoneNumber,
    callbackUrl,
    accountReference,
    transactionDesc
}) {
    return {
        BusinessShortCode: shortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phoneNumber,
        PartyB: shortCode,
        PhoneNumber: phoneNumber,
        CallBackURL: callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: transactionDesc
    };
}

export async function sendStkPush(payload, accessToken) {
    const url = sandboxEndpoint("/mpesa/stkpush/v1/processrequest");

    const response = await axios.post(url, payload, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        maxRedirects: 0,
        timeout: DARAJA_REQUEST_TIMEOUT_MS
    });

    return response.data;
}

export async function queryStkStatus({ shortCode, passkey, timestamp, checkoutRequestId }, accessToken) {
    const password = generateStkPassword(shortCode, passkey, timestamp);
    const url = sandboxEndpoint("/mpesa/stkpushquery/v1/query");
    const response = await axios.post(url, {
        BusinessShortCode: shortCode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
    }, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        maxRedirects: 0,
        timeout: DARAJA_REQUEST_TIMEOUT_MS
    });

    return response.data;
}

export function extractCallbackMetadata(callbackMetadata) {
    const items = callbackMetadata?.Item ?? [];

    const metadata = {};

    for (const item of items) {
        metadata[item.Name] = item.Value;
    }

    return metadata;
}


