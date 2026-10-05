# Peyflow M-Pesa Payment Platform

A merchant payment workspace built with React, Node.js, Express, and PostgreSQL. It supports M-Pesa STK Push payments, payment links, invoices, merchant authentication, transaction reporting, and an interactive Swagger API reference.

> The current Daraja client is configured for Safaricom's sandbox. Do not use it for live payments without implementing and verifying production Daraja configuration.

## What It Does

- Creates M-Pesa STK Push requests and tracks payment attempts.
- Receives Daraja callbacks, stores them idempotently, and processes them asynchronously.
- Manages merchant accounts, invoices, payment links, notifications, analytics, and exports.
- Provides JWT-based authentication, request validation, rate limiting, audit logging, and health endpoints.
- Serves the interactive API docs at `/api/docs` when enabled.

## Payment Status Flow

```text
STK request -> PENDING -> callback queued -> webhook worker -> SUCCESS / FAILED / CANCELLED
```

Daraja's callback endpoint acknowledges and persists callback events. The webhook worker applies those events to transaction and payment records. A callback with `ResultCode: 0` must also contain a valid paid amount to be recorded as successful.

## Technology

- Node.js 20 or newer, Express 5, PostgreSQL, React, and Vite
- Safaricom Daraja sandbox for STK Push and status queries
- Brevo transactional email API
- Docker Compose for local PostgreSQL, Redis, API, and workers
- Render Blueprint for deployment

## Local Development

Prerequisites: Node.js 20+ and Docker Compose.

1. Install dependencies and create a local environment file:

   ```sh
   npm ci
   cp .env.example .env
   ```

2. Fill in local configuration and your own sandbox credentials in `.env`. Never commit `.env` or paste credentials into documentation, source code, or issue reports.

3. Start the local stack:

   ```sh
   docker compose up --build
   ```

   Compose starts PostgreSQL, Redis, the API, the notification worker, and the webhook worker. The API is available at `http://localhost:5000`; the health endpoint is `/health`.

4. In another terminal, start the frontend:

   ```sh
   cd frontend
   npm ci
   npm run dev
   ```

   Vite uses `VITE_API_URL` when set and defaults to the local API address.

To run only the API outside Compose, use `npm run dev`. To run the combined API and webhook worker process, use `npm run start:all`.

## Configuration

Set secrets and deployment-specific values in environment variables or the hosting provider's secret manager. The project reads these variable names:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_SSL` | Enable database TLS |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Database certificate verification setting |
| `DATABASE_POOL_MAX` | PostgreSQL pool size |
| `AUTH_JWT_SECRET` | JWT signing secret; at least 32 characters |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` | Daraja sandbox credentials |
| `MPESA_SHORTCODE` / `MPESA_PASSKEY` | Daraja STK configuration |
| `MPESA_CALLBACK_URL` | Public HTTPS callback endpoint ending in `/api/mpesa/callback` |
| `MPESA_REQUEST_TIMEOUT_MS` | Daraja request timeout |
| `BREVO_API_KEY` / `EMAIL_FROM` | Transactional email configuration; required in production |
| `CORS_ORIGINS` | Trusted frontend origins; required in production |
| `RATE_LIMIT_REDIS_URL` | Shared Redis-backed rate-limit store; required in production |
| `TRUST_PROXY_HOPS` | Trusted proxy count; required in production |
| `PUBLIC_APP_URL` | Public application URL used in generated links |
| `ENABLE_API_DOCS` | Set to `true` to expose Swagger in production |
| `WEBHOOK_BATCH_SIZE` / `WEBHOOK_POLL_INTERVAL_MS` / `WEBHOOK_LEASE_SECONDS` | Webhook worker tuning |
| `NOTIFICATION_BATCH_SIZE` / `NOTIFICATION_POLL_INTERVAL_MS` / `NOTIFICATION_MAX_ATTEMPTS` / `NOTIFICATION_LEASE_SECONDS` | Notification worker tuning |
| `PORT` | API listening port; Render supplies this value |

See `.env.example` for the variable names used in local development. Use unique, private credentials in your environment and rotate any secret that has been exposed.

## Deployment

The repository's `render.yaml` configures a Render **free web service**. Its build command installs dependencies and applies migrations; its start command is `npm run start:all`, which supervises the API and webhook worker in the same service. Configure the prompted secrets and URLs in Render, including the same `DATABASE_URL` used by the app.

On Render's free plan, the service may sleep when idle. Callback events are persisted before acknowledgement, but processing can be delayed while the service is asleep or restarting. The Render start command does not include the separate notification worker; Docker Compose does include it for local development.

For a separately configured Render service, use:

- Build command: `npm ci && npm run db:migrate`
- Start command: `npm run start:all`
- Health check path: `/health`

The frontend can be deployed separately from the `frontend/` directory. Set `VITE_API_URL` to the API's public origin at build time. Configure production CORS to allow that frontend origin.

## API and Tests

- Swagger UI: `/api/docs` (requires `ENABLE_API_DOCS=true` in production)
- OpenAPI JSON: `/api/docs.json`
- Health: `/health` and `/api/health`

Run checks from the repository root:

```sh
npm run test:unit
npm run test:security
npm run test:integration
npm test
npm run frontend:build
```

Integration tests require a reachable test database configured through `DATABASE_URL`.

## Security Notes

- Do not commit `.env`, credentials, API keys, database connection strings, or real customer data.
- Use environment or hosting secret settings for all private values. `.env.example` is a template, not a production configuration.
- Keep the callback endpoint publicly reachable over HTTPS and set the exact URL in Daraja and the application environment.
- The current M-Pesa client targets the sandbox API origin; verify the integration and credentials before any production payment use.
