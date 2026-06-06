import path from 'path';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const databasePath = path.join(projectRoot, 'data', 'database.sqlite');

const parseCount = () => {
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--count' && args[index + 1]) {
      return Number.parseInt(args[index + 1], 10);
    }

    if (arg.startsWith('--count=')) {
      return Number.parseInt(arg.split('=')[1], 10);
    }

    if (/^\d+$/.test(arg)) {
      return Number.parseInt(arg, 10);
    }
  }

  return 500000;
};

const totalSales = parseCount();

if (!Number.isInteger(totalSales) || totalSales <= 0) {
  console.error('Usage: npm run db:seed-sales -- 500000');
  process.exit(1);
}

sqlite3.verbose();
const db = new sqlite3.Database(databasePath);
db.configure('busyTimeout', 10000);

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });

const finalize = (statement) =>
  new Promise((resolve, reject) => {
    statement.finalize((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const runPrepared = (statement, params = []) =>
  new Promise((resolve, reject) => {
    statement.run(params, function (error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

const roundMoney = (value) => Math.round(value * 100) / 100;

const buildRandom = () => {
  let seed = Date.now() % 2147483647;

  return () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
};

const main = async () => {
  let saleStatement;
  let itemStatement;

  try {
    await run('PRAGMA foreign_keys = ON');
    await run('PRAGMA busy_timeout = 10000');
    await run('PRAGMA journal_mode = WAL');
    await run('PRAGMA synchronous = NORMAL');
    await run('PRAGMA temp_store = MEMORY');

    const products = await all('SELECT id, price FROM products ORDER BY id');
    const stores = await all('SELECT id FROM stores ORDER BY id');
    const users = await all('SELECT id FROM users ORDER BY id');
    const customers = await all('SELECT id FROM customers ORDER BY id');
    const paymentMethods = await all('SELECT id FROM payment_methods ORDER BY id');

    if (products.length === 0) {
      throw new Error('No products found. Seed products first before creating sales.');
    }

    const random = buildRandom();
    const runId = `${Date.now().toString(36)}${process.pid.toString(36)}`;
    const batchSize = 2500;

    saleStatement = db.prepare(
      'INSERT INTO sales (invoice_no, customer_id, user_id, store_id, subtotal, discount, tax, total, payment_method_id, amount_paid, change_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    itemStatement = db.prepare(
      'INSERT INTO sale_items (sale_id, product_id, quantity, price, total) VALUES (?, ?, ?, ?, ?)'
    );

    let insertedSales = 0;

    for (let start = 0; start < totalSales; start += batchSize) {
      const end = Math.min(start + batchSize, totalSales);

      await run('BEGIN IMMEDIATE TRANSACTION');

      try {
        for (let saleIndex = start; saleIndex < end; saleIndex += 1) {
          const product = products[Math.floor(random() * products.length)];
          const store = stores.length > 0 ? stores[saleIndex % stores.length] : null;
          const user = users.length > 0 ? users[(saleIndex + 1) % users.length] : null;
          const customer = customers.length > 0 ? customers[(saleIndex + 2) % customers.length] : null;
          const paymentMethod = paymentMethods.length > 0 ? paymentMethods[saleIndex % paymentMethods.length] : null;
          const quantity = 1 + Math.floor(random() * 5);
          const price = roundMoney(Number(product.price) || 0);
          const subtotal = roundMoney(price * quantity);
          const discount = 0;
          const tax = 0;
          const total = roundMoney(subtotal - discount + tax);
          const amountPaid = total;
          const changeAmount = 0;
          const invoiceNo = `DUMMY-${runId}-${String(saleIndex + 1).padStart(7, '0')}`;

          const saleResult = await runPrepared(saleStatement, [
            invoiceNo,
            customer?.id ?? null,
            user?.id ?? null,
            store?.id ?? null,
            subtotal,
            discount,
            tax,
            total,
            paymentMethod?.id ?? null,
            amountPaid,
            changeAmount,
          ]);

          await runPrepared(itemStatement, [
            saleResult.lastID,
            product.id,
            quantity,
            price,
            subtotal,
          ]);
        }

        await run('COMMIT');
        insertedSales = end;

        const percent = ((insertedSales / totalSales) * 100).toFixed(1);
        console.log(`Inserted ${insertedSales}/${totalSales} sales (${percent}%)`);
      } catch (error) {
        await run('ROLLBACK').catch(() => {});
        throw error;
      }
    }

    await finalize(saleStatement);
    await finalize(itemStatement);
    db.close();

    console.log(`Done. Seeded ${insertedSales} dummy sales.`);
  } catch (error) {
    if (saleStatement) {
      await finalize(saleStatement).catch(() => {});
    }

    if (itemStatement) {
      await finalize(itemStatement).catch(() => {});
    }

    db.close(() => {});
    console.error('Sales seed failed:', error.message);
    process.exitCode = 1;
  }
};

main();