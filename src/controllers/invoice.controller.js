import {
    createInvoice,
    createInvoicePaymentLink,
    getMerchantInvoice,
    listMerchantInvoices,
    updateInvoiceStatus
} from "../services/invoice.service.js";

function paymentUrl(reference) {
    const baseUrl = process.env.PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 5000}`;
    return new URL(`/pay/${reference}`, baseUrl).toString();
}

function respondWithError(res, error, operation) {
    if (error.code === "23505") {
        return res.status(409).json({ success: false, message: "Invoice number already exists for this merchant" });
    }
    console.error(`${operation} failed:`, error.message);
    return res.status(500).json({ success: false, message: `Could not ${operation.toLowerCase()}` });
}

export async function createMerchantInvoice(req, res) {
    try {
        const invoice = await createInvoice(req.auth.merchantId, req.validatedBody);
        return res.status(201).json({ success: true, invoice });
    } catch (error) {
        return respondWithError(res, error, "Create invoice");
    }
}

export async function listInvoices(req, res) {
    try {
        const query = req.validatedQuery;
        const result = await listMerchantInvoices(req.auth.merchantId, query);
        return res.json({
            success: true,
            invoices: result.items,
            pagination: {
                page: query.page,
                limit: query.limit,
                total: result.total,
                pages: Math.ceil(result.total / query.limit)
            }
        });
    } catch (error) {
        return respondWithError(res, error, "List invoices");
    }
}

export async function getInvoice(req, res) {
    try {
        const invoice = await getMerchantInvoice(req.auth.merchantId, req.params.invoiceId);
        if (!invoice) {
            return res.status(404).json({ success: false, message: "Invoice not found" });
        }
        return res.json({ success: true, invoice });
    } catch (error) {
        return respondWithError(res, error, "Get invoice");
    }
}

export async function changeInvoiceStatus(req, res) {
    try {
        const invoice = await updateInvoiceStatus(
            req.auth.merchantId,
            req.params.invoiceId,
            req.validatedBody.status
        );
        if (!invoice) {
            return res.status(409).json({
                success: false,
                message: "Invoice not found or the requested status transition is not allowed"
            });
        }
        return res.json({ success: true, invoice });
    } catch (error) {
        return respondWithError(res, error, "Update invoice status");
    }
}

export async function createInvoiceLink(req, res) {
    try {
        const link = await createInvoicePaymentLink(req.auth.merchantId, req.params.invoiceId);
        if (!link) {
            return res.status(409).json({
                success: false,
                message: "Invoice is unavailable for payment or has no payable balance"
            });
        }
        return res.status(link.reused ? 200 : 201).json({
            success: true,
            paymentLink: { ...link, url: paymentUrl(link.reference) }
        });
    } catch (error) {
        return respondWithError(res, error, "Create invoice payment link");
    }
}