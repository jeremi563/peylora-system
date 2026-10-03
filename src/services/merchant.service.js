import { getDatabasePool } from "../database.js";

export async function getMerchantProfile(merchantId) {
    const result = await getDatabasePool().query(
        `SELECT m.id, m.business_name, m.business_description, m.business_phone,
                m.business_email, m.status, m.created_at, u.id AS owner_user_id,
                u.name AS owner_name
         FROM merchants m
         JOIN users u ON u.id = m.user_id
         WHERE m.id = $1`,
        [merchantId]
    );

    return result.rows[0] ?? null;
}