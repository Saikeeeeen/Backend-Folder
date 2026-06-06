# Deploying POS Backend (quick copy-paste)

This short guide shows commands to deploy the backend to another device (Windows PowerShell or Linux). Replace <repo-url> and sensitive values.

---

## Prerequisites
- Node.js 18+ installed on target machine.
- Git (or copy files) and network access.
- Port `3000` (or your chosen `PORT`) open.

## 1) Copy project to target

# Option A — clone repo (Linux / macOS / PowerShell)
```bash
git clone <repo-url> pos-backend
cd pos-backend
```

# Option B — copy files and `data/database.sqlite` to the target folder (if you exported DB locally)


## 2) Install dependencies

```bash
cd /path/to/pos-backend
npm ci
```

## 3) Set environment variables

# Linux (bash)
```bash
export HOST=0.0.0.0
export PORT=3000
export JWT_SECRET=$(openssl rand -hex 32)
# optionally: export SQLCIPHER_KEY=...
```

# Windows (PowerShell, permanent via setx)
```powershell
setx HOST "0.0.0.0"
setx PORT "3000"
setx JWT_SECRET "<your-secure-secret>"
```

Restart terminal after `setx` so vars are available.

## 4) Initialize DB (only if needed)

If you copied `data/database.sqlite` you can skip. To initialize columns/indexes or import CSV on the target:

```bash
npm run db:init-barcode
# If you have a CSV to import on the target:
npm run db:import-products ./products.csv
```

## 5) Run as a background service (recommended)

### Using PM2 (cross-platform)
```bash
npm i -g pm2
pm2 start src/server.js --name pos-backend
pm2 startup  # follow printed instructions
pm2 save
```

### Using systemd (Linux example)
Create `/etc/systemd/system/pos-backend.service` with the following content (edit `User` and `WorkingDirectory`):

```ini
[Unit]
Description=POS Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/pos-backend
Environment=HOST=0.0.0.0
Environment=PORT=3000
Environment=JWT_SECRET=<your-secret>
ExecStart=/usr/bin/node src/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable pos-backend
sudo systemctl start pos-backend
sudo journalctl -u pos-backend -f
```

### Windows (NSSM or PM2)
- Use PM2 as above, or use NSSM to create a Windows service pointing to `node` with arg `src\server.js`.

## 6) Firewall / reverse proxy (optional but recommended)

# Linux (ufw)
```bash
sudo ufw allow 3000/tcp
```

# Windows (PowerShell)
```powershell
New-NetFirewallRule -DisplayName "POS Backend" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

Consider placing a reverse proxy (Nginx) in front and enabling HTTPS with Let's Encrypt.

## 7) Verify endpoints

```bash
curl http://<target-ip>:3000/health
curl http://<target-ip>:3000/api/products/scan/4806511019892
```

Expected responses:
- `/health` → `{ "status": "ok" }`
- `/api/products/scan/:barcode` → product JSON

## 8) Backups & maintenance

- Use `node scripts/backup-db.js` to create DB backups; schedule with cron / Task Scheduler.
- Monitor disk space and `.sqlite-wal` file sizes.
- For heavy concurrent load, consider migrating to Postgres or MySQL.

