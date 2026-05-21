import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('./data/database.sqlite');

console.log('Removing seed products (products without item_code)...\n');

db.run('DELETE FROM products WHERE item_code IS NULL', function(err) {
  if (err) {
    console.error('Error deleting seed products:', err);
    db.close();
    process.exit(1);
  }
  
  const deletedCount = this.changes;
  console.log(`✓ Deleted ${deletedCount} seed products`);
  
  db.get('SELECT COUNT(*) as count FROM products', (err, row) => {
    if (err) {
      console.error('Error counting products:', err);
      db.close();
      process.exit(1);
    }
    
    console.log(`✓ Remaining products in database: ${row.count}`);
    console.log('\n✓ Database cleanup complete!');
    console.log('Now only Excel imported products remain.');
    
    db.close();
  });
});
