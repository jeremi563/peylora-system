# Peyflow API Reference

This document describes the HTTP API exposed by the Peyflow merchant payment platform.

## Overview

- **Base URL:** `http://localhost:5000` in local development
- **Content type:** `application/json` for JSON requests and responses
- **Currency:** `KES`
- **Authentication:** Bearer access token unless an endpoint is marked public
- **API documentation:** `/api/docs` and `/api/docs.json` when API docs are enabled

Production deployments must use HTTPS. The API also enforces CORS, security headers, request validation, rate limiting, and authenticated merchant ownership checks.

## Authentication

Include the access token in protected requests:

```http
Authorization: Bearer <access-token>
```

Access tokens expire after 15 minutes. Use the refresh token returned by login or account activation to obtain a new session.

### New account activation

Registration starts an OTP-based activation flow:

1. `POST /api/auth/register`
2. The user receives a six-digit OTP by email.
3. The client navigates to the verification page.
4. `POST /api/auth/email/complete-verification` consumes the OTP, sets the initial password, and returns an authenticated session.

The OTP is valid for one hour and can only be used once. `POST /api/auth/email/resend-verification` sends a replacement code.

## Common responses

Successful JSON responses generally include `success: true`.

```json
{
  "success": false,
  "message": "A human-readable error message"
}
```

Common status codes:

| Status | Meaning |
|---|---|
| `200` | Request completed successfully |
| `201` | Resource created |
| `202` | Request accepted for asynchronous processing |
| `400` | Invalid request, parameter, or state transition |
| `401` | Missing, invalid, or expired authentication |
| `403` | Authenticated user lacks the required role or ownership |
| `404` | Resource not found |
| `409` | Conflict, duplicate, or idempotency mismatch |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `502` | Upstream Daraja or provider failure |
| `503` | Health check reports a degraded service |

Paginated responses include:

```json
{
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 0,
    "pages": 0
  }
}
```

## Authentication endpoints

### Register

```http
POST /api/auth/register
```

Creates a merchant account and sends an email verification OTP. Password creation happens during OTP completion.

Request body:

```json
{
  "name": "Jane Wanjiku",
  "businessName": "Wanjiku Traders",
  "email": "jane@example.com",
  "phoneNumber": "254712345678"
}
```

`businessName` and `phoneNumber` are optional. `phoneNumber` must use `254XXXXXXXXX` format. A legacy optional `password` field is accepted for compatibility but is not required by the new frontend flow.

Response: `201 Created`

```json
{
  "success": true,
  "message": "Account created. Enter the verification code sent to your email.",
  "email": "jane@example.com"
}
```

### Log in

```http
POST /api/auth/login
```

Request body:

```json
{
  "email": "jane@example.com",
  "password": "SecureMerchantPassword123!"
}
```

Response includes `user`, `accessToken`, `refreshToken`, `tokenType`, and `expiresIn`.

### Complete email verification and sign in

```http
POST /api/auth/email/complete-verification
```

Consumes the OTP, sets the initial password, marks the email as verified, and creates the first authenticated session.

Request body:

```json
{
  "email": "jane@example.com",
  "otp": "482019",
  "password": "SecureMerchantPassword123!"
}
```

The password must contain at least 12 characters and no more than 72 UTF-8 bytes.

### Resend verification OTP

```http
POST /api/auth/email/resend-verification
```

Request body:

```json
{
  "email": "jane@example.com"
}
```

The response is intentionally generic to reduce account enumeration risk.

### Refresh session

```http
POST /api/auth/refresh
```

Request body:

```json
{
  "refreshToken": "<refresh-token>"
}
```

Refresh token rotation is enforced. Reuse of a revoked token invalidates its token family.

### Log out

```http
POST /api/auth/logout
```

Request body:

```json
{
  "refreshToken": "<refresh-token>"
}
```

### Request password reset

```http
POST /api/auth/password/forgot
```

Request body:

```json
{
  "email": "jane@example.com"
}
```

The response is generic whether or not an active account exists.

### Complete password reset

```http
POST /api/auth/password/reset
```

