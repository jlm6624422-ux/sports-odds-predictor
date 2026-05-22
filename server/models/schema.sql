-- Sports Odds Predictor — Database Schema v3
-- SQLite with WAL mode for Railway persistent volume

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT,
  sport TEXT NOT NULL DEFAULT 'MLB',
  date TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  venue TEXT,
  commence_time TEXT,
  status TEXT DEFAULT 'scheduled',
  home_score INTEGER,
  away_score INTEGER,
  total INTEGER,
  home_pitcher TEXT,
  away_pitcher TEXT,
  home_pitcher_id INTEGER,
  away_pitcher_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(sport, date, home_team, away_team)
);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  model_version TEXT NOT NULL DEFAULT 'ensemble-v3',
  run_type TEXT DEFAULT 'daily',
  home_win_prob REAL,
  away_win_prob REAL,
  expected_total REAL,
  expected_home_runs REAL,
  expected_away_runs REAL,
  f5_expected_total REAL,
  f5_home_runs REAL,
  f5_away_runs REAL,
  confidence TEXT,
  models_used INTEGER,
  model_agreement REAL,
  sub_models TEXT,
  adjustments TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  pick_type TEXT NOT NULL,
  team TEXT,
  side TEXT,
  matchup TEXT,
  odds_american INTEGER,
  implied_prob REAL,
  model_prob REAL,
  edge REAL,
  kelly_fraction REAL,
  kelly_bet_size REAL,
  kelly_recommendation TEXT,
  opening_line INTEGER,
  closing_line INTEGER,
  clv REAL,
  result TEXT DEFAULT 'pending',
  actual_score TEXT,
  pnl REAL,
  settled_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (prediction_id) REFERENCES predictions(id),
  FOREIGN KEY (game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS parlays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  label TEXT,
  legs TEXT NOT NULL,
  leg_count INTEGER,
  stake REAL,
  odds_decimal REAL,
  payout REAL,
  prob REAL,
  ev REAL,
  result TEXT DEFAULT 'pending',
  pnl REAL,
  settled_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pnl_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  pick_id INTEGER,
  parlay_id INTEGER,
  bet_type TEXT,
  description TEXT,
  stake REAL NOT NULL,
  profit_loss REAL NOT NULL,
  bankroll_after REAL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (pick_id) REFERENCES picks(id),
  FOREIGN KEY (parlay_id) REFERENCES parlays(id)
);

CREATE TABLE IF NOT EXISTS clv_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pick_id INTEGER NOT NULL,
  snapshot_type TEXT NOT NULL,
  odds_american INTEGER,
  implied_prob REAL,
  captured_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (pick_id) REFERENCES picks(id)
);

CREATE TABLE IF NOT EXISTS lineups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  side TEXT NOT NULL,
  lineup_json TEXT,
  confirmed INTEGER DEFAULT 0,
  left_handed_pct REAL,
  fetched_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS bullpen_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  team TEXT NOT NULL,
  grade TEXT,
  composite_strength REAL,
  avg_fatigue REAL,
  available_count INTEGER,
  state_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(date, team)
);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date TEXT NOT NULL,
  model_version TEXT NOT NULL,
  date_range_start TEXT,
  date_range_end TEXT,
  total_picks INTEGER,
  wins INTEGER,
  losses INTEGER,
  pushes INTEGER,
  win_rate REAL,
  roi REAL,
  avg_clv REAL,
  flat_pnl REAL,
  kelly_pnl REAL,
  calibration_json TEXT,
  metrics_json TEXT,
  duration_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_games_date ON games(date);
CREATE INDEX IF NOT EXISTS idx_games_sport_date ON games(sport, date);
CREATE INDEX IF NOT EXISTS idx_predictions_game ON predictions(game_id);
CREATE INDEX IF NOT EXISTS idx_picks_game ON picks(game_id);
CREATE INDEX IF NOT EXISTS idx_picks_date ON picks(date);
CREATE INDEX IF NOT EXISTS idx_picks_result ON picks(result);
CREATE INDEX IF NOT EXISTS idx_picks_clv ON picks(clv);
CREATE INDEX IF NOT EXISTS idx_parlays_date ON parlays(date);
CREATE INDEX IF NOT EXISTS idx_pnl_date ON pnl_ledger(date);
CREATE INDEX IF NOT EXISTS idx_clv_pick ON clv_snapshots(pick_id);
CREATE INDEX IF NOT EXISTS idx_lineups_game ON lineups(game_id);
CREATE INDEX IF NOT EXISTS idx_bullpen_date ON bullpen_state(date, team);
