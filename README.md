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

The barcode lookup endpoints are:

- `GET /api/products/scan/:barcode`
- `GET /api/products/scan?barcode=12345`
- `POST /api/products/scan-batch`

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
