import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const databasePath = path.join(__dirname, '..', 'data', 'database.sqlite');

/**
 * Database initialization script for barcode scanning feature
 * Ensures products table has proper structure and indexes
 */

const db = new sqlite3.Database(databasePath, (err) => {
  if (err) {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  }
  console.log('Connected to database for initialization');
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Run migrations in sequence
async function runMigrations() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Step 1: Check if products table exists
      db.get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='products'`,
        (err, row) => {
          if (err) {
            console.error('Error checking products table:', err);
            reject(err);
            return;
          }

          if (!row) {
            console.log('Creating products table...');
            db.run(
              `
              CREATE TABLE products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                item_code TEXT UNIQUE,
                sku TEXT UNIQUE,
                barcode TEXT UNIQUE,
                price REAL NOT NULL,
                cost REAL,
                quantity INTEGER DEFAULT 0,
                category_id INTEGER,
                brand_id INTEGER,
                unit_id INTEGER,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES categories(id),
                FOREIGN KEY (brand_id) REFERENCES brands(id),
                FOREIGN KEY (unit_id) REFERENCES units(id)
              )
              `,
              (err) => {
                if (err) {
                  console.error('Error creating products table:', err);
                  reject(err);
                } else {
                  console.log('✓ Products table created');
                  createIndexes();
                }
              }
            );
          } else {
            console.log('Products table already exists');
            // Check and add missing columns
            addMissingColumns();
          }
        }
      );

      function addMissingColumns() {
        const requiredColumns = [
          { name: 'item_code', type: 'TEXT UNIQUE', check: true },
          { name: 'barcode', type: 'TEXT UNIQUE', check: true },
          { name: 'description', type: 'TEXT', check: false },
          { name: 'created_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP', check: false },
          { name: 'updated_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP', check: false },
        ];

        let columnsChecked = 0;

        requiredColumns.forEach((col) => {
          db.all(
            `PRAGMA table_info(products)`,
            (err, rows) => {
              if (err) {
                console.error(`Error checking column ${col.name}:`, err);
                return;
              }

              const columnExists = rows.some((r) => r.name === col.name);

              if (!columnExists) {
                console.log(`Adding missing column: ${col.name}`);
                db.run(
                  `ALTER TABLE products ADD COLUMN ${col.name} ${col.type}`,
                  (err) => {
                    if (err) {
                      console.warn(`Warning: Could not add column ${col.name}:`, err.message);
                    } else {
                      console.log(`✓ Added column: ${col.name}`);
                    }
                  }
                );
              }

              columnsChecked++;
              if (columnsChecked === requiredColumns.length) {
                createIndexes();
              }
            }
          );
        });
      }

      function createIndexes() {
        console.log('Creating indexes...');

        const indexes = [
          { name: 'idx_item_code', column: 'item_code' },
          { name: 'idx_barcode', column: 'barcode' },
          { name: 'idx_sku', column: 'sku' },
          { name: 'idx_category_id', column: 'category_id' },
          { name: 'idx_brand_id', column: 'brand_id' },
          { name: 'idx_name', column: 'name' },
        ];

        let indexesCreated = 0;

        indexes.forEach((idx) => {
          db.run(
            `CREATE INDEX IF NOT EXISTS ${idx.name} ON products(${idx.column})`,
            (err) => {
              if (err) {
                console.error(`Error creating index ${idx.name}:`, err);
              } else {
                console.log(`✓ Index created: ${idx.name}`);
              }

              indexesCreated++;
              if (indexesCreated === indexes.length) {
                console.log('\n✓ Database initialization complete!');
                console.log('\nBarcode scanning setup:');
                console.log('- Endpoint: GET /api/products/scan/:barcode');
                console.log('- Batch endpoint: POST /api/products/scan-batch');
                console.log('- Lookup fields: item_code, barcode, sku');
                db.close(() => {
                  resolve();
                });
              }
            }
          );
        });
      }
    });
  });
}

runMigrations()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
