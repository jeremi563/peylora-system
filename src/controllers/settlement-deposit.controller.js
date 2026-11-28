import {
    createManualBankDeposit,
    listMerchantBankAccounts,
    reconcileSettlementBatchDeposit,
    registerMerchantBankAccount,
    SettlementDepositValidationError
} from "../services/settlement-deposit.service.js";
import { getDatabasePool } from "../database.js";

export async function registerBankAccount(req, res) {
    try {
        const result = await registerMerchantBankAccount({
            merchantId: req.auth.merchantId,
            accountAlias: req.validatedBody.accountAlias,
            bankReference: req.validatedBody.bankReference,
            accountLast4: req.validatedBody.accountLast4
        });
        return res.status(result.duplicate ? 200 : 201).json({
            success: true,
            duplicate: result.duplicate,
            bankAccount: result.account
        });
    } catch (error) {
        if (error instanceof SettlementDepositValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }
        console.error("Could not register merchant bank account:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not register merchant bank account"
        });
    }
}

export async function listBankAccounts(req, res) {
    try {
        return res.json({
            success: true,
            bankAccounts: await listMerchantBankAccounts(req.auth.merchantId)
        });
    } catch (error) {
        console.error("Could not list merchant bank accounts:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not list merchant bank accounts"
        });
    }
}

export async function createBankDeposit(req, res) {
    try {
        const result = await createManualBankDeposit({
            merchantId: req.auth.merchantId,
            accountAlias: req.validatedBody.accountAlias,
            bankReference: req.validatedBody.bankReference,
            depositDate: req.validatedBody.depositDate,
            valueDate: req.validatedBody.valueDate,
            depositedAmount: req.validatedBody.depositedAmount,
            evidenceImportId: req.validatedBody.evidenceImportId,
            evidenceRowId: req.validatedBody.evidenceRowId,
            rawValues: req.validatedBody
        });
        return res.status(result.duplicate ? 200 : 201).json({
            success: true,
            duplicate: result.duplicate,
            deposit: result.deposit
        });
    } catch (error) {
        if (error instanceof SettlementDepositValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }
        console.error("Could not record bank deposit:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not record bank deposit"
        });
    }
}

export async function reconcileBatchDeposit(req, res) {
    try {
        const result = await reconcileSettlementBatchDeposit({
            merchantId: req.auth.merchantId,
            settlementBatchId: req.validatedBody.settlementBatchId,
            bankDepositId: req.validatedBody.bankDepositId
        });
        return res.json({ success: true, reconciliation: result });
    } catch (error) {
        if (error instanceof SettlementDepositValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }
        console.error("Could not reconcile settlement batch and deposit:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not reconcile settlement batch and deposit"
        });
    }
}

export async function listBankDeposits(req, res) {
    try {
        const result = await getDatabasePool().query(
            `SELECT id, account_alias, bank_reference, deposit_date, value_date,
                    currency, deposited_amount, status, created_at
             FROM settlement_bank_deposits
             WHERE merchant_id = $1
             ORDER BY created_at DESC`,
            [req.auth.merchantId]
        );
        return res.json({ success: true, deposits: result.rows });
    } catch (error) {
        console.error("Could not list bank deposits:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not list bank deposits"
        });
    }
}
