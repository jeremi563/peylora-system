import { randomBytes } from "node:crypto";

import { getDatabasePool } from "../database.js";
import {
    allocateCustomerCreditToInvoice,
    allocateCustomerCreditOldest,
    getCustomerAccountingSummary,
    getInvoiceAccountingSummary,
    reversePaymentAllocation
} from "../services/accounting.service.js";

function operationKey(req, prefix) {
    const supplied = req.get("Idempotency-Key")?.trim();
    if (supplied) return `${prefix}:${supplied}`;
    return `${prefix}:${randomBytes(12).toString("hex")}`;
}

export async function allocateInvoiceCredit(req, res) {
    if (!req.get("Idempotency-Key")?.trim()) {
        return res.status(400).json({
            success: false,
            message: "Idempotency-Key is required for financial allocation"
        });
    }
    try {
        const result = await allocateCustomerCreditToInvoice({
            merchantId: req.auth.merchantId,
            invoiceId: req.params.invoiceId,
            amount: req.validatedBody.amount,
            operationKey: operationKey(req, "credit-allocation")
        });
        if (result.status === "INVALID") {
            return res.status(400).json({ success: false, message: "Invoice or customer is invalid" });
        }
        if (result.status === "INSUFFICIENT_CREDIT") {
            return res.status(409).json({ success: false, message: "Insufficient customer credit" });
        }
        if (result.status === "EXCEEDS_OUTSTANDING") {
            return res.status(409).json({ success: false, message: "Allocation exceeds invoice outstanding balance" });
        }
        if (result.status === "DUPLICATE") {
            return res.status(200).json({ success: true, duplicate: true });
        }
        return res.status(201).json({ success: true, allocationId: result.allocationId });
    } catch (error) {
        console.error("Could not allocate invoice credit:", error.message);
        return res.status(500).json({ success: false, message: "Could not allocate customer credit" });
    }
}

export async function allocateOldestCredit(req, res) {
    if (!req.get("Idempotency-Key")?.trim()) {
        return res.status(400).json({
            success: false,
            message: "Idempotency-Key is required for financial allocation"
        });
    }
    try {
        const pool = getDatabasePool();
        const customer = await pool.query(
            `SELECT c.id
             FROM customers c
             WHERE c.id = $1 AND c.merchant_id = $2`,
            [req.params.customerId, req.auth.merchantId]
        );
        if (!customer.rowCount) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }

        const result = await allocateCustomerCreditOldest({
            merchantId: req.auth.merchantId,
            customerId: req.params.customerId,
            amount: req.validatedBody.amount,
            operationKey: operationKey(req, "oldest-credit")
        });
        if (result.status === "INVALID") {
            return res.status(400).json({ success: false, message: "Allocation amount is invalid" });
        }
        if (result.status === "INSUFFICIENT_CREDIT") {
            return res.status(409).json({ success: false, message: "Insufficient customer credit" });
        }
        return res.status(201).json({ success: true, allocationIds: result.allocations });
    } catch (error) {
        console.error("Could not allocate oldest credit:", error.message);
        return res.status(500).json({ success: false, message: "Could not allocate customer credit" });
    }
}

export async function getInvoiceAccounting(req, res) {
    try {
        const summary = await getInvoiceAccountingSummary(
            req.auth.merchantId,
            req.params.invoiceId
        );
        if (!summary) {
            return res.status(404).json({ success: false, message: "Invoice not found" });
        }
        return res.json({ success: true, accounting: summary });
    } catch (error) {
        console.error("Could not retrieve invoice accounting:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve invoice accounting" });
    }
}

export async function getCustomerAccounting(req, res) {
    try {
        const summary = await getCustomerAccountingSummary(
            req.auth.merchantId,
            req.params.customerId
        );
        if (!summary) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        return res.json({ success: true, accounting: summary });
    } catch (error) {
        console.error("Could not retrieve customer accounting:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve customer accounting" });
    }
}

export async function reverseAllocation(req, res) {
    if (!req.get("Idempotency-Key")?.trim()) {
        return res.status(400).json({
            success: false,
            message: "Idempotency-Key is required for allocation reversal"
        });
    }
    const client = await getDatabasePool().connect();
    try {
        await client.query("BEGIN");
        const result = await reversePaymentAllocation(client, {
            merchantId: req.auth.merchantId,
            allocationId: req.params.allocationId,
            reason: req.validatedBody?.reason ?? null,
            eventKey: operationKey(req, `allocation-reversal:${req.params.allocationId}`)
        });
        await client.query("COMMIT");
        if (!result) {
            return res.status(404).json({ success: false, message: "Allocation not found" });
        }
        if (result.duplicate) {
            return res.status(200).json({ success: true, duplicate: true, reversalId: result.reversalId });
        }
        return res.status(201).json({ success: true, reversalId: result.reversalId });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Could not reverse allocation:", error.message);
        return res.status(500).json({ success: false, message: "Could not reverse allocation" });
    } finally {
        client.release();
    }
}
