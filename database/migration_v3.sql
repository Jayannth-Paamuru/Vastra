-- Migration v3: Sale returns & manual boutique expenditure tracking
ALTER TABLE sales ADD COLUMN sale_status TEXT NOT NULL DEFAULT 'Completed';
ALTER TABLE sales ADD COLUMN returned_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN refund_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN returned_at TEXT;
ALTER TABLE sales ADD COLUMN return_reason TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  payment_mode TEXT NOT NULL DEFAULT 'UPI',
  vendor_name TEXT NOT NULL DEFAULT '',
  related_sku TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_user_cat ON expenses(user_id, category);
CREATE INDEX IF NOT EXISTS idx_sales_user_status ON sales(user_id, sale_status);
