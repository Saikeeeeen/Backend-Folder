import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('./data/database.sqlite');

db.run('PRAGMA foreign_keys = ON');

console.log('Adding item_code column to products table...');

// Add item_code column without UNIQUE constraint
db.run(`ALTER TABLE products ADD COLUMN item_code TEXT`, (err) => {
  if (err && err.message.includes('duplicate column name')) {
    console.log('✓ item_code column already exists');
    createIndexes();
  } else if (err) {
    console.error('Error adding item_code column:', err.message);
    db.close();
  } else {
    console.log('✓ item_code column added');
    createIndexes();
  }
});

function createIndexes() {
  // Create index on item_code
  db.run(`CREATE INDEX IF NOT EXISTS idx_item_code ON products(item_code)`, (err) => {
    if (err) {
      console.error('Error creating index on item_code:', err.message);
    } else {
      console.log('✓ Index created on item_code');
    }
    
    // Create index on barcode
    db.run(`CREATE INDEX IF NOT EXISTS idx_barcode ON products(barcode)`, (err) => {
      if (err) {
        console.error('Error creating barcode index:', err.message);
      } else {
        console.log('✓ Index created on barcode');
      }
      
      console.log('\n✓ Database initialization complete!');
      db.close();
    });
  });
}
