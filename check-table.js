import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('./data/database.sqlite');
db.all("PRAGMA table_info(products)", (err, rows) => {
  if (err) console.error(err);
  else console.log(JSON.stringify(rows, null, 2));
  db.close();
});