Request body:

```json
{
  "token": "<password-reset-token>",
  "password": "NewSecureMerchantPassword123!"
}
```

Existing refresh sessions are revoked after a successful reset.

### Verify email with a token

```http
POST /api/auth/email/verify
GET /api/auth/verify-email?token=<token>
```

These endpoints support the earlier token-based verification flow for compatibility. New clients should use the OTP completion endpoint above.

## Payment endpoints

All merchant payment endpoints require a valid merchant Bearer token.

### Initiate STK Push

```http
POST /api/payments
POST /api/mpesa/stk-push
```

Both routes perform the same operation.

Request body:

```json
{
  "amount": 500,
  "phoneNumber": "254712345678",
  "description": "Order #1042"
}
```

Optional header:

```http
Idempotency-Key: order-1042-payment
```

The amount must be a positive whole number of Kenyan shillings. Response: `202 Accepted` when Daraja accepts the STK request. The final status arrives asynchronously through the callback and webhook worker.

### List payments

```http
GET /api/payments
```

Query parameters:

| Parameter | Description |
|---|---|
| `status` | `CREATED`, `PENDING`, `SUCCESS`, `FAILED`, `CANCELLED`, or `TIMEOUT` |
| `paymentLinkId` | Payment link UUID |
| `search` | Reference or payment search text, max 100 characters |
| `page` | Page number, default `1` |
| `limit` | Page size, default `25`, maximum `100` |

### Get a payment

```http
GET /api/payments/:paymentId
```

Returns one merchant-owned payment and its associated details.

### Get a transaction

```http
GET /api/transactions/:transactionId
```

Returns one merchant-owned M-Pesa transaction.

### Reconcile a transaction

```http
POST /api/transactions/:transactionId/reconcile
```

Queries the Daraja STK status endpoint for a pending transaction and records the provider response. The final payment state is changed by the callback processing flow.

### Receive Daraja callback

```http
POST /api/mpesa/callback
```

Public provider callback endpoint. Safaricom Daraja posts the STK callback payload here. The API persists accepted callbacks before acknowledging them; the webhook worker processes them asynchronously and idempotently.

Successful acknowledgement:

```json
{
  "ResultCode": 0,
  "ResultDesc": "Callback received"
}
```

This endpoint must be publicly reachable over HTTPS and configured as `MPESA_CALLBACK_URL`.

## Invoice endpoints

All invoice endpoints require a merchant Bearer token.

### Create an invoice

```http
POST /api/invoices
```

Request body:

```json
{
  "invoiceNumber": "INV-1042",
  "customer": {
    "name": "Amina Otieno",
    "phoneNumber": "254712345678",
    "email": "amina@example.com"
  },
  "items": [
    {
      "description": "Consulting service",
      "quantity": 1,
      "unitAmount": 2500
    }
  ],
  "dueAt": "2026-12-01T00:00:00.000Z"
}
```

`invoiceNumber`, customer email, and `dueAt` are optional. Invoice totals support up to two decimal places but must resolve to a whole KES amount for M-Pesa STK payments.

### List invoices

```http
GET /api/invoices
```

Query parameters: `status`, `search`, `page`, and `limit`. Supported statuses are `DRAFT`, `SENT`, `PENDING`, `PAID`, `OVERDUE`, and `CANCELLED`.

### Get an invoice

```http
GET /api/invoices/:invoiceId
```

### Change invoice status

```http
PATCH /api/invoices/:invoiceId/status
```

Request body:

```json
{
  "status": "SENT"
}
```

Allowed requested statuses are `SENT`, `CANCELLED`, and `OVERDUE`. The service validates whether the transition is permitted.

### Create an invoice payment link

```http
POST /api/invoices/:invoiceId/payment-link
```

Creates or reuses a public payment link for the payable invoice balance.

## Payment link endpoints

### Create a merchant payment link

```http
POST /api/payment-links
```

Requires a merchant Bearer token.

Request body:

```json
{
  "description": "School fees",
  "amount": 1500,
  "expiresAt": "2026-12-31T23:59:59.000Z"
}
```

