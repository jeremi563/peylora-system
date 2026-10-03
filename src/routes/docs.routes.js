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
            .topbar-wrapper img { display: none; }
            .topbar-wrapper::before {
                content: "M-Pesa Payment Platform";
                font-size: 1.2rem;
                font-weight: 700;
                color: #ffffff;
            }
            .swagger-ui .info .title { color: #1b5e20; }
            .swagger-ui .opblock.opblock-post { border-color: #4caf50; }
            .swagger-ui .opblock.opblock-get  { border-color: #1565c0; }
            .swagger-ui .opblock.opblock-delete { border-color: #b71c1c; }
            .swagger-ui .opblock.opblock-patch  { border-color: #e65100; }
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
