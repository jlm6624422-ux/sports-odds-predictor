const fs = require('fs');
const path = require('path');
const { initDatabase } = require('../server/config/database');

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

function main() {
  const db = initDatabase();
  const historyDir = path.join(__dirname, '..', 'data', 'history');
  const resultsPath = path.join(__dirname, '..', 'data', 'results.json');

  if (!fs.existsSync(historyDir)) {
    console.log('No history directory found. Nothing to migrate.');
    return;
  }

  let results = {};
  if (fs.existsSync(resultsPath)) {
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  }

  const files = fs.readdirSync(historyDir).sort();
  console.log(`Migrating ${files.length} days of history...`);

  const insertGame = db.prepare(`
    INSERT OR IGNORE INTO games (sport, date, home_team, away_team, venue, home_pitcher, away_pitcher)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const findGame = db.prepare('SELECT id FROM games WHERE sport = ? AND date = ? AND home_team = ? AND away_team = ?');
  const insertPred = db.prepare(`
    INSERT INTO predictions (game_id, model_version, run_type, home_win_prob, away_win_prob,
      expected_total, expected_home_runs, expected_away_runs, confidence, models_used, model_agreement, sub_models, adjustments)
    VALUES (?, 'ensemble-v2', 'daily', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPick = db.prepare(`
    INSERT INTO picks (prediction_id, game_id, date, pick_type, team, side, matchup,
      odds_american, implied_prob, model_prob, edge, kelly_fraction, kelly_bet_size, kelly_recommendation, opening_line, result, actual_score, pnl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertParlay = db.prepare(`
    INSERT INTO parlays (date, label, legs, leg_count, stake, odds_decimal, payout, prob, ev, result, pnl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const migrate = db.transaction(() => {
    let totalGames = 0, totalPicks = 0, totalParlays = 0;

    for (const f of files) {
      const date = f.replace('.json', '');
      const data = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8'));
      const dayResults = results[date] || {};

      // MLB games
      for (const game of (data.mlb || [])) {
        const prediction = game.prediction || {};
        const kelly = game.kelly || {};
        const matchupStr = `${getAbbrev(game.away)} @ ${getAbbrev(game.home)}`;

        insertGame.run('MLB', date, game.home, game.away, game.venue || '', game.homePitcher || 'TBD', game.awayPitcher || 'TBD');
        const gameRow = findGame.get('MLB', date, game.home, game.away);
        if (!gameRow) continue;
        const gameId = gameRow.id;
        totalGames++;

        const predResult = insertPred.run(gameId,
          prediction.homeWinProb || 50, prediction.awayWinProb || 50,
          prediction.expectedTotal || 0, prediction.expectedHomeRuns || 0, prediction.expectedAwayRuns || 0,
          game.confidence || 'low', game.modelsUsed || 0, 0,
          JSON.stringify(game.subModels || {}), JSON.stringify(game.adjustments || {})
        );
        const predId = predResult.lastInsertRowid;

        // ML pick
        if (((kelly.betSize > 0) || game.confidence === 'high') && !game.coinFlip) {
          const side = prediction.homeWinProb > prediction.awayWinProb ? 'home' : 'away';
          const team = side === 'home' ? game.home : game.away;
          const odds = side === 'home' ? (game.homeML || -130) : (game.awayML || 130);
          const resultKey = `${matchupStr}-ml`;
          const pickResult = dayResults[resultKey]?.result || 'pending';
          const score = dayResults[resultKey]?.score || null;

          insertPick.run(predId, gameId, date, 'ml', team, side, matchupStr,
            odds, kelly.impliedProb || 0, kelly.modelProb || prediction.homeWinProb || 50,
            kelly.edge || 0, kelly.fractionalKellyPct || 0, kelly.betSize || 0,
            kelly.recommendation || 'NO BET', odds, pickResult, score, null);
          totalPicks++;
        }

        // O/U pick
        const ouLine = game.ouLine;
        const totalEdge = ouLine ? (prediction.expectedTotal || 0) - ouLine : 0;
        if (ouLine && totalEdge >= 1.5) {
          const resultKey = `${matchupStr}-over`;
          const pickResult = dayResults[resultKey]?.result || 'pending';
          const score = dayResults[resultKey]?.score || null;
          insertPick.run(predId, gameId, date, 'over', `OVER ${ouLine}`, 'over', matchupStr,
            -110, 0.524, 0, totalEdge, 0, 20, totalEdge >= 2 ? 'STANDARD BET' : 'SMALL BET',
            -110, pickResult, score, null);
          totalPicks++;
        } else if (ouLine && totalEdge <= -1.5) {
          const resultKey = `${matchupStr}-under`;
          const pickResult = dayResults[resultKey]?.result || 'pending';
          const score = dayResults[resultKey]?.score || null;
          insertPick.run(predId, gameId, date, 'under', `UNDER ${ouLine}`, 'under', matchupStr,
            -110, 0.524, 0, Math.abs(totalEdge), 0, 20, Math.abs(totalEdge) >= 2 ? 'STANDARD BET' : 'SMALL BET',
            -110, pickResult, score, null);
          totalPicks++;
        }
      }

      // NBA games
      for (const game of (data.nba || [])) {
        if (!game.home || !game.away) continue;
        insertGame.run('NBA', date, game.home, game.away, '', '', '');
        const gameRow = findGame.get('NBA', date, game.home, game.away);
        if (!gameRow) continue;

        const nbaSpread = dayResults[`nba-${date}-spread`];
        const nbaOU = dayResults[`nba-${date}-over`];

        if (nbaSpread) {
          const predResult = insertPred.run(gameRow.id, 50, 50, game.ou || 0, 0, 0, 'medium', 1, 0, '{}', '{}');
          insertPick.run(predResult.lastInsertRowid, gameRow.id, date, 'spread', game.away, 'away', `${game.away} @ ${game.home}`,
            -110, 0.524, 0.5, 0, 0, 0, 'STANDARD BET', -110, nbaSpread.result, nbaSpread.score || null, null);
          totalPicks++;
        }
        if (nbaOU) {
          const predResult = insertPred.run(gameRow.id, 50, 50, game.ou || 0, 0, 0, 'medium', 1, 0, '{}', '{}');
          insertPick.run(predResult.lastInsertRowid, gameRow.id, date, 'over', `OVER ${game.ou}`, 'over', `${game.away} @ ${game.home}`,
            -110, 0.524, 0.5, 0, 0, 0, 'STANDARD BET', -110, nbaOU.result, nbaOU.score || null, null);
          totalPicks++;
        }
      }

      // Parlays
      for (let i = 0; i < (data.parlays || []).length; i++) {
        const p = data.parlays[i];
        const resultKey = `parlay-${date}-${i}`;
        const pResult = dayResults[resultKey]?.result || 'pending';
        const legCount = (p.legs || '').split(' + ').length;
        insertParlay.run(date, p.label || `${legCount}-Leg`, p.legs || '', legCount,
          p.stake || 0, p.odds || 0, p.payout || 0, p.prob || 0, p.ev || 0, pResult, null);
        totalParlays++;
      }
    }

    console.log(`Migrated: ${totalGames} games, ${totalPicks} picks, ${totalParlays} parlays`);
  });

  migrate();
  console.log('Migration complete.');
}

main();