### List merchant payment links

```http
GET /api/payment-links
```

Requires a merchant Bearer token. Returned links include a public URL based on `PUBLIC_APP_URL`.

### Deactivate a payment link

```http
DELETE /api/payment-links/:linkId
```

Requires a merchant Bearer token.

### Get a public payment link

```http
GET /api/public/payment-links/:reference
```

Public endpoint. The reference must contain 20 to 64 letters, numbers, underscores, or hyphens.

### Pay a public payment link

```http
POST /api/public/payment-links/:reference/pay
```

Public and rate-limited. Request body:

```json
{
  "phoneNumber": "254712345678"
}
```

Optional `Idempotency-Key` prevents duplicate payment attempts for the same public link.

### Get public payment status

```http
GET /api/public/payment-links/:reference/payments/:paymentId/status
```

Public endpoint that returns the limited payment status, amount, receipt number, transaction date, and provider result description.

## Merchant and notification endpoints

### Get a merchant profile

```http
GET /api/merchants/:merchantId
```

Requires a Bearer token. Merchants may access their own profile; administrators may access merchant profiles according to the ownership middleware.

### List notifications

```http
GET /api/notifications
```

Requires a Bearer token. Query parameters:

- `page`: page number, default `1`
- `limit`: page size, default `25`, maximum `100`
- `unreadOnly`: `true` or `false`, default `false`

### Mark one notification as read

```http
PATCH /api/notifications/:notificationId/read
```

Requires a Bearer token and only affects the authenticated user's notification.

### Mark all notifications as read

```http
PATCH /api/notifications/read-all
```

Requires a Bearer token.

## Analytics and reports

All analytics endpoints require a merchant Bearer token.

### Get dashboard analytics

```http
GET /api/analytics/dashboard
```

Query parameters:

| Parameter | Description |
|---|---|
| `from` | Start date in `YYYY-MM-DD` format |
| `to` | End date in `YYYY-MM-DD` format |
| `interval` | `day`, `week`, or `month`; default `day` |

Date ranges cannot be reversed or exceed 366 calendar days.

### Export transaction report

```http
GET /api/analytics/reports/transactions
```

Query parameters:

| Parameter | Description |
|---|---|
| `from` | Start date in `YYYY-MM-DD` format |
| `to` | End date in `YYYY-MM-DD` format |
| `format` | `csv`, `xlsx`, or `pdf`; default `csv` |

The response is a downloadable file with a private, no-store cache policy.

## Administrator endpoints

All administrator endpoints require a Bearer token with the `ADMIN` role.

### List webhook events

```http
GET /api/admin/webhook-events
```

Query parameters: `status` (`RECEIVED`, `PROCESSING`, `PROCESSED`, or `FAILED`), `page`, and `limit`.

### Retry a webhook event

```http
POST /api/admin/webhook-events/:eventId/retry
```

Retries a failed webhook event. The event must be identified by UUID.

### List audit logs

```http
GET /api/admin/audit-logs
```

Query parameters: `action`, `page`, and `limit`.

## Health and documentation endpoints

### Root service check

```http
GET /
```

Returns a simple welcome response.

### Health check

```http
GET /health
GET /api/health
```

Returns database connectivity, process uptime, memory usage, environment, version, and request duration. Returns `200` when healthy and `503` when degraded.

### OpenAPI JSON

```http
GET /api/docs.json
```

Available when API documentation is enabled. In production, set `ENABLE_API_DOCS=true`.

### Swagger UI

```http
GET /api/docs
```

Interactive API documentation. It is enabled by default outside production and conditionally enabled in production.

## Payment lifecycle

```text
STK request -> PENDING -> callback persisted -> webhook worker -> SUCCESS / FAILED / CANCELLED
```

A successful Daraja callback must include a valid paid amount. The callback is acknowledged separately from business processing so retries and duplicate provider events can be handled safely.

## Configuration requirements

The API requires environment configuration for database access, JWT signing, Daraja credentials, callback URL, CORS origins, and production email delivery. See [README.md](README.md#configuration) and `.env.example` for the complete configuration list.
