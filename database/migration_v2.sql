-- Migration v2: EMI installment tracking & series grouping
ALTER TABLE inventory ADD COLUMN series_code TEXT NOT NULL DEFAULT '';

ALTER TABLE sales ADD COLUMN amount_paid REAL NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN balance_due REAL NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'Paid';
ALTER TABLE sales ADD COLUMN next_due_date TEXT;

-- Backfill existing sales so historical records show full paid amount and 0 balance due
UPDATE sales
SET amount_paid = ROUND(selling_price * quantity_sold, 2),
    balance_due = 0,
    payment_status = 'Paid'
WHERE amount_paid = 0 AND balance_due = 0;

CREATE TABLE IF NOT EXISTS sale_installments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_date TEXT NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'UPI',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_installments_sale ON sale_installments(sale_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_installments_user ON sale_installments(user_id, payment_date);
