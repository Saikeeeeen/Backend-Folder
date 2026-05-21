# POS Backend

Minimal Express + SQLite API for testing with Thunder Client.

## Install

```bash
npm install
```

## Run

```bash
npm start
```

## Database Maintenance

The SQLite database lives at `data/database.sqlite` in the project root.

Create a backup:

```bash
npm run db:backup
```

Restore from a backup file:

```bash
npm run db:restore -- backups/database-YYYY-MM-DDTHH-MM-SS-sssZ.sqlite
```

Backups are stored in the `backups/` folder.

### SQLCipher (optional)

This project can work with an SQLite build compiled with SQLCipher. To enable encrypted databases:

- Install a SQLCipher-enabled SQLite library on your system and rebuild the native `sqlite3` bindings for Node (platform-specific steps required on Windows).
- Set an encryption key in the environment before starting the server, for example `SQLCIPHER_KEY=your_secret` or `DB_ENCRYPTION_KEY=your_secret`.
- When a key is provided and the native build exposes SQLCipher, the application will run `PRAGMA key = '...'` at startup.

Notes:
- If your `sqlite3` binary is not compiled with SQLCipher, the app will warn and continue using an unencrypted DB.
- Converting an existing plain DB to an encrypted one requires a SQLCipher-enabled build and running `PRAGMA rekey = 'newkey'`.

## Endpoints

- `GET /health`
- `GET /products`
- `GET /products/:id`
- `POST /products`
- `PUT /products/:id`
- `DELETE /products/:id`
- `GET /api/products/scan/:barcode` or `GET /api/products/scan?barcode=12345`
- `POST /api/products/scan-batch`

For scanner integration, the barcode lookup accepts either the path form or a `barcode` query string, so an existing frontend handler can call whichever is easiest without changing the page layout.

## Thunder Client example

### Create product

Method: `POST`
URL: `http://localhost:3000/products`
Body JSON:

```json
{
  "name": "Rice",
  "price": 5.5,
  "quantity": 20
}
```
