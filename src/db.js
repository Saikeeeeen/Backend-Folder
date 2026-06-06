import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const databasePath = path.join(__dirname, '..', 'data', 'database.sqlite');

// Try to use better-sqlite3 if installed (recommended for SQLCipher builds).
// Fall back to the `sqlite3` driver if better-sqlite3 isn't present.
let dbNative = null;
let usingBetter = false;

try {
  // dynamic import so installs are optional
  // eslint-disable-next-line node/no-unsupported-features/es-syntax
  const Better = (await import('better-sqlite3')).default;
  dbNative = new Better(databasePath);
  usingBetter = true;
  // Wait up to 5 seconds when the DB is temporarily locked.
  dbNative.pragma('busy_timeout = 5000');
  // WAL improves concurrent read/write behavior for desktop tools + API access.
  dbNative.pragma('journal_mode = WAL');
  console.log('Using better-sqlite3 as the native SQLite driver');
} catch (e) {
  // fallback to sqlite3
  const sqlite3 = (await import('sqlite3')).default;
  sqlite3.verbose();
  dbNative = new sqlite3.Database(databasePath);
  usingBetter = false;
  dbNative.configure('busyTimeout', 5000);
  dbNative.exec('PRAGMA journal_mode = WAL');
  console.log('Using sqlite3 as the native SQLite driver');
}

// Helper to escape single quotes for PRAGMA key
const escapeForPragma = (s) => (s || '').replace(/'/g, "''");

// Apply SQLCipher key if provided and available in the native build.
const SQLCIPHER_KEY = process.env.SQLCIPHER_KEY || process.env.DB_ENCRYPTION_KEY;
if (SQLCIPHER_KEY) {
  if (usingBetter) {
    try {
      const cipherVersion = dbNative.pragma('cipher_version', { simple: true });
      if (!cipherVersion) {
        console.warn('SQLCipher not available in better-sqlite3 build; cannot apply encryption key.');
      } else {
        const key = escapeForPragma(SQLCIPHER_KEY);
        dbNative.pragma(`key = '${key}'`);
      }
    } catch (err) {
      console.warn('Error checking/applying SQLCipher key with better-sqlite3:', err.message);
    }
  } else {
    // sqlite3 driver: run PRAGMA statements via callback
    dbNative.get('PRAGMA cipher_version', (err, row) => {
      const hasCipher = !err && row && Object.values(row).some((v) => v);
      if (!hasCipher) {
        console.warn('SQLCipher not available in sqlite3 build; cannot apply encryption key.');
        return;
      }

      const key = escapeForPragma(SQLCIPHER_KEY);
      dbNative.run(`PRAGMA key = '${key}'`, (keyErr) => {
        if (keyErr) console.error('Failed to apply SQLCipher key:', keyErr.message);
      });
    });
  }
}

// Create a compatibility wrapper that exposes the callback-style API
// used elsewhere in the app: db.run(sql, params, cb), db.get(sql, params, cb), db.all(sql, params, cb)
const db = {
  run(sql, params = [], cb) {
    if (usingBetter) {
      try {
        const stmt = dbNative.prepare(sql);
        const info = stmt.run(Array.isArray(params) ? params : [params]);
        const infoObj = { lastID: info.lastInsertRowid ?? info.lastInsertRowid ?? info.lastID, changes: info.changes };
        if (typeof cb === 'function') cb.call(infoObj, null);
      } catch (err) {
        if (typeof cb === 'function') cb(err);
      }
    } else {
      dbNative.run(sql, params, function (err) {
        if (typeof cb === 'function') cb.call(this, err);
      });
    }
  },

  get(sql, params = [], cb) {
    if (usingBetter) {
      try {
        const stmt = dbNative.prepare(sql);
        const row = stmt.get(Array.isArray(params) ? params : [params]);
        if (typeof cb === 'function') cb(null, row);
      } catch (err) {
        if (typeof cb === 'function') cb(err);
      }
    } else {
      dbNative.get(sql, params, (err, row) => {
        if (typeof cb === 'function') cb(err, row);
      });
    }
  },

  all(sql, params = [], cb) {
    if (usingBetter) {
      try {
        const stmt = dbNative.prepare(sql);
        const rows = stmt.all(Array.isArray(params) ? params : [params]);
        if (typeof cb === 'function') cb(null, rows);
      } catch (err) {
        if (typeof cb === 'function') cb(err);
      }
    } else {
      dbNative.all(sql, params, (err, rows) => {
        if (typeof cb === 'function') cb(err, rows);
      });
    }
  },

  // expose close for completeness
  close(cb) {
    if (usingBetter) {
      try {
        dbNative.close();
        if (typeof cb === 'function') cb(null);
      } catch (err) {
        if (typeof cb === 'function') cb(err);
      }
    } else {
      dbNative.close(cb);
    }
  },
};

// Promise helpers used for migrations/initialization in this module
const runAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      // `this` will be the info object when using sqlite3; for better-sqlite3
      // the callback was invoked with `this` set to infoObj above.
      resolve(this || { lastID: undefined, changes: undefined });
    });
  });

const getAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const allAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

const ensureColumn = async (table, column, definition) => {
  const columns = await allAsync(`PRAGMA table_info(${table})`);
  const exists = columns.some((item) => item.name === column);

  if (!exists) {
    await runAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

const generateStoreCode = async (prefix = 'STORE') => {
  const row = await getAsync('SELECT COUNT(*) AS count FROM stores');
  const nextNumber = (row?.count ?? 0) + 1;
  return `${prefix}-${String(nextNumber).padStart(5, '0')}`;
};

const seedIfEmpty = async (table, column, values) => {
  if (values.length === 0) {
    return;
  }

  const row = await getAsync(`SELECT COUNT(*) AS count FROM ${table}`);
  if (row.count > 0) {
    return;
  }

  for (const value of values) {
    await runAsync(`INSERT INTO ${table} (${column}) VALUES (?)`, [value]);
  }
};

const seedAccessCodes = async () => {
  const starterAccessCodes = [
    { storeNames: ['Main Branch', 'Main Branch Updated'], code: '1234' },
    { storeNames: ['North Branch'], code: '5678' },
    { storeNames: ['South Branch'], code: '9012' },
    { storeNames: ['Central Branch'], code: '3456' },
  ];

  const existingAccessCodes = await allAsync('SELECT store_id, code FROM access_codes');
  const storeIdsWithCodes = new Set(existingAccessCodes.map((row) => row.store_id).filter((value) => value != null));
  const usedCodes = new Set(existingAccessCodes.map((row) => row.code).filter(Boolean));
  const stores = await allAsync('SELECT id, name FROM stores ORDER BY id ASC');

  const generateUniqueCode = async () => {
    for (let attempt = 0; attempt < 10000; attempt += 1) {
      const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      if (!usedCodes.has(code)) {
        usedCodes.add(code);
        return code;
      }
    }

    throw new Error('Unable to generate a unique starter access code');
  };

  const resolveStarterCode = async (storeName) => {
    const starter = starterAccessCodes.find((entry) => entry.storeNames.includes(storeName));
    if (starter && !usedCodes.has(starter.code)) {
      usedCodes.add(starter.code);
      return starter.code;
    }

    return generateUniqueCode();
  };

  for (const store of stores) {
    if (storeIdsWithCodes.has(store.id)) {
      continue;
    }

    const code = await resolveStarterCode(store.name);
    await runAsync('INSERT INTO access_codes (store_id, code, status) VALUES (?, ?, ?)', [store.id, code, 'unused']);
    storeIdsWithCodes.add(store.id);
  }
};

const initDatabase = async () => {
  try {
    await runAsync('PRAGMA foreign_keys = ON');

    await runAsync(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        short_name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS stores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        city TEXT,
        phone TEXT,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'Active',
        store_code TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const storeColumns = await allAsync('PRAGMA table_info(stores)');
    const hasStoreName = storeColumns.some((column) => column.name === 'name');
    const hasStoreText = storeColumns.some((column) => column.name === 'text');

    if (!hasStoreName && hasStoreText) {
      await runAsync('ALTER TABLE stores RENAME COLUMN text TO name');
    }

    await runAsync(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        username TEXT UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role_id INTEGER,
        status TEXT NOT NULL DEFAULT 'Active',
        store_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL,
        FOREIGN KEY (role_id) REFERENCES roles(id)
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        token TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS access_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER NOT NULL,
        code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unused',
        created_by INTEGER,
        used_by INTEGER,
        active_token TEXT,
        used_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE(store_id, code)
      )
    `);

    await runAsync('CREATE INDEX IF NOT EXISTS idx_access_codes_store_id_status ON access_codes(store_id, status)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_access_codes_store_id_code ON access_codes(store_id, code)');

    await runAsync(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sku TEXT UNIQUE,
        barcode TEXT UNIQUE,
        price REAL NOT NULL,
        cost REAL DEFAULT 0,
        quantity INTEGER NOT NULL DEFAULT 0,
        category_id INTEGER,
        brand_id INTEGER,
        unit_id INTEGER,
        store_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id),
        FOREIGN KEY (brand_id) REFERENCES brands(id),
        FOREIGN KEY (unit_id) REFERENCES units(id),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT NOT NULL UNIQUE,
        customer_id INTEGER,
        user_id INTEGER,
        store_id INTEGER,
        subtotal REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        tax REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        payment_method_id INTEGER,
        amount_paid REAL NOT NULL DEFAULT 0,
        change_amount REAL NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL,
        FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id)
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        total REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    await runAsync(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        movement_type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    await ensureColumn('products', 'sku', 'TEXT');
    await ensureColumn('products', 'barcode', 'TEXT');
    await ensureColumn('products', 'cost', 'REAL DEFAULT 0');
    await ensureColumn('products', 'category_id', 'INTEGER');
    await ensureColumn('products', 'brand_id', 'INTEGER');
    await ensureColumn('products', 'unit_id', 'INTEGER');
    await ensureColumn('products', 'store_id', 'INTEGER');
    await ensureColumn('users', 'username', 'TEXT');
    await ensureColumn('users', 'status', "TEXT DEFAULT 'Active'");
    await ensureColumn('users', 'store_id', 'INTEGER');
    await ensureColumn('sales', 'store_id', 'INTEGER');
    await ensureColumn('users', 'reset_token', 'TEXT');
    await ensureColumn('users', 'reset_expires', 'INTEGER');
    await ensureColumn('access_codes', 'active_token', 'TEXT');

    const storeCount = await getAsync('SELECT COUNT(*) AS count FROM stores');
    if (storeCount.count === 0) {
      const starterStores = [
        ['Main Branch', '123 Rizal Street', 'Davao City', '0912-345-6789', 'main@posystem.com', 'Active'],
        ['North Branch', '456 Quezon Avenue', 'Tagum City', '0923-456-7890', 'north@posystem.com', 'Active'],
        ['South Branch', '789 Magsaysay Blvd', 'Digos City', '0934-567-8901', 'south@posystem.com', 'Inactive'],
      ];

      for (const [name, address, city, phone, email, status] of starterStores) {
        const storeCode = await generateStoreCode();
        await runAsync(
          'INSERT INTO stores (name, address, city, phone, email, status, store_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [name, address, city, phone, email, status, storeCode]
        );
      }
    }

    await seedIfEmpty('categories', 'name', ['General', 'Groceries', 'Beverages', 'Household', 'Electronics']);
    await seedIfEmpty('brands', 'name', ['No Brand', 'Acme', 'Generic']);

    const unitCount = await getAsync('SELECT COUNT(*) AS count FROM units');
    if (unitCount.count === 0) {
      const starterUnits = [
        ['Piece', 'pc'],
        ['Pack', 'pk'],
        ['Box', 'bx'],
        ['Kilogram', 'kg'],
        ['Liter', 'l'],
      ];

      for (const [name, shortName] of starterUnits) {
        await runAsync('INSERT INTO units (name, short_name) VALUES (?, ?)', [name, shortName]);
      }
    }

    await seedIfEmpty('roles', 'name', ['Admin', 'Cashier', 'Manager']);
    await seedIfEmpty('payment_methods', 'name', ['Cash', 'Card', 'Mobile Money']);
    await seedIfEmpty('customers', 'name', ['Walk-in Customer', 'Default Customer']);
    await seedIfEmpty('suppliers', 'name', ['Local Supplier', 'Main Wholesaler']);

    const adminRole = await getAsync('SELECT id FROM roles WHERE name = ?', ['Admin']);
    const cashierRole = await getAsync('SELECT id FROM roles WHERE name = ?', ['Cashier']);
    const userCount = await getAsync('SELECT COUNT(*) AS count FROM users');

    if (userCount.count === 0) {
      const adminHash = await bcrypt.hash('admin123', 10);
      const cashierHash = await bcrypt.hash('cashier123', 10);
      const mainStore = await getAsync('SELECT id FROM stores ORDER BY id ASC LIMIT 1');

      await runAsync('INSERT INTO users (full_name, username, email, password, role_id, status) VALUES (?, ?, ?, ?, ?, ?)', [
        'System Admin',
        'admin',
        'admin@local',
        adminHash,
        adminRole?.id ?? null,
        'Active',
      ]);

      await runAsync('INSERT INTO users (full_name, username, email, password, role_id, status) VALUES (?, ?, ?, ?, ?, ?)', [
        'Cashier User',
        'cashier',
        'cashier@local',
        cashierHash,
        cashierRole?.id ?? null,
        'Active',
      ]);

      if (mainStore?.id) {
        await runAsync('UPDATE users SET store_id = ? WHERE email IN (?, ?)', [mainStore.id, 'admin@local', 'cashier@local']);
      }
    }

    // Keep the built-in demo accounts usable for offline testing.
    const demoAccounts = [
      { email: 'admin@local', password: 'admin123', username: 'admin' },
      { email: 'cashier@local', password: 'cashier123', username: 'cashier' },
    ];

    for (const account of demoAccounts) {
      const existingAccount = await getAsync('SELECT id, username FROM users WHERE email = ?', [account.email]);
      if (existingAccount) {
        const hashedPassword = await bcrypt.hash(account.password, 10);
        await runAsync('UPDATE users SET password = ?, username = COALESCE(username, ?) WHERE id = ?', [
          hashedPassword,
          account.username,
          existingAccount.id,
        ]);
      }
    }

    const productCount = await getAsync('SELECT COUNT(*) AS count FROM products');
    if (productCount.count === 0) {
      const categories = await allAsync('SELECT id, name FROM categories ORDER BY id');
      const units = await allAsync('SELECT id, name FROM units ORDER BY id');
      const brands = await allAsync('SELECT id, name FROM brands ORDER BY id');

      const categoryByName = new Map(categories.map((item) => [item.name, item.id]));
      const unitByName = new Map(units.map((item) => [item.name, item.id]));
      const brandByName = new Map(brands.map((item) => [item.name, item.id]));

      const starterProducts = [
        ['Rice 5kg', 'SKU-RICE-5KG', '1234567890001', 18.5, 16, 'Groceries', 'No Brand', 'Kilogram'],
        ['Cooking Oil 2L', 'SKU-OIL-2L', '1234567890002', 9.99, 8.5, 'Groceries', 'Acme', 'Liter'],
        ['Sugar 1kg', 'SKU-SUGAR-1KG', '1234567890003', 2.75, 2.1, 'Groceries', 'Generic', 'Kilogram'],
        ['Soap Bar', 'SKU-SOAP-BAR', '1234567890004', 1.25, 0.9, 'Household', 'Generic', 'Piece'],
        ['Soda Can', 'SKU-SODA-CAN', '1234567890005', 0.99, 0.7, 'Beverages', 'Acme', 'Piece'],
      ];
      const mainStore = await getAsync('SELECT id FROM stores ORDER BY id ASC LIMIT 1');

      for (const [name, sku, barcode, price, cost, categoryName, brandName, unitName] of starterProducts) {
        await runAsync(
          'INSERT INTO products (name, sku, barcode, price, cost, quantity, category_id, brand_id, unit_id, store_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            name,
            sku,
            barcode,
            price,
            cost,
            25,
            categoryByName.get(categoryName) ?? null,
            brandByName.get(brandName) ?? null,
            unitByName.get(unitName) ?? null,
            mainStore?.id ?? null,
          ]
        );
      }
    }

    await runAsync('UPDATE products SET quantity = 999999');

    await seedAccessCodes();

    // Migrate any existing plain-text passwords to bcrypt hashes
    try {
      const allUsers = await allAsync('SELECT id, password FROM users');
      for (const u of allUsers) {
        if (!u.password) continue;
        if (typeof u.password === 'string' && u.password.startsWith('$2')) continue;
        const hashed = await bcrypt.hash(u.password, 10);
        await runAsync('UPDATE users SET password = ? WHERE id = ?', [hashed, u.id]);
      }
    } catch (err) {
      console.error('Password migration failed:', err.message);
    }
  } catch (error) {
    console.error('Database initialization failed:', error.message);
  }
};

export const dbReady = initDatabase();

export default db;
