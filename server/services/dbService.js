const { getDatabase } = require('../config/database');

function db() { return getDatabase(); }

const games = {
  upsert(game) {
    return db().prepare(`
      INSERT INTO games (external_id, sport, date, home_team, away_team, venue, commence_time, home_pitcher, away_pitcher, home_pitcher_id, away_pitcher_id)
      VALUES (@external_id, @sport, @date, @home_team, @away_team, @venue, @commence_time, @home_pitcher, @away_pitcher, @home_pitcher_id, @away_pitcher_id)
      ON CONFLICT(sport, date, home_team, away_team) DO UPDATE SET
        venue=excluded.venue, commence_time=excluded.commence_time,
        home_pitcher=excluded.home_pitcher, away_pitcher=excluded.away_pitcher,
        updated_at=datetime('now')
    `).run(game);
  },

  findByDate(date, sport = 'MLB') {
    return db().prepare('SELECT * FROM games WHERE date = ? AND sport = ?').all(date, sport);
  },

  findById(id) {
    return db().prepare('SELECT * FROM games WHERE id = ?').get(id);
  },

  updateScore(id, homeScore, awayScore) {
    return db().prepare(`
      UPDATE games SET home_score = ?, away_score = ?, total = ? + ?, status = 'final', updated_at = datetime('now')
      WHERE id = ?
    `).run(homeScore, awayScore, homeScore, awayScore, id);
  },

  getByTeamsAndDate(homeTeam, awayTeam, date) {
    return db().prepare('SELECT * FROM games WHERE home_team = ? AND away_team = ? AND date = ?').get(homeTeam, awayTeam, date);
  }
};

const predictions = {
  insert(pred) {
    return db().prepare(`
      INSERT INTO predictions (game_id, model_version, run_type, home_win_prob, away_win_prob,
        expected_total, expected_home_runs, expected_away_runs, f5_expected_total, f5_home_runs, f5_away_runs,
        confidence, models_used, model_agreement, sub_models, adjustments)
      VALUES (@game_id, @model_version, @run_type, @home_win_prob, @away_win_prob,
        @expected_total, @expected_home_runs, @expected_away_runs, @f5_expected_total, @f5_home_runs, @f5_away_runs,
        @confidence, @models_used, @model_agreement, @sub_models, @adjustments)
    `).run(pred);
  },

  findByGameId(gameId) {
    return db().prepare('SELECT * FROM predictions WHERE game_id = ? ORDER BY created_at DESC LIMIT 1').get(gameId);
  }
};

const picks = {
  insert(pick) {
    return db().prepare(`
      INSERT INTO picks (prediction_id, game_id, date, pick_type, team, side, matchup,
        odds_american, implied_prob, model_prob, edge, kelly_fraction, kelly_bet_size,
        kelly_recommendation, opening_line)
      VALUES (@prediction_id, @game_id, @date, @pick_type, @team, @side, @matchup,
        @odds_american, @implied_prob, @model_prob, @edge, @kelly_fraction, @kelly_bet_size,
        @kelly_recommendation, @opening_line)
    `).run(pick);
  },

  findByDate(date) {
    return db().prepare('SELECT * FROM picks WHERE date = ? ORDER BY edge DESC').all(date);
  },

  findPending(daysBack = 5) {
    return db().prepare(`
      SELECT p.*, g.home_team, g.away_team, g.home_score, g.away_score, g.status
      FROM picks p JOIN games g ON p.game_id = g.id
      WHERE p.result = 'pending' AND p.date >= date('now', ?)
    `).all(`-${daysBack} days`);
  },

  findNeedingClosingLine(date) {
    return db().prepare('SELECT * FROM picks WHERE date = ? AND closing_line IS NULL AND result = \'pending\'').all(date);
  },

  updateResult(id, result, score, pnl) {
    return db().prepare(`
      UPDATE picks SET result = ?, actual_score = ?, pnl = ?, settled_at = datetime('now') WHERE id = ?
    `).run(result, score, pnl, id);
  },

  updateClosingLine(id, closingLine, clv) {
    return db().prepare('UPDATE picks SET closing_line = ?, clv = ? WHERE id = ?').run(closingLine, clv, id);
  },

  getStats(daysBack = 30) {
    return db().prepare(`
      SELECT pick_type, result, COUNT(*) as count, SUM(pnl) as total_pnl,
        AVG(edge) as avg_edge, AVG(clv) as avg_clv
      FROM picks WHERE date >= date('now', ?) AND result != 'pending'
      GROUP BY pick_type, result
    `).all(`-${daysBack} days`);
  },

  getCalibration(daysBack = 60) {
    return db().prepare(`
      SELECT
        CAST(ROUND(model_prob * 20) * 5 AS INTEGER) as prob_bucket,
        COUNT(*) as count,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        AVG(model_prob) as avg_predicted
      FROM picks WHERE date >= date('now', ?) AND result IN ('win', 'loss')
      GROUP BY prob_bucket ORDER BY prob_bucket
    `).all(`-${daysBack} days`);
  },

  getDailyPnL(daysBack = 30) {
    return db().prepare(`
      SELECT date, COUNT(*) as picks,
        SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result='loss' THEN 1 ELSE 0 END) as losses,
        SUM(pnl) as day_pnl
      FROM picks WHERE date >= date('now', ?) AND result != 'pending'
      GROUP BY date ORDER BY date
    `).all(`-${daysBack} days`);
  },

  getCLVTrend(daysBack = 30) {
    return db().prepare(`
      SELECT date, AVG(clv) as avg_clv, COUNT(*) as picks
      FROM picks WHERE date >= date('now', ?) AND clv IS NOT NULL
      GROUP BY date ORDER BY date
    `).all(`-${daysBack} days`);
  }
};

