/**
 * OpenAPI / Swagger configuration for the M-Pesa Payment Management Platform.
 *
 * This module produces a fully self-contained OpenAPI 3.0 document that
 * is served through swagger-ui-express at /api/docs.
 *
 * Approach: hand-authored spec (no JSDoc scanning) so that the document
 * stays accurate even when route files change, and remains easy to
 * maintain without coupling annotation comments to implementation detail.
 */

const VERSION = "1.0.0";

export const swaggerSpec = {
    openapi: "3.0.3",
    info: {
        title: "M-Pesa Payment Management Platform",
        description: `
## Overview

A full-stack SaaS application that allows merchants to create, initiate, monitor, manage, and reconcile M-Pesa payments through a modern web interface.

The platform integrates with the **Safaricom Daraja API** to initiate M-Pesa STK Push requests and receive asynchronous payment callbacks.

### Business Model

Merchants subscribe to the platform and pay a subscription fee. The customer's M-Pesa payment goes directly to the merchant's configured M-Pesa destination — the platform does **not** intercept or split payments.

### Payment Lifecycle

\`\`\`
CREATED → PENDING → SUCCESS
                 → FAILED
                 → CANCELLED
                 → TIMEOUT
\`\`\`

### Authentication

All protected endpoints require a **Bearer token** (JWT access token) obtained from \`POST /api/auth/login\`. Tokens are short-lived; use \`POST /api/auth/refresh\` to renew.

### Roles

| Role       | Description                             |
|------------|-----------------------------------------|
| MERCHANT   | Business owner — manages own resources  |
| ADMIN      | Platform administrator — system-wide access |
| CUSTOMER   | End-customer — uses public payment links |
        `.trim(),
        version: VERSION,
        contact: {
            name: "Platform Support",
            email: "support@example.com"
        },
        license: {
            name: "ISC"
        }
    },
    servers: [
        {
            url: "/",
            description: "Current server"
        }
    ],
    tags: [
        { name: "Authentication", description: "Registration, login, token management, password reset, email verification" },
        { name: "Payments", description: "M-Pesa STK Push initiation and payment record management" },
        { name: "Transactions", description: "Financial transaction records linked to payments" },
        { name: "Invoices", description: "Invoice creation, management, and payment association" },
        { name: "Payment Links", description: "Shareable payment links that customers open directly" },
        { name: "Public", description: "Unauthenticated endpoints for customer payment pages" },
        { name: "Analytics", description: "Dashboard statistics, revenue reports, and transaction exports" },
        { name: "Notifications", description: "In-app notification management" },
        { name: "Admin", description: "Administrative endpoints for webhook events and audit logs" },
        { name: "Health", description: "System health and availability checks" }
    ],
    components: {
        securitySchemes: {
            BearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
                description: "JWT access token obtained from `POST /api/auth/login`"
            }
        },
        schemas: {
            // ----------------------------------------------------------------
            // Generic
            // ----------------------------------------------------------------
            ErrorResponse: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: false },
                    message: { type: "string", example: "Payment not found" },
                    code: { type: "string", example: "PAYMENT_NOT_FOUND" }
                },
                required: ["success", "message"]
            },
            ValidationError: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: false },
                    message: { type: "string", example: "Validation failed" },
                    errors: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                field: { type: "string" },
                                message: { type: "string" }
                            }
                        }
                    }
                }
            },
            PaginationMeta: {
                type: "object",
                properties: {
                    page: { type: "integer", example: 1 },
                    limit: { type: "integer", example: 25 },
                    total: { type: "integer", example: 100 },
                    totalPages: { type: "integer", example: 4 }
                }
            },
            // ----------------------------------------------------------------
            // Auth
            // ----------------------------------------------------------------
            RegisterRequest: {
                type: "object",
                required: ["name", "email", "password"],
                properties: {
                    name: { type: "string", minLength: 1, maxLength: 120, example: "Jane Wanjiku" },
                    businessName: { type: "string", minLength: 1, maxLength: 160, example: "Wanjiku Tech Solutions" },
                    email: { type: "string", format: "email", example: "jane@wanjiku.co.ke" },
                    password: {
                        type: "string",
                        minLength: 12,
                        maxLength: 128,
                        description: "Must be at least 12 characters and not exceed 72 UTF-8 bytes",
                        example: "SecureP@ssw0rd!"
                    },
                    phoneNumber: {
                        type: "string",
                        pattern: "^254[17]\\d{8}$",
                        description: "Kenyan phone number in international format",
                        example: "254712345678"
                    }
                }
            },
            LoginRequest: {
                type: "object",
                required: ["email", "password"],
                properties: {
                    email: { type: "string", format: "email", example: "jane@wanjiku.co.ke" },
                    password: { type: "string", minLength: 1, maxLength: 128, example: "SecureP@ssw0rd!" }
                }
            },
            AuthTokens: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: true },
                    accessToken: {
                        type: "string",
                        description: "Short-lived JWT access token",
                        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    },
                    refreshToken: {
                        type: "string",
                        description: "Long-lived refresh token — store securely",
                        example: "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4..."
                    },
                    user: {
                        type: "object",
                        properties: {
                            id: { type: "string", format: "uuid" },
                            name: { type: "string" },
                            email: { type: "string", format: "email" },
                            role: { type: "string", enum: ["MERCHANT", "ADMIN", "CUSTOMER"] }
                        }
                    }
                }
            },
            RefreshRequest: {
                type: "object",
                required: ["refreshToken"],
                properties: {
                    refreshToken: { type: "string", minLength: 32, maxLength: 256, example: "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4..." }
                }
            },
            ForgotPasswordRequest: {
                type: "object",
                required: ["email"],
                properties: {
                    email: { type: "string", format: "email", example: "jane@wanjiku.co.ke" }
                }
            },
            ResetPasswordRequest: {
                type: "object",
                required: ["token", "password"],
                properties: {
                    token: { type: "string", minLength: 32, maxLength: 256, example: "abc123resettoken..." },
                    password: { type: "string", minLength: 12, maxLength: 128, example: "NewSecureP@ss!" }
                }
            },
            VerifyEmailRequest: {
                type: "object",
                required: ["token"],
                properties: {
                    token: { type: "string", minLength: 32, maxLength: 256, example: "emailverifytoken..." }
                }
            },
            // ----------------------------------------------------------------
            // Payments
            // ----------------------------------------------------------------
            CreatePaymentRequest: {
                type: "object",
                required: ["amount", "phoneNumber"],
                properties: {
                    amount: {
                        type: "integer",
                        minimum: 1,
                        maximum: 250000,
                        description: "Amount in KES (whole shillings only for STK Push)",
                        example: 5000
                    },
                    phoneNumber: {
                        type: "string",
                        pattern: "^254[17]\\d{8}$",
                        description: "Customer phone number in international format",
                        example: "254712345678"
                    },
                    description: {
                        type: "string",
                        maxLength: 500,
                        description: "Payment description shown on the STK prompt",
                        example: "Website development deposit"
                    }
                }
            },
            Payment: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    merchantId: { type: "string", format: "uuid" },
                    customerId: { type: "string", format: "uuid", nullable: true },
                    reference: { type: "string", example: "PAY-20261003-ABCD" },
                    amount: { type: "integer", example: 5000 },
                    currency: { type: "string", example: "KES" },
                    phoneNumber: { type: "string", example: "254712345678" },
                    description: { type: "string", example: "Website development deposit" },
                    status: {
                        type: "string",
                        enum: ["CREATED", "PENDING", "SUCCESS", "FAILED", "CANCELLED", "TIMEOUT"]
                    },
                    checkoutRequestId: { type: "string", nullable: true, example: "ws_CO_03102026080512345678" },
                    merchantRequestId: { type: "string", nullable: true, example: "12345-67890-1" },
                    mpesaReceiptNumber: { type: "string", nullable: true, example: "QHX1Y2Z3A4" },
                    transactionDate: { type: "string", format: "date-time", nullable: true },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" },
                    completedAt: { type: "string", format: "date-time", nullable: true }
                }
            },
            // ----------------------------------------------------------------
            // Transactions
            // ----------------------------------------------------------------
            Transaction: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    paymentId: { type: "string", format: "uuid" },
                    merchantId: { type: "string", format: "uuid" },
                    amount: { type: "integer", example: 5000 },
                    status: { type: "string", enum: ["SUCCESS", "FAILED", "CANCELLED"] },
                    mpesaReceiptNumber: { type: "string", example: "QHX1Y2Z3A4" },
                    checkoutRequestId: { type: "string", example: "ws_CO_03102026080512345678" },
                    merchantRequestId: { type: "string", example: "12345-67890-1" },
                    phoneNumber: { type: "string", example: "254712345678" },
                    resultCode: { type: "integer", example: 0 },
                    resultDescription: { type: "string", example: "The service request is processed successfully." },
                    transactionDate: { type: "string", format: "date-time" },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" }
                }
            },
            // ----------------------------------------------------------------
            // Invoices
            // ----------------------------------------------------------------
            InvoiceItem: {
                type: "object",
                required: ["description", "quantity", "unitAmount"],
                properties: {
                    description: { type: "string", minLength: 1, maxLength: 300, example: "Website Development" },
                    quantity: { type: "integer", minimum: 1, maximum: 1000000, example: 1 },
                    unitAmount: { type: "number", minimum: 0, example: 20000 }
                }
            },
            CreateInvoiceRequest: {
                type: "object",
                required: ["customer", "items"],
                properties: {
                    invoiceNumber: {
                        type: "string",
                        minLength: 1,
                        maxLength: 64,
                        description: "Optional custom invoice number — auto-generated if omitted",
                        example: "INV-2026-001"
                    },
                    customer: {
                        type: "object",
                        required: ["name", "phoneNumber"],
                        properties: {
                            name: { type: "string", minLength: 1, maxLength: 120, example: "John Kamau" },
                            phoneNumber: { type: "string", pattern: "^254[17]\\d{8}$", example: "254700123456" },
                            email: { type: "string", format: "email", example: "john@example.com" }
                        }
                    },
                    items: {
                        type: "array",
                        minItems: 1,
                        maxItems: 100,
                        items: { $ref: "#/components/schemas/InvoiceItem" }
                    },
                    dueAt: {
                        type: "string",
                        format: "date-time",
                        description: "Invoice due date (ISO 8601 with offset)",
                        example: "2026-10-31T23:59:59+03:00"
                    }
                }
            },
            Invoice: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    merchantId: { type: "string", format: "uuid" },
                    invoiceNumber: { type: "string", example: "INV-2026-001" },
                    status: {
                        type: "string",
                        enum: ["DRAFT", "SENT", "PENDING", "PAID", "OVERDUE", "CANCELLED"]
                    },
                    totalAmount: { type: "number", example: 23000 },
                    currency: { type: "string", example: "KES" },
                    customer: {
                        type: "object",
                        properties: {
                            name: { type: "string", example: "John Kamau" },
                            phoneNumber: { type: "string", example: "254700123456" },
                            email: { type: "string", format: "email", nullable: true }
                        }
                    },
                    items: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                description: { type: "string" },
                                quantity: { type: "integer" },
                                unitAmount: { type: "number" },
                                lineTotal: { type: "number" }
                            }
                        }
                    },
                    dueAt: { type: "string", format: "date-time", nullable: true },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" }
                }
            },
            // ----------------------------------------------------------------
            // Payment Links
            // ----------------------------------------------------------------
            CreatePaymentLinkRequest: {
                type: "object",
                required: ["description", "amount"],
                properties: {
                    description: { type: "string", minLength: 1, maxLength: 500, example: "Website development payment" },
                    amount: { type: "integer", minimum: 1, maximum: 250000, example: 5000 },
                    expiresAt: {
                        type: "string",
                        format: "date-time",
                        description: "Optional expiry date (ISO 8601 with offset)",
                        example: "2026-11-01T00:00:00+03:00"
                    }
                }
            },
            PaymentLink: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    merchantId: { type: "string", format: "uuid" },
                    reference: { type: "string", example: "plink_A1B2C3D4E5F6G7H8I9J0" },
                    description: { type: "string", example: "Website development payment" },
                    amount: { type: "integer", example: 5000 },
                    currency: { type: "string", example: "KES" },
                    isActive: { type: "boolean", example: true },
                    expiresAt: { type: "string", format: "date-time", nullable: true },
                    payUrl: { type: "string", example: "https://example.com/pay/plink_A1B2C3D4E5F6G7H8I9J0" },
                    createdAt: { type: "string", format: "date-time" }
                }
            },
            PublicPaymentLinkInfo: {
                type: "object",
                properties: {
                    businessName: { type: "string", example: "Wanjiku Tech Solutions" },
                    description: { type: "string", example: "Website development payment" },
                    amount: { type: "integer", example: 5000 },
                    currency: { type: "string", example: "KES" },
                    isActive: { type: "boolean", example: true }
                }
            },
            PayPublicLinkRequest: {
                type: "object",
                required: ["phoneNumber"],
                properties: {
                    phoneNumber: { type: "string", pattern: "^254[17]\\d{8}$", example: "254712345678" }
                }
            },
            // ----------------------------------------------------------------
            // Analytics
            // ----------------------------------------------------------------
            DashboardStats: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: true },
                    data: {
                        type: "object",
                        properties: {
                            totalRevenue: { type: "number", example: 154200 },
                            successfulPayments: { type: "integer", example: 82 },
                            pendingPayments: { type: "integer", example: 4 },
                            failedPayments: { type: "integer", example: 7 },
                            revenueSeries: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        date: { type: "string", example: "2026-10-01" },
                                        revenue: { type: "number", example: 12500 },
                                        count: { type: "integer", example: 5 }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            // ----------------------------------------------------------------
            // Notifications
            // ----------------------------------------------------------------
            Notification: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    userId: { type: "string", format: "uuid" },
                    type: { type: "string", example: "PAYMENT_RECEIVED" },
                    title: { type: "string", example: "Payment Received" },
                    message: { type: "string", example: "Payment of KES 5,000 received from John Kamau." },
                    isRead: { type: "boolean", example: false },
                    createdAt: { type: "string", format: "date-time" }
                }
            },
            // ----------------------------------------------------------------
            // Admin — Webhook Events
            // ----------------------------------------------------------------
            WebhookEvent: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    eventType: { type: "string", example: "STK_CALLBACK" },
                    provider: { type: "string", example: "MPESA" },
                    payload: { type: "object", description: "Raw provider payload" },
                    status: { type: "string", enum: ["PENDING", "PROCESSED", "FAILED"] },
                    attempts: { type: "integer", example: 1 },
                    processedAt: { type: "string", format: "date-time", nullable: true },
                    createdAt: { type: "string", format: "date-time" }
                }
            },
            // ----------------------------------------------------------------
            // Admin — Audit Logs
            // ----------------------------------------------------------------
            AuditLog: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    userId: { type: "string", format: "uuid", nullable: true },
                    action: { type: "string", example: "PAYMENT_CREATED" },
                    resourceType: { type: "string", example: "payment" },
                    resourceId: { type: "string", format: "uuid", nullable: true },
                    metadata: { type: "object", nullable: true },
                    ipAddress: { type: "string", example: "41.90.64.200" },
                    createdAt: { type: "string", format: "date-time" }
                }
            }
        },
        responses: {
            Unauthorized: {
                description: "Authentication required or access token expired",
                content: {
                    "application/json": {
                        schema: { $ref: "#/components/schemas/ErrorResponse" },
                        example: { success: false, message: "Unauthorized", code: "UNAUTHORIZED" }
                    }
                }
            },
            Forbidden: {
                description: "Authenticated but not authorised for this action",
                content: {
                    "application/json": {
                        schema: { $ref: "#/components/schemas/ErrorResponse" },
                        example: { success: false, message: "Forbidden", code: "FORBIDDEN" }
                    }
                }
            },
            NotFound: {
                description: "Requested resource was not found",
                content: {
                    "application/json": {
                        schema: { $ref: "#/components/schemas/ErrorResponse" },
                        example: { success: false, message: "Not found", code: "NOT_FOUND" }
                    }
                }
            },
            ValidationError: {
                description: "Request body or query parameters failed validation",
                content: {
                    "application/json": {
                        schema: { $ref: "#/components/schemas/ValidationError" }
                    }
                }
            },
            TooManyRequests: {
                description: "Rate limit exceeded",
                content: {
                    "application/json": {
                        schema: { $ref: "#/components/schemas/ErrorResponse" },
                        example: { success: false, message: "Too many requests. Please try again later.", code: "RATE_LIMITED" }
                    }
                }
            }
        },
        parameters: {
            PageParam: {
                name: "page",
                in: "query",
                schema: { type: "integer", minimum: 1, default: 1 },
                description: "Page number (1-indexed)"
            },
            LimitParam: {
                name: "limit",
                in: "query",
                schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
                description: "Number of records per page"
            }
        }
    },
    paths: {
        // ====================================================================
        // HEALTH
        // ====================================================================
        "/": {
            get: {
                tags: ["Health"],
                summary: "Root health check",
                description: "Returns a simple message confirming the API is reachable.",
                operationId: "getRoot",
                responses: {
                    200: {
                        description: "API is running",
                        content: {
                            "application/json": {
                                example: { success: true, message: "Welcome to the homepage" }
                            }
                        }
                    }
                }
            }
        },
        "/health": {
            get: {
                tags: ["Health"],
                summary: "Deep system health & dependency monitor",
                description: "Checks PostgreSQL database connectivity, system uptime, and memory usage. Returns 200 when healthy, or 503 if any core dependency fails.",
                operationId: "getHealth",
                responses: {
                    200: {
                        description: "All services healthy",
                        content: {
                            "application/json": {
                                example: {
                                    status: "healthy",
                                    timestamp: "2026-10-03T08:30:00.000Z",
                                    environment: "production",
                                    version: "1.0.0",
                                    durationMs: 2.15,
                                    checks: {
                                        database: { status: "up", latencyMs: 1.45 },
                                        system: { uptimeSeconds: 1420, memoryUsage: { rssMb: 52, heapUsedMb: 24 } }
                                    }
                                }
                            }
                        }
                    },
                    503: {
                        description: "Service degraded — database unreachable",
                        content: {
                            "application/json": {
                                example: {
                                    status: "degraded",
                                    timestamp: "2026-10-03T08:30:00.000Z",
                                    environment: "production",
                                    version: "1.0.0",
                                    checks: {
                                        database: { status: "down", error: "Connection terminated" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

        // ====================================================================
        // AUTHENTICATION
        // ====================================================================
        "/api/auth/register": {
            post: {
                tags: ["Authentication"],
                summary: "Register a new account",
                description: `
Creates a new user account.

- Providing **businessName** will automatically create a MERCHANT profile.
- A verification email is dispatched asynchronously; the account can be used immediately but email verification may gate certain features.
                `.trim(),
                operationId: "register",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/RegisterRequest" },
                            example: {
                                name: "Jane Wanjiku",
                                businessName: "Wanjiku Tech Solutions",
                                email: "jane@wanjiku.co.ke",
                                password: "SecureP@ssw0rd!",
                                phoneNumber: "254712345678"
                            }
                        }
                    }
                },
                responses: {
                    201: {
                        description: "Account created — tokens returned immediately",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/AuthTokens" }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    409: {
                        description: "Email address is already registered",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/ErrorResponse" },
                                example: { success: false, message: "Email already in use", code: "EMAIL_CONFLICT" }
                            }
                        }
                    },
                    429: { $ref: "#/components/responses/TooManyRequests" }
                }
            }
        },
        "/api/auth/login": {
            post: {
                tags: ["Authentication"],
                summary: "Log in and obtain tokens",
                description: "Authenticates a user with email and password. Returns a short-lived access token and a long-lived refresh token.",
                operationId: "login",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/LoginRequest" },
                            example: { email: "jane@wanjiku.co.ke", password: "SecureP@ssw0rd!" }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "Login successful",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/AuthTokens" }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    401: {
                        description: "Invalid credentials",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/ErrorResponse" },
                                example: { success: false, message: "Invalid email or password", code: "INVALID_CREDENTIALS" }
                            }
                        }
                    },
                    429: { $ref: "#/components/responses/TooManyRequests" }
                }
            }
        },
        "/api/auth/refresh": {
            post: {
                tags: ["Authentication"],
                summary: "Refresh the access token",
                description: "Exchanges a valid refresh token for a new access token and a rotated refresh token. The old refresh token is invalidated.",
                operationId: "refreshToken",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/RefreshRequest" }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "New tokens issued",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/AuthTokens" }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    401: { $ref: "#/components/responses/Unauthorized" }
                }
            }
        },
        "/api/auth/logout": {
            post: {
                tags: ["Authentication"],
                summary: "Log out",
                description: "Revokes the provided refresh token so it can no longer be used to obtain new access tokens.",
                operationId: "logout",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/RefreshRequest" }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "Logged out successfully",
                        content: {
                            "application/json": {
                                example: { success: true, message: "Logged out" }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" }
                }
            }
        },
        "/api/auth/password/forgot": {
            post: {
                tags: ["Authentication"],
                summary: "Request a password-reset email",
                description: "Sends a password-reset link to the provided email address. Responds with a generic success message whether or not the email exists (to avoid user enumeration).",
                operationId: "forgotPassword",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/ForgotPasswordRequest" }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "Request acknowledged",
                        content: {
                            "application/json": {
                                example: { success: true, message: "If that email is registered you will receive a reset link." }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    429: { $ref: "#/components/responses/TooManyRequests" }
                }
            }
        },
        "/api/auth/password/reset": {
            post: {
                tags: ["Authentication"],
                summary: "Complete password reset",
                description: "Sets a new password using the token received by email. The token is single-use and expires after a short period.",
                operationId: "resetPassword",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/ResetPasswordRequest" }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "Password changed successfully",
                        content: {
                            "application/json": {
                                example: { success: true, message: "Password has been reset." }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    401: {
                        description: "Token invalid or expired",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/ErrorResponse" },
                                example: { success: false, message: "Token is invalid or has expired", code: "TOKEN_INVALID" }
                            }
                        }
                    },
                    429: { $ref: "#/components/responses/TooManyRequests" }
                }
            }
        },
        "/api/auth/email/verify": {
            post: {
                tags: ["Authentication"],
                summary: "Verify email address (POST)",
                description: "Verifies an email address using the token sent at registration.",
                operationId: "verifyEmail",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/VerifyEmailRequest" }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "Email verified",
                        content: {
                            "application/json": {
                                example: { success: true, message: "Email verified successfully." }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    401: {
                        description: "Token invalid or expired",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/ErrorResponse" }
                            }
                        }
                    },
                    429: { $ref: "#/components/responses/TooManyRequests" }
                }
            }
        },
        "/api/auth/verify-email": {
            get: {
                tags: ["Authentication"],
                summary: "Verify email address (GET link)",
                description: "Verifies email using a token passed as a query parameter. Designed for click-through links in verification emails.",
                operationId: "verifyEmailGet",
                parameters: [
                    {
                        name: "token",
                        in: "query",
                        required: true,
                        schema: { type: "string" },
                        description: "Email verification token from the registration email"
                    }
                ],
                responses: {
                    200: {
                        description: "Email verified",
                        content: {
                            "application/json": {
                                example: { success: true, message: "Email verified successfully." }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    429: { $ref: "#/components/responses/TooManyRequests" }
                }
            }
        },
        "/api/auth/email/resend-verification": {
            post: {
                tags: ["Authentication"],
                summary: "Resend verification email",
                description: "Re-dispatches the email verification message. Responds generically to avoid user enumeration.",
                operationId: "resendVerification",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/ForgotPasswordRequest" }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "Request acknowledged",
                        content: {
                            "application/json": {
                                example: { success: true, message: "If that email is registered and unverified a new link has been sent." }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    429: { $ref: "#/components/responses/TooManyRequests" }
                }
            }
        },

        // ====================================================================
        // PAYMENTS
        // ====================================================================
        "/api/payments": {
            post: {
                tags: ["Payments"],
                summary: "Initiate an M-Pesa STK Push payment",
                description: `
Creates a payment record and immediately initiates an M-Pesa STK Push request to the customer's phone number.

**Lifecycle:**
1. A payment record is created with status \`CREATED\`.
2. The STK Push is sent to Safaricom.
3. If Safaricom accepts the request the status moves to \`PENDING\`.
4. Safaricom delivers the final result asynchronously via the callback endpoint — the status then becomes \`SUCCESS\`, \`FAILED\`, or \`CANCELLED\`.

**Idempotency:** Duplicate requests with the same payload within a short window will return the existing payment rather than creating a new STK Push.
                `.trim(),
                operationId: "initiatePayment",
                security: [{ BearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/CreatePaymentRequest" },
                            example: {
                                amount: 5000,
                                phoneNumber: "254712345678",
                                description: "Website development deposit"
                            }
                        }
                    }
                },
                responses: {
                    201: {
                        description: "STK Push initiated — awaiting customer PIN",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        message: { type: "string", example: "STK Push initiated. Ask the customer to check their phone." },
                                        data: { $ref: "#/components/schemas/Payment" }
                                    }
                                }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" },
                    422: {
                        description: "Safaricom rejected the STK Push request",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/ErrorResponse" }
                            }
                        }
                    },
                    429: { $ref: "#/components/responses/TooManyRequests" }
                }
            },
            get: {
                tags: ["Payments"],
                summary: "List merchant payments",
                description: "Returns a paginated list of payments belonging to the authenticated merchant. Results can be filtered by status or searched by reference, phone number, or receipt number.",
                operationId: "listPayments",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "status",
                        in: "query",
                        schema: { type: "string", enum: ["CREATED", "PENDING", "SUCCESS", "FAILED", "CANCELLED", "TIMEOUT"] },
                        description: "Filter by payment status"
                    },
                    {
                        name: "search",
                        in: "query",
                        schema: { type: "string", maxLength: 100 },
                        description: "Search across reference, phone number, and receipt number"
                    },
                    { $ref: "#/components/parameters/PageParam" },
                    { $ref: "#/components/parameters/LimitParam" }
                ],
                responses: {
                    200: {
                        description: "Paginated list of payments",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { type: "array", items: { $ref: "#/components/schemas/Payment" } },
                                        meta: { $ref: "#/components/schemas/PaginationMeta" }
                                    }
                                }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" }
                }
            }
        },
        "/api/payments/{paymentId}": {
            get: {
                tags: ["Payments"],
                summary: "Get a specific payment",
                description: "Returns a single payment record. The payment must belong to the authenticated merchant.",
                operationId: "getPayment",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "paymentId",
                        in: "path",
                        required: true,
                        schema: { type: "string", format: "uuid" },
                        description: "Payment UUID"
                    }
                ],
                responses: {
                    200: {
                        description: "Payment found",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { $ref: "#/components/schemas/Payment" }
                                    }
                                }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" },
                    404: { $ref: "#/components/responses/NotFound" }
                }
            }
        },

        // ====================================================================
        // TRANSACTIONS
        // ====================================================================
        "/api/transactions/{transactionId}": {
            get: {
                tags: ["Transactions"],
                summary: "Get a transaction record",
                description: "Returns the financial transaction record associated with a payment. The transaction is created when Safaricom delivers the payment callback. The transaction must belong to the authenticated merchant.",
                operationId: "getTransaction",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "transactionId",
                        in: "path",
                        required: true,
                        schema: { type: "string", format: "uuid" },
                        description: "Transaction UUID"
                    }
                ],
                responses: {
                    200: {
                        description: "Transaction found",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { $ref: "#/components/schemas/Transaction" }
                                    }
                                }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" },
                    404: { $ref: "#/components/responses/NotFound" }
                }
            }
        },
        "/api/transactions/{transactionId}/reconcile": {
            post: {
                tags: ["Transactions"],
                summary: "Reconcile a transaction",
                description: `
Manually triggers a reconciliation check for a payment that is in a \`PENDING\` or \`TIMEOUT\` state.

The system queries Safaricom's transaction status API to determine the actual outcome. This is useful when the callback was not received within the expected window.

> **Note:** A \`TIMEOUT\` status does **not** automatically mean the payment failed. Always reconcile before concluding a timeout means non-payment.
                `.trim(),
                operationId: "reconcileTransaction",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "transactionId",
                        in: "path",
                        required: true,
                        schema: { type: "string", format: "uuid" },
                        description: "Transaction UUID"
                    }
                ],
                responses: {
                    200: {
                        description: "Reconciliation complete — updated payment status returned",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { $ref: "#/components/schemas/Payment" }
                                    }
                                }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" },
                    404: { $ref: "#/components/responses/NotFound" }
                }
            }
        },

        // ====================================================================
        // M-PESA CALLBACK (internal / Safaricom → platform)
        // ====================================================================
        "/api/mpesa/callback": {
            post: {
                tags: ["Payments"],
                summary: "M-Pesa payment callback (Safaricom → Platform)",
                description: `
**This endpoint is called by Safaricom, not by your application code.**

It receives the asynchronous payment result after a customer interacts with the STK Push prompt. The endpoint:

1. Records the raw callback payload as a webhook event.
2. Identifies the associated payment via \`CheckoutRequestID\`.
3. Updates the payment status (\`SUCCESS\`, \`FAILED\`, or \`CANCELLED\`).
4. Creates a financial transaction record.
5. Enqueues notification jobs (email, in-app).
6. Records an audit log entry.

The endpoint **must respond quickly** — slow operations are deferred to background workers.

Configure this URL in your Safaricom Daraja application as the \`CallbackURL\`.
                `.trim(),
                operationId: "mpesaCallback",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                description: "Safaricom STK Push callback payload",
                                properties: {
                                    Body: {
                                        type: "object",
                                        properties: {
                                            stkCallback: {
                                                type: "object",
                                                properties: {
                                                    MerchantRequestID: { type: "string" },
                                                    CheckoutRequestID: { type: "string" },
                                                    ResultCode: { type: "integer", example: 0 },
                                                    ResultDesc: { type: "string", example: "The service request is processed successfully." },
                                                    CallbackMetadata: { type: "object" }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "Callback acknowledged",
                        content: {
                            "application/json": {
                                example: { ResultCode: 0, ResultDesc: "Success" }
                            }
                        }
                    }
                }
            }
        },

        // ====================================================================
        // INVOICES
        // ====================================================================
        "/api/invoices": {
            post: {
                tags: ["Invoices"],
                summary: "Create an invoice",
                description: `
Creates a new invoice for a customer.

- If no **invoiceNumber** is provided one is auto-generated.
- The invoice starts in \`DRAFT\` status.
- The total is calculated from \`items[].quantity × items[].unitAmount\`.
- The total **must be a whole KES amount** (no paise) because M-Pesa STK Push only supports integer amounts.
                `.trim(),
                operationId: "createInvoice",
                security: [{ BearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/CreateInvoiceRequest" },
                            example: {
                                invoiceNumber: "INV-2026-001",
                                customer: {
                                    name: "John Kamau",
                                    phoneNumber: "254700123456",
                                    email: "john@example.com"
                                },
                                items: [
                                    { description: "Website Development", quantity: 1, unitAmount: 20000 },
                                    { description: "Hosting (1 year)", quantity: 1, unitAmount: 3000 }
                                ],
                                dueAt: "2026-10-31T23:59:59+03:00"
                            }
                        }
                    }
                },
                responses: {
                    201: {
                        description: "Invoice created",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { $ref: "#/components/schemas/Invoice" }
                                    }
                                }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" }
                }
            },
            get: {
                tags: ["Invoices"],
                summary: "List merchant invoices",
                description: "Returns a paginated list of the authenticated merchant's invoices. Filterable by status and searchable by invoice number or customer name.",
                operationId: "listInvoices",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "status",
                        in: "query",
                        schema: { type: "string", enum: ["DRAFT", "SENT", "PENDING", "PAID", "OVERDUE", "CANCELLED"] },
                        description: "Filter by invoice status"
                    },
                    {
                        name: "search",
                        in: "query",
                        schema: { type: "string", maxLength: 100 },
                        description: "Search by invoice number or customer name"
                    },
                    { $ref: "#/components/parameters/PageParam" },
                    { $ref: "#/components/parameters/LimitParam" }
                ],
                responses: {
                    200: {
                        description: "Paginated list of invoices",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { type: "array", items: { $ref: "#/components/schemas/Invoice" } },
                                        meta: { $ref: "#/components/schemas/PaginationMeta" }
                                    }
                                }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" }
                }
            }
        },
        "/api/invoices/{invoiceId}": {
            get: {
                tags: ["Invoices"],
                summary: "Get a specific invoice",
                description: "Returns a single invoice including its line items. The invoice must belong to the authenticated merchant.",
                operationId: "getInvoice",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "invoiceId",
                        in: "path",
                        required: true,
                        schema: { type: "string", format: "uuid" },
                        description: "Invoice UUID"
                    }
                ],
                responses: {
                    200: {
                        description: "Invoice found",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { $ref: "#/components/schemas/Invoice" }
                                    }
                                }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" },
                    404: { $ref: "#/components/responses/NotFound" }
                }
            }
        },
        "/api/invoices/{invoiceId}/status": {
            patch: {
                tags: ["Invoices"],
                summary: "Update invoice status",
                description: `
Manually changes the status of an invoice.

| Transition | Meaning |
|---|---|
| → \`SENT\` | Mark the invoice as sent to the customer |
| → \`CANCELLED\` | Cancel the invoice |
| → \`OVERDUE\` | Mark as overdue (can also be set automatically by a background job) |

The \`PAID\` status is set automatically when a payment associated with the invoice succeeds.
                `.trim(),
                operationId: "changeInvoiceStatus",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "invoiceId",
                        in: "path",
                        required: true,
                        schema: { type: "string", format: "uuid" },
                        description: "Invoice UUID"
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["status"],
                                properties: {
                                    status: { type: "string", enum: ["SENT", "CANCELLED", "OVERDUE"] }
                                }
                            },
                            example: { status: "SENT" }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "Invoice status updated",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { $ref: "#/components/schemas/Invoice" }
                                    }
                                }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" },
                    404: { $ref: "#/components/responses/NotFound" }
                }
            }
        },
        "/api/invoices/{invoiceId}/payment-link": {
            post: {
                tags: ["Invoices"],
                summary: "Generate a payment link for an invoice",
                description: "Creates a payment link pre-configured with the invoice amount and description. The customer can open the link and pay without needing a merchant dashboard account.",
                operationId: "createInvoicePaymentLink",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "invoiceId",
                        in: "path",
                        required: true,
                        schema: { type: "string", format: "uuid" },
                        description: "Invoice UUID"
                    }
                ],
                responses: {
                    201: {
                        description: "Payment link created",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { $ref: "#/components/schemas/PaymentLink" }
                                    }
                                }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" },
                    404: { $ref: "#/components/responses/NotFound" }
                }
            }
        },

        // ====================================================================
        // PAYMENT LINKS (merchant)
        // ====================================================================
        "/api/payment-links": {
            post: {
                tags: ["Payment Links"],
                summary: "Create a payment link",
                description: "Creates a reusable payment link. The link generates a short reference URL (`/pay/{reference}`) that can be shared with any customer.",
                operationId: "createPaymentLink",
                security: [{ BearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/CreatePaymentLinkRequest" },
                            example: {
                                description: "Website development payment",
                                amount: 5000,
                                expiresAt: "2026-11-01T00:00:00+03:00"
                            }
                        }
                    }
                },
                responses: {
                    201: {
                        description: "Payment link created",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { $ref: "#/components/schemas/PaymentLink" }
                                    }
                                }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" }
                }
            },
            get: {
                tags: ["Payment Links"],
                summary: "List merchant payment links",
                description: "Returns all payment links created by the authenticated merchant.",
                operationId: "listPaymentLinks",
                security: [{ BearerAuth: [] }],
                responses: {
                    200: {
                        description: "List of payment links",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { type: "array", items: { $ref: "#/components/schemas/PaymentLink" } }
                                    }
                                }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" }
                }
            }
        },
        "/api/payment-links/{linkId}": {
            delete: {
                tags: ["Payment Links"],
                summary: "Deactivate a payment link",
                description: "Deactivates a payment link so it can no longer accept payments. The link record is retained for audit purposes.",
                operationId: "deactivatePaymentLink",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "linkId",
                        in: "path",
                        required: true,
                        schema: { type: "string", format: "uuid" },
                        description: "Payment link UUID"
                    }
                ],
                responses: {
                    200: {
                        description: "Link deactivated",
                        content: {
                            "application/json": {
                                example: { success: true, message: "Payment link deactivated." }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" },
                    404: { $ref: "#/components/responses/NotFound" }
                }
            }
        },

        // ====================================================================
        // PUBLIC PAYMENT LINK ENDPOINTS
        // ====================================================================
        "/api/public/payment-links/{reference}": {
            get: {
                tags: ["Public"],
                summary: "Get public payment link info",
                description: "Returns publicly visible information about a payment link. Used by the customer payment page to display the business name, description, and amount before the customer enters their phone number.",
                operationId: "getPublicPaymentLink",
                parameters: [
                    {
                        name: "reference",
                        in: "path",
                        required: true,
                        schema: { type: "string", pattern: "^[A-Za-z0-9_-]{20,64}$" },
                        description: "Payment link reference token",
                        example: "plink_A1B2C3D4E5F6G7H8I9J0"
                    }
                ],
                responses: {
                    200: {
                        description: "Payment link info",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { $ref: "#/components/schemas/PublicPaymentLinkInfo" }
                                    }
                                }
                            }
                        }
                    },
                    404: { $ref: "#/components/responses/NotFound" },
                    410: {
                        description: "Payment link is inactive or expired",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/ErrorResponse" },
                                example: { success: false, message: "This payment link is no longer active.", code: "LINK_INACTIVE" }
                            }
                        }
                    }
                }
            }
        },
        "/api/public/payment-links/{reference}/pay": {
            post: {
                tags: ["Public"],
                summary: "Pay via a public payment link",
                description: `
Initiates an M-Pesa STK Push for the customer. The customer provides only their phone number — the amount and description are taken from the payment link.

This endpoint does **not** require authentication.

After a successful response the customer should check their phone for the M-Pesa PIN prompt. Poll \`GET /api/public/payment-links/{reference}/payments/{paymentId}/status\` to track the outcome.
                `.trim(),
                operationId: "payPublicLink",
                parameters: [
                    {
                        name: "reference",
                        in: "path",
                        required: true,
                        schema: { type: "string", pattern: "^[A-Za-z0-9_-]{20,64}$" },
                        description: "Payment link reference token"
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/PayPublicLinkRequest" },
                            example: { phoneNumber: "254712345678" }
                        }
                    }
                },
                responses: {
                    201: {
                        description: "STK Push initiated",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        message: { type: "string", example: "Check your phone for the M-Pesa PIN prompt." },
                                        data: {
                                            type: "object",
                                            properties: {
                                                paymentId: { type: "string", format: "uuid", description: "Use this ID to poll for payment status" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    404: { $ref: "#/components/responses/NotFound" },
                    410: {
                        description: "Payment link is inactive or expired",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/ErrorResponse" }
                            }
                        }
                    },
                    429: { $ref: "#/components/responses/TooManyRequests" }
                }
            }
        },
        "/api/public/payment-links/{reference}/payments/{paymentId}/status": {
            get: {
                tags: ["Public"],
                summary: "Poll public payment status",
                description: `
Returns the current status of a payment initiated through a public payment link.

Recommended polling strategy:
- Poll every **3 seconds**.
- Stop when status is \`SUCCESS\`, \`FAILED\`, \`CANCELLED\`, or \`TIMEOUT\`.
- Stop after **90 seconds** regardless of status.

A \`TIMEOUT\` means the system did not receive a Safaricom callback within the expected window. It does **not** confirm that no payment was made.
                `.trim(),
                operationId: "getPublicPaymentStatus",
                parameters: [
                    {
                        name: "reference",
                        in: "path",
                        required: true,
                        schema: { type: "string", pattern: "^[A-Za-z0-9_-]{20,64}$" },
                        description: "Payment link reference token"
                    },
                    {
                        name: "paymentId",
                        in: "path",
                        required: true,
                        schema: { type: "string", format: "uuid" },
                        description: "Payment UUID returned from the pay endpoint"
                    }
                ],
                responses: {
                    200: {
                        description: "Current payment status",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: {
                                            type: "object",
                                            properties: {
                                                status: { type: "string", enum: ["CREATED", "PENDING", "SUCCESS", "FAILED", "CANCELLED", "TIMEOUT"] },
                                                mpesaReceiptNumber: { type: "string", nullable: true, example: "QHX1Y2Z3A4" },
                                                amount: { type: "integer", example: 5000 },
                                                currency: { type: "string", example: "KES" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    404: { $ref: "#/components/responses/NotFound" }
                }
            }
        },

        // ====================================================================
        // ANALYTICS
        // ====================================================================
        "/api/analytics/dashboard": {
            get: {
                tags: ["Analytics"],
                summary: "Get dashboard statistics",
                description: `
Returns aggregated payment statistics for the merchant dashboard.

Includes:
- Total revenue (successful payments)
- Payment counts by status
- Revenue time series (for charts)
- Configurable date range and interval (\`day\`, \`week\`, \`month\`)
                `.trim(),
                operationId: "getDashboard",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "from",
                        in: "query",
                        schema: { type: "string", format: "date", example: "2026-10-01" },
                        description: "Start date (YYYY-MM-DD)"
                    },
                    {
                        name: "to",
                        in: "query",
                        schema: { type: "string", format: "date", example: "2026-10-31" },
                        description: "End date (YYYY-MM-DD, max 366 days after from)"
                    },
                    {
                        name: "interval",
                        in: "query",
                        schema: { type: "string", enum: ["day", "week", "month"], default: "day" },
                        description: "Aggregation interval for the revenue time series"
                    }
                ],
                responses: {
                    200: {
                        description: "Dashboard statistics",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/DashboardStats" }
                            }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" }
                }
            }
        },
        "/api/analytics/reports/transactions": {
            get: {
                tags: ["Analytics"],
                summary: "Export transaction report",
                description: `
Generates and downloads a transaction report for the merchant.

Supported formats:
- \`csv\` — comma-separated values (default)
- \`xlsx\` — Microsoft Excel
- \`pdf\` — PDF document

The date range must not exceed 366 calendar days.
                `.trim(),
                operationId: "exportTransactionReport",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "from",
                        in: "query",
                        schema: { type: "string", format: "date", example: "2026-10-01" },
                        description: "Start date (YYYY-MM-DD)"
                    },
                    {
                        name: "to",
                        in: "query",
                        schema: { type: "string", format: "date", example: "2026-10-31" },
                        description: "End date (YYYY-MM-DD)"
                    },
                    {
                        name: "format",
                        in: "query",
                        schema: { type: "string", enum: ["csv", "xlsx", "pdf"], default: "csv" },
                        description: "Output format"
                    }
                ],
                responses: {
                    200: {
                        description: "Report file",
                        content: {
                            "text/csv": { schema: { type: "string", format: "binary" } },
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } },
                            "application/pdf": { schema: { type: "string", format: "binary" } }
                        }
                    },
                    400: { $ref: "#/components/responses/ValidationError" },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" }
                }
            }
        },

        // ====================================================================
        // NOTIFICATIONS
        // ====================================================================
        "/api/notifications": {
            get: {
                tags: ["Notifications"],
                summary: "List notifications",
                description: "Returns a paginated list of in-app notifications for the authenticated user.",
                operationId: "listNotifications",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "isRead",
                        in: "query",
                        schema: { type: "boolean" },
                        description: "Filter by read status"
                    },
                    { $ref: "#/components/parameters/PageParam" },
                    { $ref: "#/components/parameters/LimitParam" }
                ],
                responses: {
                    200: {
                        description: "Paginated notifications",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { type: "array", items: { $ref: "#/components/schemas/Notification" } },
                                        meta: { $ref: "#/components/schemas/PaginationMeta" }
                                    }
                                }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" }
                }
            }
        },
        "/api/notifications/read-all": {
            patch: {
                tags: ["Notifications"],
                summary: "Mark all notifications as read",
                description: "Marks every unread notification for the authenticated user as read.",
                operationId: "markAllNotificationsRead",
                security: [{ BearerAuth: [] }],
                responses: {
                    200: {
                        description: "All notifications marked as read",
                        content: {
                            "application/json": {
                                example: { success: true, message: "All notifications marked as read." }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" }
                }
            }
        },
        "/api/notifications/{notificationId}/read": {
            patch: {
                tags: ["Notifications"],
                summary: "Mark a notification as read",
                description: "Marks a single notification as read.",
                operationId: "markNotificationRead",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "notificationId",
                        in: "path",
                        required: true,
                        schema: { type: "string", format: "uuid" },
                        description: "Notification UUID"
                    }
                ],
                responses: {
                    200: {
                        description: "Notification marked as read",
                        content: {
                            "application/json": {
                                example: { success: true, message: "Notification marked as read." }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    404: { $ref: "#/components/responses/NotFound" }
                }
            }
        },

        // ====================================================================
        // ADMIN — WEBHOOK EVENTS
        // ====================================================================
        "/api/admin/webhook-events": {
            get: {
                tags: ["Admin"],
                summary: "List webhook events",
                description: "Returns a paginated list of all webhook events received by the platform. Requires ADMIN role.",
                operationId: "listWebhookEvents",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "status",
                        in: "query",
                        schema: { type: "string", enum: ["PENDING", "PROCESSED", "FAILED"] },
                        description: "Filter by processing status"
                    },
                    {
                        name: "provider",
                        in: "query",
                        schema: { type: "string", example: "MPESA" },
                        description: "Filter by provider"
                    },
                    { $ref: "#/components/parameters/PageParam" },
                    { $ref: "#/components/parameters/LimitParam" }
                ],
                responses: {
                    200: {
                        description: "Paginated webhook events",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { type: "array", items: { $ref: "#/components/schemas/WebhookEvent" } },
                                        meta: { $ref: "#/components/schemas/PaginationMeta" }
                                    }
                                }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" }
                }
            }
        },
        "/api/admin/webhook-events/{eventId}/retry": {
            post: {
                tags: ["Admin"],
                summary: "Retry a failed webhook event",
                description: "Manually re-triggers processing of a webhook event that previously failed. Requires ADMIN role.",
                operationId: "retryWebhookEvent",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "eventId",
                        in: "path",
                        required: true,
                        schema: { type: "string", format: "uuid" },
                        description: "Webhook event UUID"
                    }
                ],
                responses: {
                    200: {
                        description: "Retry enqueued or completed",
                        content: {
                            "application/json": {
                                example: { success: true, message: "Webhook event requeued for processing." }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" },
                    404: { $ref: "#/components/responses/NotFound" }
                }
            }
        },

        // ====================================================================
        // ADMIN — AUDIT LOGS
        // ====================================================================
        "/api/admin/audit-logs": {
            get: {
                tags: ["Admin"],
                summary: "List audit logs",
                description: "Returns a paginated, reverse-chronological list of audit log entries. Filterable by user, action type, and date range. Requires ADMIN role.",
                operationId: "listAuditLogs",
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: "userId",
                        in: "query",
                        schema: { type: "string", format: "uuid" },
                        description: "Filter by user UUID"
                    },
                    {
                        name: "action",
                        in: "query",
                        schema: { type: "string", example: "PAYMENT_CREATED" },
                        description: "Filter by audit action type"
                    },
                    {
                        name: "from",
                        in: "query",
                        schema: { type: "string", format: "date", example: "2026-10-01" },
                        description: "Start date"
                    },
                    {
                        name: "to",
                        in: "query",
                        schema: { type: "string", format: "date", example: "2026-10-31" },
                        description: "End date"
                    },
                    { $ref: "#/components/parameters/PageParam" },
                    { $ref: "#/components/parameters/LimitParam" }
                ],
                responses: {
                    200: {
                        description: "Paginated audit logs",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { type: "array", items: { $ref: "#/components/schemas/AuditLog" } },
                                        meta: { $ref: "#/components/schemas/PaginationMeta" }
                                    }
                                }
                            }
                        }
                    },
                    401: { $ref: "#/components/responses/Unauthorized" },
                    403: { $ref: "#/components/responses/Forbidden" }
                }
            }
        }
    },
    security: [] // No global security — each operation declares its own
};
