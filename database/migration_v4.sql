-- Migration v4: Money transfers ledger
CREATE TABLE IF NOT EXISTS money_transfers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  transfer_date TEXT NOT NULL,
  from_account TEXT NOT NULL,
  to_account TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_mode TEXT NOT NULL DEFAULT 'UPI',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transfers_user_date ON money_transfers(user_id, transfer_date);
