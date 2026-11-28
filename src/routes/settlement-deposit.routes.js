import { Router } from "express";

import {
    createBankDeposit,
    listBankAccounts,
    listBankDeposits,
    reconcileBatchDeposit,
    registerBankAccount
} from "../controllers/settlement-deposit.controller.js";
import { authenticateAccessToken, authorizeRoles } from "../middleware/authentication.js";
import { validateRequest } from "../middleware/validate-request.js";
import {
    bankAccountSchema,
    bankDepositSchema,
    batchDepositReconciliationSchema
} from "../validators/settlement-deposit.schemas.js";

const router = Router();
const merchantAccess = [authenticateAccessToken, authorizeRoles("MERCHANT")];

router.post(
    "/api/settlement/bank-accounts",
    ...merchantAccess,
    validateRequest(bankAccountSchema),
    registerBankAccount
);
router.get(
    "/api/settlement/bank-accounts",
    ...merchantAccess,
    listBankAccounts
);
router.post(
    "/api/settlement/bank-deposits",
    ...merchantAccess,
    validateRequest(bankDepositSchema),
    createBankDeposit
);
router.get(
    "/api/settlement/bank-deposits",
    ...merchantAccess,
    listBankDeposits
);
router.post(
    "/api/settlement/batch-deposit-reconciliation",
    ...merchantAccess,
    validateRequest(batchDepositReconciliationSchema),
    reconcileBatchDeposit
);

export default router;