const parlays = {
  insert(parlay) {
    return db().prepare(`
      INSERT INTO parlays (date, label, legs, leg_count, stake, odds_decimal, payout, prob, ev)
      VALUES (@date, @label, @legs, @leg_count, @stake, @odds_decimal, @payout, @prob, @ev)
    `).run(parlay);
  },

  findByDate(date) {
    return db().prepare('SELECT * FROM parlays WHERE date = ?').all(date);
  },

  updateResult(id, result, pnl) {
    return db().prepare('UPDATE parlays SET result = ?, pnl = ?, settled_at = datetime(\'now\') WHERE id = ?').run(result, pnl, id);
  }
};

const clvSnapshots = {
  insert(pickId, type, odds, impliedProb) {
    return db().prepare(`
      INSERT INTO clv_snapshots (pick_id, snapshot_type, odds_american, implied_prob)
      VALUES (?, ?, ?, ?)
    `).run(pickId, type, odds, impliedProb);
  }
};

const lineups = {
  upsert(gameId, side, lineupJson, confirmed, leftHandedPct) {
    return db().prepare(`
      INSERT INTO lineups (game_id, side, lineup_json, confirmed, left_handed_pct)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(gameId, side, lineupJson, confirmed ? 1 : 0, leftHandedPct);
  },

  findByGame(gameId) {
    return db().prepare('SELECT * FROM lineups WHERE game_id = ?').all(gameId);
  }
};

const bullpenStates = {
  upsert(date, team, state) {
    return db().prepare(`
      INSERT INTO bullpen_state (date, team, grade, composite_strength, avg_fatigue, available_count, state_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, team) DO UPDATE SET
        grade=excluded.grade, composite_strength=excluded.composite_strength,
        avg_fatigue=excluded.avg_fatigue, available_count=excluded.available_count,
        state_json=excluded.state_json
    `).run(date, team, state.grade, state.compositeStrength, state.avgFatigue, state.availableCount, JSON.stringify(state));
  },

  findByDateTeam(date, team) {
    const row = db().prepare('SELECT * FROM bullpen_state WHERE date = ? AND team = ?').get(date, team);
    if (row) row.state = JSON.parse(row.state_json);
    return row;
  }
};

const backtestRuns = {
  insert(run) {
    return db().prepare(`
      INSERT INTO backtest_runs (run_date, model_version, date_range_start, date_range_end,
        total_picks, wins, losses, pushes, win_rate, roi, avg_clv, flat_pnl, kelly_pnl,
        calibration_json, metrics_json, duration_ms)
      VALUES (@run_date, @model_version, @date_range_start, @date_range_end,
        @total_picks, @wins, @losses, @pushes, @win_rate, @roi, @avg_clv, @flat_pnl, @kelly_pnl,
        @calibration_json, @metrics_json, @duration_ms)
    `).run(run);
  },

  getLatest() {
    return db().prepare('SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT 1').get();
  }
};

module.exports = { games, predictions, picks, parlays, clvSnapshots, lineups, bullpenStates, backtestRuns };
