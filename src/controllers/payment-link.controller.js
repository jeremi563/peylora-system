import {
    createPaymentLink,
    deactivatePaymentLink,
    getPublicLinkedPaymentStatus,
    getPublicPaymentLink,
    listMerchantPaymentLinks
} from "../services/payment-link.service.js";
import { initiatePaymentLinkPayment } from "./mpesa.controller.js";

function publicPaymentUrl(reference) {
    const appUrl = process.env.PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 5000}`;
    return new URL(`/pay/${reference}`, appUrl).toString();
}

export async function createLink(req, res) {
    try {
        const link = await createPaymentLink(req.auth.merchantId, req.validatedBody);
        return res.status(201).json({
            success: true,
            paymentLink: { ...link, url: publicPaymentUrl(link.reference) }
        });
    } catch (error) {
        console.error("Could not create payment link:", error.message);
        return res.status(500).json({ success: false, message: "Could not create payment link" });
    }
}

export async function listLinks(req, res) {
    try {
        const links = await listMerchantPaymentLinks(req.auth.merchantId);
        return res.json({
            success: true,
            paymentLinks: links.map((link) => ({
                ...link,
                url: publicPaymentUrl(link.reference)
            }))
        });
    } catch (error) {
        console.error("Could not list payment links:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve payment links" });
    }
}

export async function deactivateLink(req, res) {
    try {
        const link = await deactivatePaymentLink(req.auth.merchantId, req.params.linkId);
        if (!link) {
            return res.status(404).json({ success: false, message: "Active payment link not found" });
        }
        return res.json({ success: true, paymentLink: link });
    } catch (error) {
        console.error("Could not deactivate payment link:", error.message);
        return res.status(500).json({ success: false, message: "Could not deactivate payment link" });
    }
}

export async function getPublicLink(req, res) {
    try {
        const link = await getPublicPaymentLink(req.params.reference);
        if (!link) {
            return res.status(404).json({ success: false, message: "Payment link not found or no longer active" });
        }

        return res.json({
            success: true,
            paymentLink: {
                reference: link.reference,
                businessName: link.business_name,
                description: link.description,
                amount: link.amount,
                currency: link.currency,
                expiresAt: link.expires_at
            }
        });
    } catch (error) {
        console.error("Could not load public payment link:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve payment link" });
    }
}

export async function payPublicLink(req, res) {
    try {
        const link = await getPublicPaymentLink(req.params.reference);
        if (!link) {
            return res.status(404).json({ success: false, message: "Payment link not found or no longer active" });
        }

        return initiatePaymentLinkPayment(req, res, link);
    } catch (error) {
        console.error("Could not initiate linked payment:", error.message);
        return res.status(500).json({ success: false, message: "Could not initiate payment" });
    }
}

export async function getPublicPaymentStatus(req, res) {
    try {
        const payment = await getPublicLinkedPaymentStatus(
            req.params.reference,
            req.params.paymentId
        );
        if (!payment) {
            return res.status(404).json({ success: false, message: "Payment not found for this link" });
        }

        return res.json({
            success: true,
            payment: {
                id: payment.id,
                status: payment.status,
                amount: payment.amount,
                currency: payment.currency,
                receiptNumber: payment.mpesa_receipt_number,
                transactionDate: payment.provider_transaction_date,
                resultDescription: payment.result_description,
                createdAt: payment.created_at,
                updatedAt: payment.updated_at
            }
        });
    } catch (error) {
        console.error("Could not retrieve linked payment status:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve payment status" });
    }
}