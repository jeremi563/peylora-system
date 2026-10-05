/**
 * API documentation routes — Phase 14.
 *
 * Mounts Swagger UI at /api/docs and exposes the raw OpenAPI JSON
 * document at /api/docs.json.
 *
 * The UI and JSON endpoint are only available in non-production
 * environments by default. Set ENABLE_API_DOCS=true to expose them
 * in production when needed (e.g. for demo/staging purposes).
 */

import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "../config/swagger.js";

const router = Router();

const docsEnabled =
    process.env.NODE_ENV !== "production" || process.env.ENABLE_API_DOCS === "true";

if (docsEnabled) {
    // Serve the raw OpenAPI JSON document.
    router.get("/api/docs.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.json(swaggerSpec);
    });

    // Swagger UI — interactive browser for the API documentation.
    const uiOptions = {
        customSiteTitle: "M-Pesa Platform API Docs",
        customCss: `
            body { background: #f5faf3; }
            .swagger-ui { color: #1d3823; font-family: "DM Sans", sans-serif; }
            .swagger-ui .topbar {
                background: linear-gradient(120deg, #1d5728 0%, #102b19 100%);
            }
            .topbar-wrapper img { display: none; }
            .topbar-wrapper::before {
                content: "M-Pesa Payment Platform";
                font-size: 1.2rem;
                font-weight: 700;
                color: #ffffff;
            }
            .swagger-ui .info .title,
            .swagger-ui .opblock-tag,
            .swagger-ui .opblock-tag small { color: #1d3823; }
            .swagger-ui .scheme-container,
            .swagger-ui .opblock,
            .swagger-ui section.models { background: #ffffff; }
            .swagger-ui .opblock.opblock-post { border-color: #48d635; }
            .swagger-ui .opblock.opblock-post .opblock-summary {
                border-color: #48d635;
                background: #edffe9;
            }
            .swagger-ui .btn.authorize,
            .swagger-ui .btn.execute {
                border-color: #48d635;
                background: #48d635;
                color: #17351b;
                box-shadow: none;
            }
            .swagger-ui .btn.authorize:hover,
            .swagger-ui .btn.execute:hover { background: #3ac72a; }
            .swagger-ui .opblock.opblock-get { border-color: #39749a; }
            .swagger-ui .opblock.opblock-delete { border-color: #b44f49; }
            .swagger-ui .opblock.opblock-patch { border-color: #b67832; }
            .swagger-ui input:focus,
            .swagger-ui select:focus,
            .swagger-ui textarea:focus {
                border-color: #48d635;
                box-shadow: 0 0 0 2px rgba(72, 214, 53, .2);
            }
        `.trim(),
        swaggerOptions: {
            // Collapse all operations by default for a cleaner first view.
            docExpansion: "none",
            // Allow trying requests from the UI even when behind a proxy.
            tryItOutEnabled: true,
            // Persist auth across page refreshes in the UI.
            persistAuthorization: true,
            filter: true
        }
    };

    router.use("/api/docs", swaggerUi.serve);
    router.get("/api/docs", swaggerUi.setup(swaggerSpec, uiOptions));
}

export default router;
