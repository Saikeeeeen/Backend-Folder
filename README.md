# POS Backend

Express + SQLite backend for the POS project.

## What is included

- Product, sales, user, store, customer, supplier, brand, category, and unit APIs
- Barcode scanning lookup for scanners
- SQLite backup and restore scripts
- Optional SQLCipher support if your local SQLite build supports it

## Install

Run this once after cloning the repository:

```bash
npm install
```

## Run

Start the server with:

```bash
npm start
```

The server runs on `http://127.0.0.1:3000` by default.

## Barcode setup

If you want barcode lookup to work with your existing product data, run:

```bash
npm run db:init-barcode
```

If you are importing product data from CSV, use:

```bash
npm run db:import-products -- ./products.csv
```

<<<<<<< HEAD
For your inventory master file, you can import it directly from Downloads:

```bash
npm run db:import-products -- "C:\Users\saike\Downloads\Inventory File Mastered.csv"
```

The importer maps the first Item Code column to `item_code`, the second Item Code column to `barcode`, and creates missing categories automatically.

There is no Excel import script in this repository anymore, so `xlsx` is no longer installed.

=======
>>>>>>> e13a607fbd83684ad5e430c73b17ba04f8d80f48
The barcode lookup endpoints are:

- `GET /api/products/scan/:barcode`
- `GET /api/products/scan?barcode=12345`
- `POST /api/products/scan-batch`

For the product search bar, use:

- `GET /api/products/search?q=rice`
- `GET /api/products/search?item_code=SKU001`

The existing product search endpoint also matches `barcode` and `item_code`, so the current cashier screen can find scanned products without moving any frontend UI.

## Database maintenance

The SQLite database is stored at `data/database.sqlite`.

Create a backup:

```bash
npm run db:backup
```

Restore from a backup file:

```bash
npm run db:restore -- backups/database-YYYY-MM-DDTHH-MM-SS-sssZ.sqlite
```

Backups are saved in the `backups/` folder.

<<<<<<< HEAD
Seed dummy sales data:

```bash
npm run db:seed-sales -- 500000
```

The seeder creates matching `sales` and `sale_items` rows using your existing products, users, stores, customers, and payment methods.

## Moving the database to another device

This project uses SQLite, so the important files are the database files under `data/` and the JWT secret in `runtime/jwt-secret.txt`.

To preserve everything when copying to another laptop or PC:

- Stop the app first, or use `npm run db:backup` to create a clean copy.
- Copy `data/database.sqlite` plus `data/database.sqlite-wal` and `data/database.sqlite-shm` if they exist.
- Copy `runtime/jwt-secret.txt` if you want existing login tokens to keep working.
- Copy the project code and run `npm install` on the new machine.

If you want one portable database file instead of the WAL trio, make a backup with `npm run db:backup` and copy that `.sqlite` file.

=======
>>>>>>> e13a607fbd83684ad5e430c73b17ba04f8d80f48
## SQLCipher optional support

This project can work with a SQLCipher-enabled SQLite build if you have one installed.

To use it:

- Install a SQLCipher-enabled SQLite build for Node on your system.
- Set `SQLCIPHER_KEY` or `DB_ENCRYPTION_KEY` before starting the server.
- Start the app normally with `npm start`.

If your local SQLite package does not support SQLCipher, the app will continue using the normal unencrypted database.

## API used for barcode fetching

Use this endpoint from the frontend or scanner handler:

```bash
GET /api/products/scan?barcode=12345
```

Example fetch:

```js
const response = await fetch(`http://127.0.0.1:3000/api/products/scan?barcode=${encodeURIComponent(barcode)}`);
const data = await response.json();
```

## Testing

Run the test suite with:

```bash
npm test
```

## Example product request

Create a product with Thunder Client or any API tool:

```json
{
  "name": "Rice",
  "price": 5.5,
  "quantity": 20
}
```
