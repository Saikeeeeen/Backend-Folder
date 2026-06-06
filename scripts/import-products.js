import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const databasePath = path.join(projectRoot, 'data', 'database.sqlite');

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : null;

if (!inputPath) {
  console.error('Usage: npm run db:import-products -- <path-to-csv>');
  process.exit(1);
}

const db = new sqlite3.Database(databasePath);
sqlite3.verbose();
db.configure('busyTimeout', 10000);

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(this);
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });

const parseNumber = (value) => {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }

  const normalized = text.replace(/,/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const normalizeKey = (value) => normalizeText(value).toLowerCase();

const parseCsv = (text) => {
  const rows = [];
  let currentRow = [];
  let currentValue = '';
  let inQuotes = false;

  const pushValue = () => {
    currentRow.push(currentValue);
    currentValue = '';
  };

  const pushRow = () => {
    rows.push(currentRow);
    currentRow = [];
  };

  const source = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (inQuotes) {
      if (character === '"' && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        currentValue += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === ',') {
      pushValue();
      continue;
    }

    if (character === '\r') {
      if (nextCharacter === '\n') {
        index += 1;
      }

      pushValue();
      pushRow();
      continue;
    }

    if (character === '\n') {
      pushValue();
      pushRow();
      continue;
    }

    currentValue += character;
  }

  pushValue();
  pushRow();

  return rows.filter((row) => row.some((value) => String(value ?? '').trim() !== ''));
};

const ensureColumn = async (table, column, definition) => {
  const columns = await all(`PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

const ensureSchema = async () => {
  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA busy_timeout = 10000');

  await run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      short_name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
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

  await run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      item_code TEXT,
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

  await ensureColumn('products', 'item_code', 'TEXT');
  await ensureColumn('products', 'sku', 'TEXT');
  await ensureColumn('products', 'barcode', 'TEXT');
  await ensureColumn('products', 'cost', 'REAL DEFAULT 0');
  await ensureColumn('products', 'category_id', 'INTEGER');
  await ensureColumn('products', 'brand_id', 'INTEGER');
  await ensureColumn('products', 'unit_id', 'INTEGER');
  await ensureColumn('products', 'store_id', 'INTEGER');
};

const main = async () => {
  try {
    const csvText = await fs.readFile(inputPath, 'utf8');
    const rows = parseCsv(csvText);

    if (rows.length < 2) {
      throw new Error('CSV file does not contain any data rows');
    }

    await ensureSchema();

    const categoryRows = await all('SELECT id, name FROM categories');
    const categoryByKey = new Map(
      categoryRows.map((row) => [normalizeKey(row.name), { id: row.id, name: row.name }])
    );

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let categoryCreated = 0;

    await run('BEGIN IMMEDIATE TRANSACTION');

    try {
      for (let index = 1; index < rows.length; index += 1) {
        const row = rows[index];

        const primaryCode = normalizeText(row[0]);
        const secondaryCode = normalizeText(row[1]);
        const itemName = normalizeText(row[2]);
        const price = parseNumber(row[3]);
        const cost = parseNumber(row[4]);
        const categoryName = normalizeText(row[5]);

        const itemCode = primaryCode || secondaryCode;
        const barcode = secondaryCode || primaryCode;

        if (!itemCode || !itemName || price === null) {
          skipped += 1;
          continue;
        }

        let categoryId = null;
        if (categoryName) {
          const categoryKey = normalizeKey(categoryName);
          const cachedCategory = categoryByKey.get(categoryKey);

          if (cachedCategory) {
            categoryId = cachedCategory.id;
          } else {
            const existingCategory = await get('SELECT id, name FROM categories WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [categoryName]);
            if (existingCategory) {
              categoryId = existingCategory.id;
              categoryByKey.set(categoryKey, { id: existingCategory.id, name: existingCategory.name });
            } else {
              const createdCategory = await run('INSERT INTO categories (name) VALUES (?)', [categoryName]);
              categoryId = createdCategory.lastID;
              categoryByKey.set(categoryKey, { id: categoryId, name: categoryName });
              categoryCreated += 1;
            }
          }
        }

        const existingProduct = await get(
          'SELECT id FROM products WHERE item_code = ? OR barcode = ? OR sku = ? LIMIT 1',
          [itemCode, barcode, itemCode]
        );

        if (existingProduct) {
          await run(
            `UPDATE products
             SET name = ?,
                 item_code = ?,
                 barcode = ?,
                 price = ?,
                 cost = ?,
                 category_id = ?
             WHERE id = ?`,
            [itemName, itemCode, barcode, price, cost ?? 0, categoryId, existingProduct.id]
          );
          updated += 1;
        } else {
          await run(
            `INSERT INTO products (
               name,
               item_code,
               sku,
               barcode,
               price,
               cost,
               quantity,
               category_id,
               brand_id,
               unit_id,
               store_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [itemName, itemCode, null, barcode, price, cost ?? 0, 0, categoryId, null, null, null]
          );
          inserted += 1;
        }
      }

      await run('COMMIT');
    } catch (error) {
      await run('ROLLBACK');
      throw error;
    }

    console.log(`Imported ${inserted + updated} product rows from ${path.basename(inputPath)}`);
    console.log(`Inserted: ${inserted}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`New categories created: ${categoryCreated}`);
  } finally {
    db.close();
  }
};

main().catch((error) => {
  console.error('Product import failed:', error.message);
  process.exitCode = 1;
});