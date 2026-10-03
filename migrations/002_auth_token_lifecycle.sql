CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE UNIQUE INDEX users_email_case_insensitive_unique
    ON users (LOWER(email));

ALTER TABLE refresh_tokens
    ADD COLUMN token_family_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (token_family_id);

CREATE TABLE password_reset_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX password_reset_tokens_user_created_at_idx
    ON password_reset_tokens (user_id, created_at DESC);

CREATE TABLE email_verification_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX email_verification_tokens_user_created_at_idx
    ON email_verification_tokens (user_id, created_at DESC);