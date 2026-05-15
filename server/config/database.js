const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function initDatabase() {
  const dataDir = path.resolve(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = process.env.DB_PATH || path.join(dataDir, 'sports_odds.db');
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schema = fs.readFileSync(path.resolve(__dirname, '../models/schema.sql'), 'utf-8');
  db.exec(schema);

  return db;
}

module.exports = { initDatabase };
