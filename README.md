# M-Pesa Payment Management Platform

[![Node.js Version](https://img.shields.io/badge/node.js-%3E%3D20-brightgreen.svg?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![Express 5](https://img.shields.io/badge/express-5.x-000000.svg?style=for-the-badge&logo=express)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/postgresql-16%2B-blue.svg?style=for-the-badge&logo=postgresql)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/redis-7.x-red.svg?style=for-the-badge&logo=redis)](https://redis.io/)
[![OpenAPI 3.0](https://img.shields.io/badge/OpenAPI-3.0%20Swagger-85EA2D.svg?style=for-the-badge&logo=swagger)](http://localhost:5000/api/docs)
[![Deployed on Render](https://img.shields.io/badge/render-deploy-46E3B7.svg?style=for-the-badge&logo=render)](https://render.com/)
[![Database on Supabase](https://img.shields.io/badge/supabase-postgresql-3ECF8E.svg?style=for-the-badge&logo=supabase)](https://supabase.com/)

A production-ready, full-stack payment management SaaS backend integrating the **Safaricom M-Pesa Daraja 2.0 API**. Built with security-first engineering, asynchronous background workers, idempotent webhook processing, itemized invoicing, shareable payment links, financial analytics reports, and complete OpenAPI 3.0 interactive documentation.

---

## Table of Contents

- [System Architecture](#system-architecture)
- [Payment Lifecycle Flow](#payment-lifecycle-flow)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Project Directory Structure](#project-directory-structure)
- [Local Development Setup](#local-development-setup)
- [Phase 15 — Step-by-Step Production Deployment](#phase-15--step-by-step-production-deployment)
  - [Step 1: Supabase PostgreSQL Setup](#step-1-supabase-postgresql-setup)
  - [Step 2: Safaricom Daraja Sandbox Setup](#step-2-safaricom-daraja-sandbox-setup)
  - [Step 3: Render Backend Deployment](#step-3-render-backend-deployment)
  - [Step 4: Callback URL & End-to-End Verification](#step-4-callback-url--end-to-end-verification)
- [Interactive API Documentation (Swagger)](#interactive-api-documentation-swagger)
- [Health Monitoring & Observability](#health-monitoring--observability)
- [Environment Variables Reference](#environment-variables-reference)
- [Running Automated Tests](#running-automated-tests)
- [License](#license)

---

## System Architecture

```text
                           INTERNET / CLIENTS
                                   │
                     ┌─────────────┴─────────────┐
                     │                           │
                     ▼                           ▼
            ┌─────────────────┐         ┌─────────────────┐
            │ Merchant Portal │         │ Customer Payment│
            │ (React/Vercel)  │         │ Link / Invoice  │
            └────────┬────────┘         └────────┬────────┘
                     │                           │
                     └─────────────┬─────────────┘
                                   │ HTTPS
                                   ▼
                     ┌───────────────────────────┐
                     │ Express API Server (Node) │
                     │  - Helmet Strict Security │
                     │  - IP Rate Limiting       │
                     │  - JWT & RBAC Middleware  │
                     │  - OpenAPI / Swagger UI   │
                     │  - Health Monitoring      │
                     └─────────────┬─────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
     ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
     │   PostgreSQL    │  │  Redis Cache &  │  │   Background    │
     │   (Supabase)    │  │ Rate Limit Store│  │     Workers     │
     │  - Users & Auth │  │                 │  │  - Webhook Poll │
     │  - Transactions │  └─────────────────┘  │  - Email Sender │
     │  - Invoices     │                       │  - Reconciler   │
     │  - Audit Logs   │                       └─────────────────┘
     └─────────────────┘                                │
              ▲                                         │
              │         ┌──────────────────────┐        │
              └─────────┤ Safaricom Daraja API │◄───────┘
                        │  - OAuth Token       │
                        │  - STK Push Prompt   │
                        │  - Async Callback    │
                        └──────────────────────┘
```

---

## Payment Lifecycle Flow

```text
 Customer                     Platform API               Safaricom Daraja
    │                              │                            │
    │  Initiate STK Push Payment   │                            │
    ├─────────────────────────────►│                            │
    │                              │  Request OAuth Access Token│
    │                              ├───────────────────────────►│
    │                              │◄───────────────────────────┤
    │                              │  Submit STK Push Payload   │
    │                              ├───────────────────────────►│
    │                              │◄───────────────────────────┤
    │  Pending Response (Checkout) │                            │
    │◄─────────────────────────────┤                            │
    │                              │                            │
    │    Prompt on Customer Phone  │                            │
    │◄──────────────────────────────────────────────────────────┤
    │  Customer Enters M-Pesa PIN  │                            │
    ├──────────────────────────────────────────────────────────►│
    │                              │                            │
    │                              │  POST /api/mpesa/callback  │
    │                              │◄───────────────────────────┤
    │                              │                            │
    │                              │ [1] Store raw event        │
    │                              │ [2] Enqueue async worker   │
    │                              │ [3] Verify idempotency     │
    │                              │ [4] Update transaction     │
    │                              │ [5] Create audit log       │
    │                              │ [6] Dispatch notification  │
    │                              │                            │
    │  Status Confirmed (SUCCESS)  │                            │
    │◄─────────────────────────────┤                            │
```

---

## Key Features

- **Safaricom Daraja M-Pesa STK Push**: Instant prompt initiation, status query polling, and real-time transaction reconciliation.
- **Asynchronous Webhook Processing**: Callback payloads are immediately acknowledged (HTTP 200) and ingested into an idempotent worker queue, preventing dropped callbacks and Safaricom timeouts.
- **Authentication & RBAC**: Secure user registration, password hashing with bcrypt, JWT bearer token verification, and strict role segregation (`MERCHANT` vs `ADMIN`).
- **Shareable Payment Links**: Reusable and one-time payment links with unique reference tracking for direct customer checkout.
- **Itemized Invoicing**: Multi-item invoice generation with dynamic tax, quantity, line-item totals, and whole KES validation.
- **Financial Analytics & Export**: Aggregated transaction volume, success rates, revenue curves, and multi-format export (**CSV**, **Excel XLSX**, **PDF**).
- **Security & Hardening**:
  - `Helmet` with isolated Content Security Policies for Swagger UI vs strict API endpoints.
  - Granular IP & Route rate limiting backed by in-memory or Redis stores.
  - Strict payload size caps (`64KB`) and custom JSON error handling.
  - Audit logging for every critical financial state transition.
- **OpenAPI 3.0 / Swagger Interactive Docs**: Comprehensive endpoint documentation served directly from `/api/docs`.
- **Production Health Monitoring**: Deep database latency and memory diagnostics via `/health` for Render zero-downtime deployments and external monitors.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 22 (LTS) |
| **Framework** | Express 5.x (Native ES Modules) |
| **Database** | PostgreSQL 16+ (Supabase / Local Docker) |
| **Cache & Store** | Redis 7+ (`ioredis` / `rate-limit-redis`) |
| **Validation** | Zod 4.x schema validation |
| **Documentation** | OpenAPI 3.0 via `swagger-ui-express` & `swagger-jsdoc` |
| **Export Engines** | `exceljs`, `pdfkit` |
| **Testing** | Node.js native test runner (`node --test`) |
| **Cloud Hosting** | Render (API Web Service), Supabase (PostgreSQL) |

---

## Project Directory Structure

```text
daraja-test/
├── Dockerfile                   # Hardened multi-stage production container
├── docker-compose.yml           # Local dev services (PostgreSQL & Redis)
├── render.yaml                  # Render Blueprint Infrastructure-as-Code
├── package.json                 # Dependencies and npm scripts
├── systemDocumentation.txt      # 18-phase architecture specification
├── request.rest                 # Exhaustive REST Client test workbook
├── migrations/                  # Versioned SQL migration files
│   ├── 001_initial_schema.sql
│   ├── 002_transactions.sql
│   ├── ...
├── src/
│   ├── app.js                   # Express application assembly & security
│   ├── database.js              # PostgreSQL connection pool & Supabase SSL
│   ├── server.js                # Server entry point & graceful shutdown
│   ├── config/
│   │   ├── environment.js       # Runtime environment validation
│   │   └── swagger.js           # OpenAPI 3.0 specification definition
│   ├── controllers/             # HTTP controllers for all domain routes
│   │   ├── auth.controller.js
│   │   ├── mpesa.controller.js
│   │   ├── invoice.controller.js
│   │   ├── payment-link.controller.js
│   │   └── analytics.controller.js
│   ├── middleware/              # Security, JWT auth, RBAC, validators
│   │   ├── authentication.js
│   │   ├── security.js
│   │   └── validate-request.js
│   ├── routes/                  # Express route routers
│   │   ├── auth.routes.js
│   │   ├── mpesa.routes.js
│   │   ├── docs.routes.js       # /api/docs Swagger mount
│   │   ├── health.routes.js     # /health & /api/health monitor
│   │   └── ...
│   ├── services/                # Business logic & Daraja client
│   │   ├── mpesa.service.js
│   │   ├── transaction.service.js
│   │   └── webhook.service.js
│   ├── validators/              # Zod schemas for request validation
│   └── workers/                 # Async poll workers for webhooks & emails
└── test/                        # Comprehensive unit & integration tests
```

---

## Local Development Setup

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v20+ (v22 recommended)
- [Docker & Docker Compose](https://www.docker.com/)

### 2. Clone and Install Dependencies
```bash
git clone <repository-url>
cd daraja-test
npm install
```

### 3. Start Local Database and Redis
```bash
docker compose up -d
```
This boots:
- **PostgreSQL** on port `5433` (DB: `daraja_dev`, user: `daraja`, pass: `daraja`)
- **Redis** on port `6379`

### 4. Configure Environment
Copy the example configuration:
```bash
cp .env.example .env
```
Ensure `DATABASE_URL` is set to:
```env
DATABASE_URL=postgresql://daraja:daraja@localhost:5433/daraja_dev
DATABASE_SSL=false
AUTH_JWT_SECRET=a_very_long_secure_random_string_with_at_least_32_characters
```

### 5. Run Database Migrations
```bash
npm run db:migrate
```

### 6. Start Development Server
```bash
npm run dev
```
The server will be running at **`http://localhost:5000`**.

---

## Phase 15 — Step-by-Step Production Deployment

This project is architected for seamless cloud deployment using **Supabase** (PostgreSQL) and **Render** (Node.js API).

---

### Step 1: Supabase PostgreSQL Setup

1. **Create an Account / Project**:
   - Go to [Supabase](https://supabase.com/) and create a free project.
   - Choose a region close to your target users (e.g. Frankfurt, London, or US East).
   - Note down your database password.

2. **Retrieve Connection String**:
   - In Supabase, open **Project Settings** → **Database**.
   - Under **Connection Strings**, select **URI**.
   - Select **Transaction Pooler** (recommended for Render, port `6543`) or **Session / Direct** (port `5432`):
     ```
     postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require
     ```
   - Replace `[YOUR-PASSWORD]` with your actual database password.

3. **Verify SSL Compatibility**:
   - The platform automatically detects Supabase hosts and configures SSL (`DATABASE_SSL=true`, `DATABASE_SSL_REJECT_UNAUTHORIZED=false`), ensuring zero SSL certificate chain errors.

---

### Step 2: Safaricom Daraja Sandbox Setup

1. **Sign Up on Safaricom Developer Portal**:
   - Go to [developer.safaricom.co.ke](https://developer.safaricom.co.ke/) and log in.

2. **Create a New App**:
   - Navigate to **My Apps** → **Create a New App**.
   - Select **Lipa Na M-Pesa Sandbox**.
   - Copy the generated **Consumer Key** and **Consumer Secret**.

3. **Standard Sandbox Credentials**:
   - **Business Shortcode (Paybill/Till)**: `174379`
   - **Passkey**: `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919`
   - **Test Phone Number**: Any active Safaricom number (e.g., `2547XXXXXXXX`).

---

### Step 3: Render Backend Deployment

You can deploy using Render's Infrastructure-as-Code Blueprint (`render.yaml`) or manually:

#### Option A: 1-Click Blueprint (Recommended)
1. Push your repository to GitHub.
2. Log in to [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** → **Blueprint**.
4. Connect your GitHub repository. Render reads `render.yaml` automatically and configures:
   - Build Command: `npm ci && npm run db:migrate` *(runs database migrations automatically on every deploy!)*
   - Start Command: `npm start`
   - Health Check: `/health`
5. Fill in the prompted secret environment variables (`DATABASE_URL`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, etc.).
6. Click **Apply**.

#### Option B: Manual Web Service
1. In Render, click **New +** → **Web Service**.
2. Select your repository.
3. Configure the settings:
   - **Runtime**: `Node`
   - **Branch**: `main`
   - **Build Command**: `npm ci && npm run db:migrate`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
4. Add the required Environment Variables in Render:
   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | *Your Supabase connection string* |
   | `DATABASE_SSL` | `true` |
   | `DATABASE_SSL_REJECT_UNAUTHORIZED` | `false` |
   | `AUTH_JWT_SECRET` | *32+ random characters* |
   | `TRUST_PROXY_HOPS` | `1` |
   | `CORS_ORIGINS` | `https://your-frontend.vercel.app` |
   | `RATE_LIMIT_REDIS_URL` | *Your Upstash/Render Redis URL (or leave blank for memory)* |
   | `MPESA_CONSUMER_KEY` | *Your Daraja consumer key* |
   | `MPESA_CONSUMER_SECRET` | *Your Daraja consumer secret* |
   | `MPESA_SHORTCODE` | `174379` |
   | `MPESA_PASSKEY` | *Sandbox passkey* |
   | `MPESA_CALLBACK_URL` | `https://<your-service>.onrender.com/api/mpesa/callback` |
   | `ENABLE_API_DOCS` | `true` |
5. Click **Create Web Service**. Render will build the app, run the migrations against Supabase, and start listening!

---

### Step 4: Callback URL & End-to-End Verification

1. Once your Render service is live, its URL will look like:
   ```
   https://mpesa-payment-platform.onrender.com
   ```
2. Verify the live health check:
   ```bash
   curl https://mpesa-payment-platform.onrender.com/health
   ```
   Expected response:
   ```json
   {
     "status": "healthy",
     "timestamp": "2026-10-03T05:31:30.136Z",
     "environment": "production",
     "version": "1.0.0",
     "checks": {
       "database": { "status": "up", "latencyMs": 12.4 }
     }
   }
   ```
3. Update your `MPESA_CALLBACK_URL` variable in Render to:
   ```
   https://mpesa-payment-platform.onrender.com/api/mpesa/callback
   ```
4. Access your live Swagger Documentation:
   ```
   https://mpesa-payment-platform.onrender.com/api/docs
   ```

---

## Interactive API Documentation (Swagger)

The platform comes with a complete, fully documented **OpenAPI 3.0** specification.

- **Interactive UI**: `http://localhost:5000/api/docs` (or your live Render URL `/api/docs`)
- **Raw OpenAPI JSON**: `http://localhost:5000/api/docs.json`

### Supported Tag Groups:
- **Health**: System status and dependency latency
- **Authentication**: Registration, Login, Token Refresh, Password Reset
- **Merchants**: Profile inspection and updates
- **M-Pesa Payments**: STK Push initiation, list, details, and Daraja callback webhook
- **Payment Links**: Create shareable links and execute public checkout
- **Invoices**: Create itemized invoices and generate payment links
- **Notifications**: Fetch notifications and mark them as read
- **Analytics**: Merchant dashboard metrics and multi-format reports (CSV, XLSX, PDF)
- **Admin**: Webhook event audit and manual dead-letter retry

---

## Health Monitoring & Observability

The application provides dedicated health monitoring at **`GET /health`** and **`GET /api/health`**:

```http
GET /health HTTP/1.1
Host: localhost:5000
```

### Healthy Response (`HTTP 200 OK`)
```json
{
  "status": "healthy",
  "timestamp": "2026-10-03T05:31:30.136Z",
  "environment": "production",
  "version": "1.0.0",
  "durationMs": 2.15,
  "checks": {
    "database": {
      "status": "up",
      "latencyMs": 1.45
    },
    "system": {
      "uptimeSeconds": 1420,
      "memoryUsage": {
        "rssMb": 52,
        "heapUsedMb": 24
      }
    }
  }
}
```

### Degraded Response (`HTTP 503 Service Unavailable`)
When the database connection fails, the endpoint returns HTTP 503, instructing Render, Kubernetes, or load balancers not to route traffic to the degraded container.

---

## Environment Variables Reference

| Variable | Description | Default / Example | Required in Prod? |
|---|---|---|:---:|
| `NODE_ENV` | Runtime environment (`development`, `production`, `test`) | `development` | Yes |
| `PORT` | HTTP port the server binds to | `5000` (Render uses `10000`) | No |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` | **Yes** |
| `DATABASE_SSL` | Enable TLS/SSL connection to PostgreSQL | `true` for Supabase | Yes |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Validate SSL certificates strictly | `false` for Supabase | No |
| `AUTH_JWT_SECRET` | Secret key for signing JWTs (minimum 32 characters) | Random 32+ chars | **Yes** |
| `MPESA_CONSUMER_KEY` | Safaricom Daraja Developer Consumer Key | Sandbox key | **Yes** |
| `MPESA_CONSUMER_SECRET` | Safaricom Daraja Developer Consumer Secret | Sandbox secret | **Yes** |
| `MPESA_SHORTCODE` | Business Paybill or Till Shortcode | `174379` (Sandbox) | **Yes** |
| `MPESA_PASSKEY` | Daraja STK Push Passkey | Sandbox passkey | **Yes** |
| `MPESA_CALLBACK_URL` | Public HTTPS callback endpoint for Safaricom | `https://.../api/mpesa/callback` | **Yes** |
| `CORS_ORIGINS` | Comma-delimited list of allowed browser origins | `https://your-frontend.vercel.app` | **Yes** |
| `TRUST_PROXY_HOPS` | Reverse proxy hop count (Render uses `1`) | `1` | **Yes** |
| `RATE_LIMIT_REDIS_URL` | Redis URL for distributed rate limiting | `redis://...` | Optional |
| `SMTP_HOST` | SMTP server for password reset / emails | `smtp.mailtrap.io` | **Yes** |
| `SMTP_PORT` | SMTP port | `587` | No |
| `ENABLE_API_DOCS` | Expose `/api/docs` in production environment | `true` | No |

---

## Running Automated Tests

The codebase includes comprehensive unit, security, and integration test suites using the native Node.js test runner:

```bash
# Run unit schemas & Daraja service tests
npm run test:unit

# Run security, CORS, helmet, and rate limiting tests
npm run test:security

# Run end-to-end payment lifecycle integration tests
npm run test:integration

# Run all test suites sequentially
npm test
```

You can also use the included [`request.rest`](./request.rest) file with the VS Code REST Client extension to execute interactive API requests against a running local or production instance.

---

## License

This project is licensed under the **ISC License**.
