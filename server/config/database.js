const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let _db = null;

function initDatabase() {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/sports_odds.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');

  const schema = fs.readFileSync(path.resolve(__dirname, '../models/schema.sql'), 'utf-8');
  _db.exec(schema);

  console.log(`[DB] SQLite initialized at ${dbPath}`);
  return _db;
}

function getDatabase() {
  if (!_db) return initDatabase();
  return _db;
}

module.exports = { initDatabase, getDatabase };
