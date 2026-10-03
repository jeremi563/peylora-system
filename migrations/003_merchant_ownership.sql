INSERT INTO merchants (user_id, business_name, business_phone, business_email)
SELECT id, name, phone_number, email
FROM users
WHERE role = 'MERCHANT'
ON CONFLICT (user_id) DO NOTHING;