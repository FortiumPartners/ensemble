-- 001: users table (applied to production in 2025-03)
CREATE TABLE users (
  id        BIGSERIAL PRIMARY KEY,
  email     VARCHAR(254) NOT NULL UNIQUE,
  fullname  VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
