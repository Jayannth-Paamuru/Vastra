PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  business_name TEXT NOT NULL DEFAULT 'VastraLedger',
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  identifier_hash TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  successful INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS store_settings (
  user_id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL DEFAULT 'VastraLedger',
  currency_symbol TEXT NOT NULL DEFAULT '₹',
  selected_period TEXT NOT NULL DEFAULT 'all-time',
  theme_preference TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  series_code TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL,
  type TEXT NOT NULL,
  sub_type TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  pattern TEXT NOT NULL DEFAULT '',
  fabric TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT 'Free Size',
  supplier_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  purchase_cost REAL NOT NULL CHECK (purchase_cost >= 0),
  selling_price REAL NOT NULL CHECK (selling_price >= 0),
  purchase_date TEXT NOT NULL,
  selling_date TEXT,
  status TEXT NOT NULL DEFAULT 'In Stock',
  thumbnail_data_url TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, sku),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS item_photos (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  photo_data_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES inventory(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT,
  sku TEXT NOT NULL,
  item_name TEXT NOT NULL,
  type TEXT NOT NULL,
  sub_type TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  quantity_sold INTEGER NOT NULL DEFAULT 1 CHECK (quantity_sold >= 1),
  purchase_cost REAL NOT NULL CHECK (purchase_cost >= 0),
  selling_price REAL NOT NULL CHECK (selling_price >= 0),
  profit REAL NOT NULL,
  sale_date TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  payment_mode TEXT NOT NULL DEFAULT 'UPI',
  amount_paid REAL NOT NULL DEFAULT 0,
  balance_due REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'Paid',
  next_due_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES inventory(id) ON DELETE SET NULL
);

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

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_hash, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ident ON login_attempts(identifier_hash, attempted_at);
CREATE INDEX IF NOT EXISTS idx_inventory_user_status ON inventory(user_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_user_type ON inventory(user_id, type);
CREATE INDEX IF NOT EXISTS idx_inventory_user_date ON inventory(user_id, purchase_date);
CREATE INDEX IF NOT EXISTS idx_item_photos_item ON item_photos(item_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sales_user_date ON sales(user_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_user_type ON sales(user_id, type);
CREATE INDEX IF NOT EXISTS idx_installments_sale ON sale_installments(sale_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_installments_user ON sale_installments(user_id, payment_date);
