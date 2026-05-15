CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT UNIQUE,
  sport TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  commence_time TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  home_score INTEGER,
  away_score INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS odds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  bookmaker TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'h2h',
  home_price REAL,
  away_price REAL,
  draw_price REAL,
  spread_home REAL,
  spread_away REAL,
  total_over REAL,
  total_under REAL,
  total_line REAL,
  fetched_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  model_version TEXT NOT NULL DEFAULT 'v1.0',
  predicted_winner TEXT,
  home_win_prob REAL,
  away_win_prob REAL,
  confidence REAL,
  spread_prediction REAL,
  total_prediction REAL,
  features_used TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER,
  sport TEXT NOT NULL,
  bet_type TEXT NOT NULL,
  selection TEXT NOT NULL,
  bookmaker TEXT NOT NULL,
  odds_american INTEGER NOT NULL,
  odds_decimal REAL NOT NULL,
  stake REAL NOT NULL,
  potential_payout REAL NOT NULL,
  result TEXT DEFAULT 'pending',
  profit_loss REAL DEFAULT 0,
  notes TEXT,
  placed_at TEXT DEFAULT (datetime('now')),
  settled_at TEXT,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_games_sport ON games(sport);
CREATE INDEX IF NOT EXISTS idx_games_commence ON games(commence_time);
CREATE INDEX IF NOT EXISTS idx_odds_game ON odds(game_id);
CREATE INDEX IF NOT EXISTS idx_predictions_game ON predictions(game_id);
CREATE INDEX IF NOT EXISTS idx_bets_sport ON bets(sport);
CREATE INDEX IF NOT EXISTS idx_bets_result ON bets(result);
