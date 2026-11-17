CREATE TABLE invoices (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  amount_cents BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id),
  stripe_charge_id TEXT,
  paid_at TIMESTAMPTZ
);
