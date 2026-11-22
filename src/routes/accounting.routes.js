import { Router } from "express";

import {
    allocateInvoiceCredit,
    allocateOldestCredit,
    reverseAllocation
} from "../controllers/accounting.controller.js";
import { authenticateAccessToken, authorizeRoles } from "../middleware/authentication.js";
import { validateParam, validateRequest } from "../middleware/validate-request.js";
import {
    allocationAmountSchema,
    allocationIdSchema,
    customerIdSchema,
    invoiceIdSchema
} from "../validators/accounting.schemas.js";

const router = Router();
const merchantAccess = [authenticateAccessToken, authorizeRoles("MERCHANT")];

router.post(
    "/api/invoices/:invoiceId/allocate-credit",
    ...merchantAccess,
    validateParam(invoiceIdSchema, "invoiceId"),
    validateRequest(allocationAmountSchema),
    allocateInvoiceCredit
);

router.post(
    "/api/customers/:customerId/credit/allocate-oldest",
    ...merchantAccess,
    validateParam(customerIdSchema, "customerId"),
    validateRequest(allocationAmountSchema),
    allocateOldestCredit
);

router.post(
    "/api/payment-allocations/:allocationId/reverse",
    ...merchantAccess,
    validateParam(allocationIdSchema, "allocationId"),
    reverseAllocation
);

export default router;
