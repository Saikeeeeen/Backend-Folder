import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const databasePath = path.join(__dirname, '..', 'data', 'database.sqlite');

/**
 * Product import script from CSV/Excel export
 * Usage: node scripts/import-products.js <csv-file-path>
 *
 * Expected CSV columns (headers):
 * - Item Code (required, unique) - This becomes your barcode
 * - Item Name (required)
 * - Retail Price (required) - Maps to 'price'
 * - Cost (optional)
 * - Category (optional) - Category name (will be matched to category_id)
 *
 * Example CSV:
 * Item Code,Item Name,Retail Price,Cost,Category
 * SKU001,Product Name,99.99,45.50,Electronics
 * SKU002,Another Product,149.99,75.00,Clothing
 */

const csvFilePath = process.argv[2];

if (!csvFilePath) {
  console.error('Usage: node scripts/import-products.js <csv-file-path>');
  console.error('Example: node scripts/import-products.js ./products.csv');
  process.exit(1);
}

if (!fs.existsSync(csvFilePath)) {
  console.error(`Error: File not found: ${csvFilePath}`);
  process.exit(1);
}

const db = new sqlite3.Database(databasePath, (err) => {
  if (err) {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  }
});

db.run('PRAGMA foreign_keys = ON');

/**
 * Parse CSV file
 */
async function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    let headers = [];
    let rowCount = 0;

    rl.on('line', (line) => {
      rowCount++;
      // Simple CSV parsing (doesn't handle quoted fields with commas)
      const values = line.split(',').map((v) => v.trim());

      if (rowCount === 1) {
        headers = values;
      } else {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || null;
        });
        rows.push(row);
      }
    });

    rl.on('close', () => {
      resolve({ headers, rows });
    });

    rl.on('error', reject);
  });
}

/**
 * Validate and clean product data
 */
function validateProduct(product, rowNumber) {
  const errors = [];

  if (!product['Item Code'] || product['Item Code'] === '') {
    errors.push('Item Code is required');
  }

  if (!product['Item Name'] || product['Item Name'] === '') {
    errors.push('Item Name is required');
  }

  if (!product['Retail Price'] || isNaN(parseFloat(product['Retail Price']))) {
    errors.push('Retail Price must be a valid number');
  }

  if (product['Cost'] && isNaN(parseFloat(product['Cost']))) {
    errors.push('Cost must be a valid number');
  }

  return {
    isValid: errors.length === 0,
    errors,
    rowNumber,
  };
}

/**
 * Import products into database
 */
async function importProducts() {
  try {
    console.log('Parsing CSV file...');
    const { headers, rows } = await parseCSV(csvFilePath);

    console.log(`Found ${rows.length} products to import`);
    console.log(`Columns: ${headers.join(', ')}\n`);

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    const errors = [];

    // Build category lookup map
    const categoryMap = {};
    const getCategoryId = (categoryName) => {
      return new Promise((resolve) => {
        if (!categoryName) {
          resolve(null);
          return;
        }

        if (categoryMap[categoryName]) {
          resolve(categoryMap[categoryName]);
          return;
        }

        db.get(
          'SELECT id FROM categories WHERE name = ? LIMIT 1',
          [categoryName.trim()],
          (err, row) => {
            if (!err && row) {
              categoryMap[categoryName] = row.id;
              resolve(row.id);
            } else {
              console.warn(`  ⚠ Category "${categoryName}" not found in database`);
              resolve(null);
            }
          }
        );
      });
    };

    // Prepare statement
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO products 
      (item_code, name, barcode, price, cost, quantity, category_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    console.log('Importing products...\n');

    for (let i = 0; i < rows.length; i++) {
      const product = rows[i];
      const rowNumber = i + 2; // +2 because headers are row 1, data starts at row 2

      const validation = validateProduct(product, rowNumber);

      if (!validation.isValid) {
        console.error(`✗ Row ${rowNumber}: ${validation.errors.join(', ')}`);
        errors.push({
          row: rowNumber,
          itemCode: product['Item Code'],
          errors: validation.errors,
        });
        errorCount++;
        continue;
      }

      try {
        const itemCode = product['Item Code'].toString().trim();
        const name = product['Item Name'].toString().trim();
        const barcode = itemCode; // Use Item Code as barcode
        const price = parseFloat(product['Retail Price']);
        const cost = product['Cost'] ? parseFloat(product['Cost']) : null;
        const quantity = 999; // Default unlimited stock quantity

        // Get category ID from category name
        const categoryId = await getCategoryId(product['Category']);

        stmt.run(
          [itemCode, name, barcode, price, cost, quantity, categoryId],
          function (err) {
            if (err) {
              if (err.message.includes('UNIQUE constraint failed')) {
                console.warn(`⚠ Row ${rowNumber}: Duplicate item code (${itemCode}) - skipped`);
                skipCount++;
              } else {
                console.error(`✗ Row ${rowNumber}: ${err.message}`);
                errors.push({
                  row: rowNumber,
                  itemCode,
                  error: err.message,
                });
                errorCount++;
              }
            } else {
              successCount++;
              if (successCount % 50 === 0) {
                console.log(`✓ Imported ${successCount} products...`);
              }
            }
          }
        );
      } catch (err) {
        console.error(`✗ Row ${rowNumber}: ${err.message}`);
        errors.push({
          row: rowNumber,
          itemCode: product['Item Code'],
          error: err.message,
        });
        errorCount++;
      }
    }

    stmt.finalize(() => {
      console.log('\n' + '='.repeat(50));
      console.log('Import Summary');
      console.log('='.repeat(50));
      console.log(`✓ Successfully imported: ${successCount}`);
      console.log(`⚠ Skipped (duplicates): ${skipCount}`);
      console.log(`✗ Errors: ${errorCount}`);
      console.log('='.repeat(50));

      if (errors.length > 0 && errors.length <= 10) {
        console.log('\nErrors Detail:');
        errors.forEach((e) => {
          console.log(`  Row ${e.row}: ${e.itemCode}`);
          if (e.errors) {
            e.errors.forEach((err) => console.log(`    - ${err}`));
          }
          if (e.error) {
            console.log(`    - ${e.error}`);
          }
        });
      }

      db.run('SELECT COUNT(*) as total FROM products', (err, row) => {
        if (!err && row) {
          console.log(`\nTotal products in database: ${row.total}`);
        }
        db.close(() => {
          process.exit(errorCount > 0 ? 1 : 0);
        });
      });
    });
  } catch (err) {
    console.error('Import failed:', err);
    db.close(() => {
      process.exit(1);
    });
  }
}

importProducts();
