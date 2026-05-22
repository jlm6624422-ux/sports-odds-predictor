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

  const isNewDB = !fs.existsSync(dbPath);

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');

  const schema = fs.readFileSync(path.resolve(__dirname, '../models/schema.sql'), 'utf-8');
  _db.exec(schema);

  // Auto-migrate from JSON if DB is fresh (e.g., after Railway deploy without volume)
  if (isNewDB) {
    console.log('[DB] New database detected — running auto-migration from JSON history...');
    try {
      migrateFromJSON(_db);
    } catch (e) {
      console.error('[DB] Auto-migration failed:', e.message);
    }
  }

  console.log(`[DB] SQLite initialized at ${dbPath}`);
  return _db;
}

function migrateFromJSON(db) {
  const historyDir = path.join(__dirname, '../../data/history');
  const resultsPath = path.join(__dirname, '../../data/results.json');

  if (!fs.existsSync(historyDir)) return;

  let results = {};
  if (fs.existsSync(resultsPath)) {
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  }

  const TEAM_ABBREVS = {
    'Atlanta Braves': 'ATL', 'Miami Marlins': 'MIA', 'New York Mets': 'NYM',
    'Philadelphia Phillies': 'PHI', 'Washington Nationals': 'WSH',
    'Chicago Cubs': 'CHC', 'Cincinnati Reds': 'CIN', 'Milwaukee Brewers': 'MIL',
    'Pittsburgh Pirates': 'PIT', 'St. Louis Cardinals': 'STL',
    'Arizona Diamondbacks': 'ARI', 'Colorado Rockies': 'COL',
    'Los Angeles Dodgers': 'LAD', 'San Diego Padres': 'SD',
    'San Francisco Giants': 'SF', 'Baltimore Orioles': 'BAL',
    'Boston Red Sox': 'BOS', 'New York Yankees': 'NYY',
    'Tampa Bay Rays': 'TB', 'Toronto Blue Jays': 'TOR',
    'Chicago White Sox': 'CHW', 'Cleveland Guardians': 'CLE',
    'Detroit Tigers': 'DET', 'Kansas City Royals': 'KC',
    'Minnesota Twins': 'MIN', 'Houston Astros': 'HOU',
    'Los Angeles Angels': 'LAA', 'Oakland Athletics': 'ATH',
    'Athletics': 'ATH', 'Seattle Mariners': 'SEA', 'Texas Rangers': 'TEX',
  };
  const getAbbrev = (name) => TEAM_ABBREVS[name] || name.split(' ').pop().toUpperCase().slice(0, 3);

  const files = fs.readdirSync(historyDir).sort();
  const insertGame = db.prepare(`INSERT OR IGNORE INTO games (sport, date, home_team, away_team, venue, home_pitcher, away_pitcher) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const findGame = db.prepare('SELECT id FROM games WHERE sport = ? AND date = ? AND home_team = ? AND away_team = ?');
  const insertPred = db.prepare(`INSERT INTO predictions (game_id, model_version, run_type, home_win_prob, away_win_prob, expected_total, expected_home_runs, expected_away_runs, confidence, models_used, model_agreement, sub_models, adjustments) VALUES (?, 'ensemble-v2', 'daily', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertPick = db.prepare(`INSERT INTO picks (prediction_id, game_id, date, pick_type, team, side, matchup, odds_american, implied_prob, model_prob, edge, kelly_fraction, kelly_bet_size, kelly_recommendation, opening_line, result, actual_score, pnl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertParlay = db.prepare(`INSERT INTO parlays (date, label, legs, leg_count, stake, odds_decimal, payout, prob, ev, result, pnl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const migrate = db.transaction(() => {
    let totalGames = 0, totalPicks = 0, totalParlays = 0;

    for (const f of files) {
      const date = f.replace('.json', '');
      const data = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8'));
      const dayResults = results[date] || {};

      for (const game of (data.mlb || [])) {
        const prediction = game.prediction || {};
        const kelly = game.kelly || {};
        const matchupStr = `${getAbbrev(game.away)} @ ${getAbbrev(game.home)}`;

        insertGame.run('MLB', date, game.home, game.away, game.venue || '', game.homePitcher || 'TBD', game.awayPitcher || 'TBD');
        const gameRow = findGame.get('MLB', date, game.home, game.away);
        if (!gameRow) continue;
        totalGames++;

        const predResult = insertPred.run(gameRow.id,
          prediction.homeWinProb || 50, prediction.awayWinProb || 50,
          prediction.expectedTotal || 0, prediction.expectedHomeRuns || 0, prediction.expectedAwayRuns || 0,
          game.confidence || 'low', game.modelsUsed || 0, 0,
          JSON.stringify(game.subModels || {}), JSON.stringify(game.adjustments || {}));
        const predId = predResult.lastInsertRowid;

        if (((kelly.betSize > 0) || game.confidence === 'high') && !game.coinFlip) {
          const side = prediction.homeWinProb > prediction.awayWinProb ? 'home' : 'away';
          const team = side === 'home' ? game.home : game.away;
          const odds = side === 'home' ? (game.homeML || -130) : (game.awayML || 130);
          const resultKey = `${matchupStr}-ml`;
          const pickResult = dayResults[resultKey]?.result || 'pending';
          const score = dayResults[resultKey]?.score || null;
          const modelProb = kelly.modelProb || (side === 'home' ? prediction.homeWinProb : prediction.awayWinProb) || 50;
          const stake = kelly.betSize || 25;
          const dec = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
          const pnl = pickResult === 'win' ? parseFloat((stake * (dec - 1)).toFixed(2)) : pickResult === 'loss' ? -stake : null;
          insertPick.run(predId, gameRow.id, date, 'ml', team, side, matchupStr, odds, kelly.impliedProb || 0, modelProb, kelly.edge || 0, kelly.fractionalKellyPct || 0, stake, kelly.recommendation || 'NO BET', odds, pickResult, score, pnl);
          totalPicks++;
        }

        const ouLine = game.ouLine;
        const totalEdge = ouLine ? (prediction.expectedTotal || 0) - ouLine : 0;
        if (ouLine && totalEdge >= 1.5) {
          const resultKey = `${matchupStr}-over`;
          const pickResult = dayResults[resultKey]?.result || 'pending';
          const ouPnl = pickResult === 'win' ? 18.18 : pickResult === 'loss' ? -20 : null;
          insertPick.run(predResult.lastInsertRowid, gameRow.id, date, 'over', `OVER ${ouLine}`, 'over', matchupStr, -110, 0.524, 55, totalEdge, 0, 20, 'SMALL BET', -110, pickResult, dayResults[resultKey]?.score || null, ouPnl);
          totalPicks++;
        }
      }

      for (const game of (data.nba || [])) {
        if (!game.home || !game.away) continue;
        insertGame.run('NBA', date, game.home, game.away, '', '', '');
        const gameRow = findGame.get('NBA', date, game.home, game.away);
        if (!gameRow) continue;
        const nbaSpread = dayResults[`nba-${date}-spread`];
        const nbaOU = dayResults[`nba-${date}-over`];
        if (nbaSpread || nbaOU) {
          const predResult = insertPred.run(gameRow.id, 50, 50, game.ou || 0, 0, 0, 'medium', 1, 0, '{}', '{}');
          if (nbaSpread) { insertPick.run(predResult.lastInsertRowid, gameRow.id, date, 'spread', game.away, 'away', `${game.away} @ ${game.home}`, -110, 0.524, 0.5, 0, 0, 0, 'STANDARD BET', -110, nbaSpread.result, nbaSpread.score || null, null); totalPicks++; }
          if (nbaOU) { insertPick.run(predResult.lastInsertRowid, gameRow.id, date, 'over', `OVER ${game.ou}`, 'over', `${game.away} @ ${game.home}`, -110, 0.524, 0.5, 0, 0, 0, 'STANDARD BET', -110, nbaOU.result, nbaOU.score || null, null); totalPicks++; }
        }
      }

      for (let i = 0; i < (data.parlays || []).length; i++) {
        const p = data.parlays[i];
        const resultKey = `parlay-${date}-${i}`;
        const pResult = dayResults[resultKey]?.result || 'pending';
        const legCount = (p.legs || '').split(' + ').length;
        insertParlay.run(date, p.label || `${legCount}-Leg`, p.legs || '', legCount, p.stake || 0, p.odds || 0, p.payout || 0, p.prob || 0, p.ev || 0, pResult, null);
        totalParlays++;
      }
    }

    console.log(`[DB] Auto-migrated: ${totalGames} games, ${totalPicks} picks, ${totalParlays} parlays`);
  });

  migrate();
}

function getDatabase() {
  if (!_db) return initDatabase();
  return _db;
}

module.exports = { initDatabase, getDatabase };
