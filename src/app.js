import express from "express";
import helmet from "helmet";

import authRoutes from "./routes/auth.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import docsRoutes from "./routes/docs.routes.js";
import healthRoutes from "./routes/health.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";
import merchantRoutes from "./routes/merchant.routes.js";
import mpesaRoutes from "./routes/mpesa.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import paymentLinkRoutes from "./routes/payment-link.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";
import {
	apiErrorHandler,
	apiRateLimit,
	corsMiddleware,
	enforceHttps,
	requestContext
} from "./middleware/security.js";

const app = express();

app.disable("x-powered-by");
app.use(requestContext);

// Swagger UI requires relaxed CSP for its own inline scripts/styles.
// Apply that only on the /api/docs routes; everywhere else keeps a strict policy.
const helmetStrict = helmet();
const helmetDocs = helmet({
	contentSecurityPolicy: {
		directives: {
			defaultSrc: ["'self'"],
			scriptSrc: ["'self'", "'unsafe-inline'"],
			styleSrc: ["'self'", "'unsafe-inline'", "https:"],
			imgSrc: ["'self'", "data:", "https:"],
			workerSrc: ["'self'", "blob:"]
		}
	}
});

app.use((req, res, next) => {
	if (req.path.startsWith("/api/docs")) {
		return helmetDocs(req, res, next);
	}
	return helmetStrict(req, res, next);
});

app.use(corsMiddleware);
app.use(enforceHttps);

app.use("/api", apiRateLimit);
app.use(express.json({ limit: "64kb", strict: true }));
app.use("/api/auth", authRoutes);
app.use(analyticsRoutes);
app.use(invoiceRoutes);
app.use("/api/merchants", merchantRoutes);
app.use(paymentLinkRoutes);
app.use(notificationRoutes);
app.use(webhookRoutes);
app.use(mpesaRoutes);
app.use(healthRoutes);
app.use(docsRoutes);
app.use(apiErrorHandler);

export default app;