import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const sourcePath = process.argv[2];

const main = async () => {
  if (!sourcePath) {
    throw new Error('Usage: npm run db:restore -- path-to-backup.sqlite');
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.join(__dirname, '..');
  const databasePath = path.join(projectRoot, 'data', 'database.sqlite');

  await fs.access(sourcePath);
  await fs.copyFile(sourcePath, databasePath);
  console.log(`Database restored from: ${sourcePath}`);
};

main().catch((error) => {
  console.error('Restore failed:', error.message);
  process.exitCode = 1;
});