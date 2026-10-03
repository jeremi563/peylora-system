import { getMerchantProfile } from "../services/merchant.service.js";

export async function getMerchant(req, res) {
    try {
        const merchant = await getMerchantProfile(req.params.merchantId);
        if (!merchant) {
            return res.status(404).json({ success: false, message: "Merchant not found" });
        }
        return res.json({ success: true, merchant });
    } catch (error) {
        console.error("Could not load merchant profile:", error.message);
        return res.status(500).json({ success: false, message: "The request could not be completed" });
    }
}