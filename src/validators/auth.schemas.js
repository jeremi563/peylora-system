import { z } from "zod";

const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const password = z.string().min(12).max(128).refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password must not exceed 72 UTF-8 bytes"
);

export const registerSchema = z.object({
    name: z.string().trim().min(1).max(120),
    businessName: z.string().trim().min(1).max(160).optional(),
    email,
    password,
    phoneNumber: z.string().regex(/^254[17]\d{8}$/).optional()
});

export const loginSchema = z.object({
    email,
    password: z.string().min(1).max(128).refine(
        (value) => Buffer.byteLength(value, "utf8") <= 72,
        "Password must not exceed 72 UTF-8 bytes"
    )
});

export const refreshSchema = z.object({
    refreshToken: z.string().min(32).max(256)
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
    token: z.string().min(32).max(256),
    password
});

export const verifyEmailSchema = z.object({
    token: z.string().min(32).max(256)
});