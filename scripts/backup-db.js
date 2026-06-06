import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const databasePath = path.join(projectRoot, 'data', 'database.sqlite');
const backupsDir = path.join(projectRoot, 'backups');

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupsDir, `database-${timestamp}.sqlite`);

const run = async () => {
  await fs.mkdir(backupsDir, { recursive: true });
  await fs.access(databasePath);
  await fs.copyFile(databasePath, backupPath);
  console.log(`Backup created: ${backupPath}`);
};

run().catch((error) => {
  console.error('Backup failed:', error.message);
  process.exitCode = 1;
});