import { Router } from "express";

import {
    changeInvoiceStatus,
    createInvoiceLink,
    createMerchantInvoice,
    getInvoice,
    listInvoices
} from "../controllers/invoice.controller.js";
import { authenticateAccessToken, authorizeRoles } from "../middleware/authentication.js";
import { validateParam, validateQuery, validateRequest } from "../middleware/validate-request.js";
import {
    createInvoiceSchema,
    invoiceIdSchema,
    invoiceListSchema,
    invoiceStatusSchema
} from "../validators/invoice.schemas.js";

const router = Router();
const merchantAccess = [authenticateAccessToken, authorizeRoles("MERCHANT")];

router.post("/api/invoices", ...merchantAccess, validateRequest(createInvoiceSchema), createMerchantInvoice);
router.get("/api/invoices", ...merchantAccess, validateQuery(invoiceListSchema), listInvoices);
router.get(
    "/api/invoices/:invoiceId",
    ...merchantAccess,
    validateParam(invoiceIdSchema, "invoiceId"),
    getInvoice
);
router.patch(
    "/api/invoices/:invoiceId/status",
    ...merchantAccess,
    validateParam(invoiceIdSchema, "invoiceId"),
    validateRequest(invoiceStatusSchema),
    changeInvoiceStatus
);
router.post(
    "/api/invoices/:invoiceId/payment-link",
    ...merchantAccess,
    validateParam(invoiceIdSchema, "invoiceId"),
    createInvoiceLink
);

export default router;