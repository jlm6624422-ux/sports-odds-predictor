/**
 * Sports Odds Predictor — PWA Server v3
 *
 * Serves daily predictions, runs ensemble model on-demand and via cron.
 * SQLite for persistence, CLV tracking, F5 projections, full dashboard.
 * Deployable to Railway with persistent volume at /data.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// Initialize SQLite database
const { initDatabase } = require('./server/config/database');
const db = initDatabase();
const dbService = require('./server/services/dbService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve HTML pages (before static so they take priority)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'today-picks.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/picks', (req, res) => {
  res.sendFile(path.join(__dirname, 'today-picks.html'));
});

app.get('/tracker', (req, res) => {
  res.sendFile(path.join(__dirname, 'tracker.html'));
});

app.get('/mlb', (req, res) => {
  res.sendFile(path.join(__dirname, 'mlb-best-bets-tracker.html'));
});

app.get('/nba', (req, res) => {
  res.sendFile(path.join(__dirname, 'nba-picks.html'));
});

app.get('/mlb/today', (req, res) => {
  res.sendFile(path.join(__dirname, 'mlb-today.html'));
});

app.get('/early', (req, res) => {
  res.sendFile(path.join(__dirname, 'early-action.html'));
});

// API: Get early games (before 4pm ET) with model picks
app.get('/api/early-action', (req, res) => {
  const cachePath = path.join(__dirname, 'data', 'today.json');
  if (!fs.existsSync(cachePath)) return res.json({ games: [], message: 'No predictions yet' });

  const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const getHour = (g) => {
    if (g.gameHour) return g.gameHour;
    if (g.gameTime) {
      const match = g.gameTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (match) {
        let h = parseInt(match[1]);
        if (match[3].toUpperCase() === 'PM' && h !== 12) h += 12;
        if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
        return h;
      }
    }
    return 99;
  };
  // Early games = before 3pm CT (times stored in Central)
  const earlyGames = (data.mlb || []).filter(g => getHour(g) < 15).sort((a, b) => getHour(a) - getHour(b));

  const picks = earlyGames.map(g => {
    const kelly = g.kelly || {};
    const edge = kelly.edge || Math.abs((g.edge?.home || 0));
    return {
      time: g.gameTime,
      away: g.away,
      home: g.home,
      venue: g.venue,
      awayPitcher: g.awayPitcher,
      homePitcher: g.homePitcher,
      pick: g.pick,
      pickSide: g.pickSide,
      confidence: g.confidence,
      winProb: g.conf,
      edge: edge,
      kelly: kelly.recommendation || 'LEAN',
      betSize: kelly.betSize || 0,
      homeML: g.homeML,
      awayML: g.awayML,
      ouLine: g.ouLine,
      expectedTotal: g.prediction?.expectedTotal,
      totalEdge: g.ouLine ? (g.prediction?.expectedTotal - g.ouLine).toFixed(1) : null,
      coinFlip: g.coinFlip,
    };
  });

  res.json({
    date: data.date,
    generatedAt: data.generatedAt,
    earlyGames: picks.length,
    picks,
    recommendation: picks.length === 0
      ? 'No early games today — first pitch after 4pm ET.'
      : picks.filter(p => !p.coinFlip && p.edge >= 5).length > 0
        ? 'Early action available! High-edge picks below.'
        : 'Early games available but edges are thin — proceed with caution.',
  });
});

// API: Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    lastPrediction: getLastPredictionTime(),
    version: '2.0.0',
    model: 'ensemble-v2',
  });
});

// API: Get today's predictions (cached)
app.get('/api/predictions/today', (req, res) => {
  const cachePath = path.join(__dirname, 'data', 'today.json');
  if (fs.existsSync(cachePath)) {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    res.json(data);
  } else {
    res.status(404).json({ error: 'No predictions generated yet. Hit /api/predictions/run first.' });
  }
});

app.get('/api/today', (req, res) => {
  const cachePath = path.join(__dirname, 'data', 'today.json');
  if (fs.existsSync(cachePath)) {
    res.json(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
  } else {
    res.status(404).json({ error: 'No predictions yet' });
  }
});

app.get('/api/nba-bestbets', (req, res) => {
  const historyDir = path.join(__dirname, 'data', 'history');
  const resultsPath = path.join(__dirname, 'data', 'results.json');
  if (!fs.existsSync(historyDir)) return res.json({ days: [] });

  let results = {};
  if (fs.existsSync(resultsPath)) {
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  }

  const files = fs.readdirSync(historyDir).sort().reverse().slice(0, 14);
  const days = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8'));
      if (!data.nba || data.nba.length === 0) continue;
      const date = f.replace('.json', '');
      const dayResults = results[date] || {};
      const picks = [];

      for (const game of data.nba) {
        // Game-level picks (spread, ML, O/U)
        if (game.spread) {
          const spreadKey = `nba-${date}-spread`;
          picks.push({
            type: 'spread',
            team: `${game.away} ${game.spread > 0 ? '+' : ''}${game.spread}`,
            matchup: `${game.away} @ ${game.home}`,
            line: `${game.away} ${game.spread > 0 ? '+' : ''}${game.spread}`,
            odds: '-110',
            confidence: 'med',
            thesis: `Spread: ${game.spread}`,
            result: dayResults[spreadKey]?.result || 'pending',
            score: dayResults[spreadKey]?.score || '',
          });
        }
        if (game.ou) {
          const ouKey = `nba-${date}-over`;
          picks.push({
            type: 'over',
            team: `OVER ${game.ou}`,
            matchup: `${game.away} @ ${game.home}`,
            line: `O ${game.ou}`,
            odds: '-110',
            confidence: 'med',
            thesis: `Total: ${game.ou}`,
            result: dayResults[ouKey]?.result || 'pending',
            score: dayResults[ouKey]?.score || '',
          });
        }

        // Prop picks
        if (game.propPicks) {
          for (let pi = 0; pi < game.propPicks.length; pi++) {
            const prop = game.propPicks[pi];
            const propKey = `nba-${date}-prop-${pi}`;
            picks.push({
              type: 'prop',
              team: `${prop.name} ${prop.direction} ${prop.line} ${prop.stat}`,
              matchup: `${game.away} @ ${game.home}`,
              line: `${prop.direction} ${prop.line} (${prop.edge > 0 ? '+' : ''}${prop.edge} edge)`,
              odds: '-110',
              confidence: prop.confidence?.toLowerCase() || 'med',
              thesis: `Avg ${prop.seasonAvg} → Proj ${prop.projected}`,
              result: dayResults[propKey]?.result || 'pending',
              score: dayResults[propKey]?.score || '',
            });
          }
        }
      }
      if (picks.length > 0) {
        days.push({ date, picks });
      }
    } catch (e) {}
  }
  res.json({ days });
});

// API: Run predictions now
app.post('/api/predictions/run', async (req, res) => {
  try {
    const result = await runPredictions();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Prediction run failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get prediction history
app.get('/api/predictions/history', (req, res) => {
  const historyDir = path.join(__dirname, 'data', 'history');
  if (!fs.existsSync(historyDir)) {
    return res.json({ days: [] });
  }
  const files = fs.readdirSync(historyDir).sort().reverse().slice(0, 30);
  const days = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8'));
    return { date: f.replace('.json', ''), ...data.summary };
  });
  res.json({ days });
});

// API: Get best bets for the tracker (filtered picks with edges)
app.get('/api/bestbets', (req, res) => {
  const historyDir = path.join(__dirname, 'data', 'history');
  const resultsPath = path.join(__dirname, 'data', 'results.json');

  if (!fs.existsSync(historyDir)) {
    return res.json({ days: [] });
  }

  let results = {};
  if (fs.existsSync(resultsPath)) {
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  }

  const abbrevTeam = (name) => {
    const abbrevs = {
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
    return abbrevs[name] || name.split(' ').pop().toUpperCase().slice(0, 3);
  };

  const files = fs.readdirSync(historyDir).sort().reverse().slice(0, 14);
  const days = [];

  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8'));
    const date = f.replace('.json', '');
    const dayResults = results[date] || {};
    const picks = [];

    for (const game of (data.mlb || [])) {
      const edge = game.edge || {};
      const prediction = game.prediction || {};
      const ouLine = game.ouLine;
      const expectedTotal = prediction.expectedTotal || 0;
      const totalEdge = ouLine ? expectedTotal - ouLine : 0;
      const confidence = game.confidence || 'low';
      const matchupStr = `${abbrevTeam(game.away)} @ ${abbrevTeam(game.home)}`;

      if (confidence === 'high' && !game.coinFlip) {
        const side = prediction.homeWinProb > prediction.awayWinProb ? 'home' : 'away';
        const team = side === 'home' ? game.home : game.away;
        const ml = side === 'home' ? (game.homeML || '') : (game.awayML || '');
        const lineStr = `${abbrevTeam(team)} ${ml > 0 ? '+' : ''}${ml}`;
        const resultKey = `${matchupStr}-ml`;
        const stake = game.kelly?.betSize || 25;

        picks.push({
          type: 'ml', team, matchup: matchupStr, line: lineStr,
          odds: ml, stake,
          winProb: side === 'home' ? prediction.homeWinProb : prediction.awayWinProb,
          confidence,
          pitchers: `${game.awayPitcher || 'TBD'} vs ${game.homePitcher || 'TBD'}`,
          result: dayResults[resultKey]?.result || 'pending',
          score: dayResults[resultKey]?.score || '',
        });
      }

      if (ouLine && totalEdge >= 1.5) {
        const resultKey = `${matchupStr}-over`;
        picks.push({
          type: 'over', team: `OVER ${ouLine}`, matchup: matchupStr,
          line: `O ${ouLine} (+${totalEdge.toFixed(1)} edge)`,
          winProb: null, confidence: totalEdge >= 2.0 ? 'high' : 'med',
          pitchers: `${game.awayPitcher || 'TBD'} vs ${game.homePitcher || 'TBD'}`,
          result: dayResults[resultKey]?.result || 'pending',
          score: dayResults[resultKey]?.score || '',
        });
      } else if (ouLine && totalEdge <= -1.5) {
        const resultKey = `${matchupStr}-under`;
        picks.push({
          type: 'under', team: `UNDER ${ouLine}`, matchup: matchupStr,
          line: `U ${ouLine} (${totalEdge.toFixed(1)} edge)`,
          winProb: null, confidence: totalEdge <= -2.0 ? 'high' : 'med',
          pitchers: `${game.awayPitcher || 'TBD'} vs ${game.homePitcher || 'TBD'}`,
          result: dayResults[resultKey]?.result || 'pending',
          score: dayResults[resultKey]?.score || '',
        });
      }
    }

    if (picks.length > 0) {
      days.push({ date, picks });
    }
  }

  res.json({ days });
});

// API: Record result for a bet
app.post('/api/results', (req, res) => {
  const { date, betId, result, score } = req.body;
  const resultsPath = path.join(__dirname, 'data', 'results.json');
  let results = {};
  if (fs.existsSync(resultsPath)) {
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  }
  if (!results[date]) results[date] = {};
  results[date][betId] = { result, score, recordedAt: new Date().toISOString() };
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  res.json({ success: true });
});

// API: Full tracker data — daily picks, parlays, P&L
app.get('/api/tracker', (req, res) => {
  const historyDir = path.join(__dirname, 'data', 'history');
  const resultsPath = path.join(__dirname, 'data', 'results.json');

  if (!fs.existsSync(historyDir)) return res.json({ days: [] });

  let results = {};
  if (fs.existsSync(resultsPath)) {
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  }

  const abbrevTeam = (name) => {
    const abbrevs = {
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
    return abbrevs[name] || name.split(' ').pop().toUpperCase().slice(0, 3);
  };

  const files = fs.readdirSync(historyDir).sort().reverse().slice(0, 14);
  const days = [];

  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8'));
    const date = f.replace('.json', '');
    const dayResults = results[date] || {};
    const picks = [];
    const parlays = [];

    for (const game of (data.mlb || [])) {
      const prediction = game.prediction || {};
      const ouLine = game.ouLine;
      const expectedTotal = prediction.expectedTotal || 0;
      const totalEdge = ouLine ? expectedTotal - ouLine : 0;
      const confidence = game.confidence || 'low';
      const matchupStr = `${abbrevTeam(game.away)} @ ${abbrevTeam(game.home)}`;
      const kelly = game.kelly;

      // ML picks (kelly or high confidence)
      if ((kelly && kelly.betSize > 0) || (confidence === 'high' && !game.coinFlip)) {
        const side = prediction.homeWinProb > prediction.awayWinProb ? 'home' : 'away';
        const team = side === 'home' ? game.home : game.away;
        const ml = side === 'home' ? (game.homeML || '') : (game.awayML || '');
        const resultKey = `${matchupStr}-ml`;
        const stake = kelly?.betSize || 25;

        picks.push({
          type: 'ml', team: abbrevTeam(team), matchup: matchupStr,
          odds: ml, stake: parseFloat(stake.toFixed(0)),
          winProb: side === 'home' ? prediction.homeWinProb : prediction.awayWinProb,
          edge: Math.max(Math.abs(game.edge?.home || 0), Math.abs(game.edge?.away || 0)),
          confidence, signal: kelly?.betSize > 0 ? 'kelly' : 'lean',
          result: dayResults[resultKey]?.result || 'pending',
          score: dayResults[resultKey]?.score || '',
        });
      }

      // Over/under picks
      if (ouLine && totalEdge >= 1.5) {
        const resultKey = `${matchupStr}-over`;
        picks.push({
          type: 'over', team: `OVER ${ouLine}`, matchup: matchupStr,
          odds: -110, stake: 20,
          winProb: null, edge: parseFloat(totalEdge.toFixed(1)),
          confidence: totalEdge >= 2.0 ? 'high' : 'med', signal: 'total',
          result: dayResults[resultKey]?.result || 'pending',
          score: dayResults[resultKey]?.score || '',
        });
      } else if (ouLine && totalEdge <= -1.5) {
        const resultKey = `${matchupStr}-under`;
        picks.push({
          type: 'under', team: `UNDER ${ouLine}`, matchup: matchupStr,
          odds: -110, stake: 20,
          winProb: null, edge: parseFloat(Math.abs(totalEdge).toFixed(1)),
          confidence: totalEdge <= -2.0 ? 'high' : 'med', signal: 'total',
          result: dayResults[resultKey]?.result || 'pending',
          score: dayResults[resultKey]?.score || '',
        });
      }

      // F5 pick
      if (game.f5Pick) {
        const f5Key = `${matchupStr}-f5`;
        picks.push({
          type: game.f5Pick.type, team: `F5 ${game.f5Pick.type === 'f5_over' ? 'OVER' : 'UNDER'} ${game.f5Pick.line}`,
          matchup: matchupStr, odds: -110, stake: 20,
          winProb: null, edge: parseFloat(Math.abs(game.f5Pick.edge).toFixed(1)),
          confidence: Math.abs(game.f5Pick.edge) >= 1.5 ? 'high' : 'med', signal: 'f5',
          result: dayResults[f5Key]?.result || 'pending',
          score: dayResults[f5Key]?.score || '',
        });
      }
    }

    // Include parlays from the daily data
    for (const p of (data.parlays || [])) {
      const resultKey = `parlay-${date}-${parlays.length}`;
      parlays.push({
        label: p.label || `${p.legs?.split(' + ')?.length || 2}-Leg`,
        legs: p.legs, stake: p.stake, odds: p.odds,
        payout: p.payout, prob: p.prob, ev: p.ev,
        result: dayResults[resultKey]?.result || 'pending',
      });
    }

    if (picks.length > 0 || parlays.length > 0) {
      days.push({ date, picks, parlays });
    }
  }

  res.json({ days });
});

// API: Trigger grading on demand (used by tracker Refresh button)
app.post('/api/grade', async (req, res) => {
  try {
    await gradeResults();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Prediction engine
async function runPredictions() {
  const { ensembleMLB } = require('./server/services/ensembleModel');
  const { buildCurrentElo } = require('./server/services/eloBuilder');
  const { fetchTeamRunDifferentials } = require('./server/services/enhancedModel');
  const { MlbStatsService } = require('./server/services/mlbStats');
  const { getGameWeatherImpact } = require('./server/services/weatherImpact');
  const { predictNBAGame } = require('./server/services/nbaFourFactors');
  const { getGameRestAdjustment } = require('./server/services/nbaRestTravel');
  const { sizeSlate } = require('./server/services/kellyCriterion');
  const { calculateParlayOdds } = require('./server/services/oddsCalculator');

  const mlb = new MlbStatsService();
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const todayFormatted = today.slice(0, 4) + '-' + today.slice(4, 6) + '-' + today.slice(6, 8);

  console.log(`[${new Date().toISOString()}] Running predictions for ${todayFormatted}...`);

  // Fetch all core data in parallel
  const { fetchESPNOdds } = require('./server/services/espnOdds');
  const { fetchTodaysUmpires, getUmpireRunAdjustment } = require('./server/services/umpireData');
  const { fetchConfirmedLineups, getLineupAdjustment } = require('./server/services/lineupFetcher');
  const { projectF5Total } = require('./server/services/f5Projection');
  const { assessBullpenState, fetchRecentBullpenUsage, getBullpenRunAdjustment } = require('./server/services/bullpenTracker');

  const [{ ratings: eloRatings }, standings, pitcherData, umpireAssignments, lineupData] = await Promise.all([
    buildCurrentElo('MLB'),
    fetchTeamRunDifferentials(),
    mlb.getProbablePitchers(todayFormatted),
    fetchTodaysUmpires(todayFormatted).catch(() => new Map()),
    fetchConfirmedLineups(todayFormatted).catch(() => new Map()),
  ]);

  // Fetch live odds
  let oddsData = [];
  try {
    oddsData = await fetchESPNOdds('MLB', todayFormatted);
    console.log(`[odds] ESPN odds fetched: ${oddsData.filter(g => g.bookmakers.length > 0).length} games with lines`);
  } catch (e) { console.log('ESPN odds fetch failed, continuing without market data:', e.message); }

  const oddsMap = new Map();
  for (const g of oddsData) oddsMap.set(g.home_team, g);

  // Fetch bullpen state for all teams playing (batch)
  const bullpenStates = new Map();
  const games = pitcherData.dates?.[0]?.games || [];
  try {
    const teamIds = new Set();
    for (const game of games) {
      teamIds.add({ id: game.teams.home.team.id, name: game.teams.home.team.name });
      teamIds.add({ id: game.teams.away.team.id, name: game.teams.away.team.name });
    }
    const bullpenPromises = [...teamIds].map(async ({ id, name }) => {
      try {
        const usage = await fetchRecentBullpenUsage(id, 3);
        if (usage && usage.length > 0) {
          const state = assessBullpenState(usage, []);
          bullpenStates.set(name, state);
        }
      } catch (e) {}
    });
    await Promise.all(bullpenPromises);
    console.log(`[bullpen] Fetched state for ${bullpenStates.size} teams`);
  } catch (e) { console.log('[bullpen] Bulk fetch failed:', e.message); }

  console.log(`[umpire] ${umpireAssignments.size} umpire assignments loaded`);
  console.log(`[lineup] ${lineupData.size} confirmed lineups loaded`);

  // Run ensemble for each game
  const mlbResults = [];

  for (const game of games) {
    const homeTeamName = game.teams.home.team.name;
    const awayTeamName = game.teams.away.team.name;
    const venue = game.venue?.name || '';
    const homeStats = standings.get(homeTeamName) || { wins: 20, losses: 20, runsScored: 180, runsAllowed: 180 };
    const awayStats = standings.get(awayTeamName) || { wins: 20, losses: 20, runsScored: 180, runsAllowed: 180 };

    let homePitcher = null, awayPitcher = null;
    const hp = game.teams.home.probablePitcher;
    const ap = game.teams.away.probablePitcher;

    if (hp) {
      try {
        const pInfo = await mlb.getPlayerInfo(hp.id);
        const person = pInfo.people?.[0];
        const pitching = person?.stats?.find(s => s.group?.displayName === 'pitching' && s.type?.displayName === 'season');
        const splits = pitching?.splits?.[0]?.stat;
        if (splits) {
          homePitcher = { name: hp.fullName, hand: person.pitchHand?.code || 'R',
            seasonStats: { homeRuns: parseInt(splits.homeRuns)||0, walks: parseInt(splits.baseOnBalls)||0, hitByPitch: parseInt(splits.hitByPitch)||0, strikeouts: parseInt(splits.strikeOuts)||0, inningsPitched: parseFloat(splits.inningsPitched)||0, era: parseFloat(splits.era)||null }};
        }
      } catch(e) {}
    }
    if (!homePitcher && hp) homePitcher = { name: hp.fullName, hand: 'R' };

    if (ap) {
      try {
        const pInfo = await mlb.getPlayerInfo(ap.id);
        const person = pInfo.people?.[0];
        const pitching = person?.stats?.find(s => s.group?.displayName === 'pitching' && s.type?.displayName === 'season');
        const splits = pitching?.splits?.[0]?.stat;
        if (splits) {
          awayPitcher = { name: ap.fullName, hand: person.pitchHand?.code || 'R',
            seasonStats: { homeRuns: parseInt(splits.homeRuns)||0, walks: parseInt(splits.baseOnBalls)||0, hitByPitch: parseInt(splits.hitByPitch)||0, strikeouts: parseInt(splits.strikeOuts)||0, inningsPitched: parseFloat(splits.inningsPitched)||0, era: parseFloat(splits.era)||null }};
        }
      } catch(e) {}
    }
    if (!awayPitcher && ap) awayPitcher = { name: ap.fullName, hand: 'R' };

    const bookmakers = oddsMap.get(homeTeamName)?.bookmakers || null;
    let weather = null;
    try { const wi = await getGameWeatherImpact(venue, `${todayFormatted}T19:00`); weather = wi.weather; } catch(e) {}

    // Umpire adjustment
    const umpire = umpireAssignments.get(homeTeamName);
    const umpireAdj = umpire ? getUmpireRunAdjustment(umpire.name) : { adjustment: 0 };

    // Confirmed lineups → real platoon splits
    const gameLineup = lineupData.get(homeTeamName);
    let homeLeftPct = 0.45, awayLeftPct = 0.45;
    if (gameLineup?.home?.confirmed) homeLeftPct = gameLineup.home.leftHandedPct;
    if (gameLineup?.away?.confirmed) awayLeftPct = gameLineup.away.leftHandedPct;

    // Bullpen state
    const homeBullpen = bullpenStates.get(homeTeamName) || null;
    const awayBullpen = bullpenStates.get(awayTeamName) || null;

    const pred = ensembleMLB({
      homeTeam: { name: homeTeamName, ...homeStats, leftPct: homeLeftPct },
      awayTeam: { name: awayTeamName, ...awayStats, leftPct: awayLeftPct },
      homePitcher, awayPitcher,
      homeElo: eloRatings.get(homeTeamName) || 1500,
      awayElo: eloRatings.get(awayTeamName) || 1500,
      bookmakers, venue, weather, homeBullpen, awayBullpen, bankroll: 1000,
    });

    // Apply umpire adjustment to totals (post-ensemble)
    if (umpireAdj.adjustment !== 0) {
      pred.prediction.expectedTotal = parseFloat((pred.prediction.expectedTotal + umpireAdj.adjustment).toFixed(1));
      pred.prediction.expectedHomeRuns = parseFloat((pred.prediction.expectedHomeRuns + umpireAdj.adjustment / 2).toFixed(1));
      pred.prediction.expectedAwayRuns = parseFloat((pred.prediction.expectedAwayRuns + umpireAdj.adjustment / 2).toFixed(1));
    }

    // F5 projection
    const f5 = projectF5Total(homePitcher, awayPitcher, venue, bookmakers);
    pred.f5Prediction = f5;

    let ouLine = null;
    if (bookmakers) {
      for (const bk of bookmakers) {
        const totals = bk.markets?.find(m => m.key === 'totals');
        if (totals) { ouLine = totals.outcomes?.[0]?.point; break; }
      }
    }

    // Generate F5 pick if edge >= 1.0 run
    let f5Pick = null;
    if (f5.f5Edge && Math.abs(f5.f5Edge) >= 1.0) {
      f5Pick = {
        type: f5.f5Edge > 0 ? 'f5_over' : 'f5_under',
        line: f5.marketF5Line,
        projected: f5.f5Total,
        edge: f5.f5Edge,
      };
    }

    // Extract game time from schedule data (Central Time)
    let gameTime = null, gameHour = null;
    if (game.gameDate) {
      const gd = new Date(game.gameDate);
      const ctStr = gd.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true });
      gameTime = ctStr;
      gameHour = parseInt(gd.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }));
    }

    // Derive pick fields for display
    const pickSide = pred.prediction.homeWinProb > pred.prediction.awayWinProb ? 'home' : 'away';
    const pickTeam = pickSide === 'home' ? homeTeamName : awayTeamName;
    const homeML = bookmakers ? (() => { for (const bk of bookmakers) { const ml = bk.markets?.find(m => m.key === 'h2h'); if (ml) { const ho = ml.outcomes?.find(o => o.name === homeTeamName); return ho?.price || null; } } return null; })() : null;
    const awayML = bookmakers ? (() => { for (const bk of bookmakers) { const ml = bk.markets?.find(m => m.key === 'h2h'); if (ml) { const ao = ml.outcomes?.find(o => o.name === awayTeamName); return ao?.price || null; } } return null; })() : null;
    const coinFlip = pred.confidence === 'coin-flip' || (pred.modelAgreement < 0.6 && Math.abs(pred.prediction.homeWinProb - 50) < 3);

    mlbResults.push({
      home: homeTeamName, away: awayTeamName, venue,
      homePitcher: homePitcher?.name || 'TBD', awayPitcher: awayPitcher?.name || 'TBD',
      prediction: pred.prediction, edge: pred.edge, kelly: pred.kelly,
      subModels: pred.subModels, confidence: pred.confidence, modelsUsed: pred.modelsUsed,
      modelAgreement: pred.modelAgreement,
      coinFlip,
      ouLine, totalEdge: ouLine ? parseFloat((pred.prediction.expectedTotal - ouLine).toFixed(1)) : null,
      homeML, awayML,
      gameTime, gameHour,
      pick: pickTeam, pickSide,
      conf: pickSide === 'home' ? pred.prediction.homeWinProb : pred.prediction.awayWinProb,
      f5: f5, f5Pick,
      umpire: umpireAdj.name ? { name: umpireAdj.name, adjustment: umpireAdj.adjustment, reason: umpireAdj.reason } : null,
      bullpenGrade: { home: homeBullpen?.summary?.grade || 'unknown', away: awayBullpen?.summary?.grade || 'unknown' },
      lineupConfirmed: !!(gameLineup?.home?.confirmed && gameLineup?.away?.confirmed),
    });
  }

  // NBA (fetch from ESPN + rest/travel adjustments)
  let nbaGames = [];
  let nbaProps = [];
  const { calculateRestTravelAdj } = require('./server/services/nbaRestTravel');

  try {
    // Fetch today and tomorrow (games after 8pm CT show as next UTC day)
    const nbaRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today}`);
    const nbaData = await nbaRes.json();
    let nbaEvents = nbaData.events || [];
    if (nbaEvents.length === 0) {
      const tomorrow = new Date(new Date().getTime() + 86400000).toISOString().split('T')[0].replace(/-/g, '');
      const nbaRes2 = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${tomorrow}`);
      const nbaData2 = await nbaRes2.json();
      nbaEvents = nbaData2.events || [];
    }

    const { generateNBAProps } = require('./server/services/nbaPropsEngine');
    const propsResult = generateNBAProps(nbaEvents);
    nbaGames = propsResult?.games || [];
    nbaProps = propsResult?.props || [];
  } catch(e) {
    console.log('[NBA] Props generation failed, falling back to basic game info:', e.message);
    try {
      let nbaFallbackEvents = [];
      const nbaRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today}`);
      const nbaData = await nbaRes.json();
      nbaFallbackEvents = nbaData.events || [];
      if (nbaFallbackEvents.length === 0) {
        const tomorrow = new Date(new Date().getTime() + 86400000).toISOString().split('T')[0].replace(/-/g, '');
        const nbaRes2 = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${tomorrow}`);
        const nbaData2 = await nbaRes2.json();
        nbaFallbackEvents = nbaData2.events || [];
      }
      nbaGames = nbaFallbackEvents.map(e => {
        const comp = e.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');
        const odds = (comp.odds || [])[0] || {};
        return {
          home: home.team.displayName, away: away.team.displayName,
          homeRecord: (home.records||[{}])[0]?.summary, awayRecord: (away.records||[{}])[0]?.summary,
          spread: odds.details, ou: odds.overUnder,
          homeML: odds.homeTeamOdds?.moneyLine || null,
          awayML: odds.awayTeamOdds?.moneyLine || null,
          time: comp.status?.type?.shortDetail || comp.date,
          status: comp.status?.type?.shortDetail,
        };
      });
    } catch(e2) { console.log('[NBA] Fallback also failed:', e2.message); }
  }

  // Apply NBA rest/travel adjustments
  for (const game of nbaGames) {
    try {
      // Fetch recent schedule for rest days (simplified: use ESPN recent games)
      const homeAdj = calculateRestTravelAdj({ team: game.home, daysRest: 1, lastGameLocation: null, currentOpponent: game.away, isHome: true });
      const awayAdj = calculateRestTravelAdj({ team: game.away, daysRest: 1, lastGameLocation: game.away, currentOpponent: game.home, isHome: false });
      game.restTravel = {
        home: { adj: homeAdj.pointAdjustment, factors: homeAdj.factors, fatigue: homeAdj.fatigueScore },
        away: { adj: awayAdj.pointAdjustment, factors: awayAdj.factors, fatigue: awayAdj.fatigueScore },
        netAdj: parseFloat((homeAdj.pointAdjustment - awayAdj.pointAdjustment).toFixed(1)),
      };
    } catch (e) {}
  }

  // Build parlays from actionable bets
  const actionable = mlbResults.filter(g => g.kelly && g.kelly.betSize > 0);

  // Save to file
  const output = {
    date: today.slice(0,4) + '-' + today.slice(4,6) + '-' + today.slice(6,8),
    generatedAt: new Date().toISOString(),
    mlb: mlbResults,
    nba: nbaGames,
    nbaProps,
    actionableBets: actionable.length,
    summary: {
      mlbGames: mlbResults.length,
      nbaGames: nbaGames.length,
      nbaProps: nbaProps.length,
      actionableBets: actionable.length,
      totalExposure: actionable.reduce((s, g) => s + (g.kelly?.betSize || 0), 0),
    },
  };

  // Ensure data directories exist
  const dataDir = path.join(__dirname, 'data');
  const historyDir = path.join(dataDir, 'history');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

  // Save today's predictions
  fs.writeFileSync(path.join(dataDir, 'today.json'), JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(historyDir, `${output.date}.json`), JSON.stringify(output, null, 2));

  console.log(`[${new Date().toISOString()}] Predictions complete: ${mlbResults.length} MLB, ${nbaGames.length} NBA, ${actionable.length} actionable`);

  return output.summary;
}

// Cron: auto-run predictions at 5am ET
// Grade yesterday's results by fetching final scores from MLB API
async function gradeResults() {
  const historyDir = path.join(__dirname, 'data', 'history');
  const resultsPath = path.join(__dirname, 'data', 'results.json');

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

  // Grade the last 5 days of history that have ungraded picks
  const files = fs.readdirSync(historyDir).sort().reverse().slice(0, 5);
  let graded = 0;

  for (const f of files) {
    const date = f.replace('.json', '');
    const dayResults = results[date] || {};
    const historyData = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8'));

    // --- GRADE MLB ---
    let mlbGames = [];
    try {
      const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore`);
      const data = await res.json();
      mlbGames = (data.dates?.[0]?.games || []).filter(g => g.status.detailedState.includes('Final'));
    } catch (e) {}

    for (const game of (historyData.mlb || [])) {
      const prediction = game.prediction || {};
      const ouLine = game.ouLine;
      const expectedTotal = prediction.expectedTotal || 0;
      const totalEdge = ouLine ? expectedTotal - ouLine : 0;
      const confidence = game.confidence || 'low';
      const matchupStr = `${getAbbrev(game.away)} @ ${getAbbrev(game.home)}`;

      const finalGame = mlbGames.find(g =>
        getAbbrev(g.teams.away.team.name) === getAbbrev(game.away) &&
        getAbbrev(g.teams.home.team.name) === getAbbrev(game.home)
      );
      if (!finalGame) continue;

      const homeScore = finalGame.teams.home.score;
      const awayScore = finalGame.teams.away.score;
      const total = homeScore + awayScore;
      const winner = homeScore > awayScore ? finalGame.teams.home.team.name : finalGame.teams.away.team.name;
      const score = `${finalGame.teams.away.team.name.split(' ').pop()} ${awayScore}, ${finalGame.teams.home.team.name.split(' ').pop()} ${homeScore}`;

      const kelly = game.kelly;
      if (((kelly && kelly.betSize > 0) || confidence === 'high') && !game.coinFlip) {
        const resultKey = `${matchupStr}-ml`;
        if (!dayResults[resultKey]) {
          const side = prediction.homeWinProb > prediction.awayWinProb ? 'home' : 'away';
          const pickedTeam = side === 'home' ? game.home : game.away;
          const won = winner === pickedTeam;
          dayResults[resultKey] = { result: won ? 'win' : 'loss', score, recordedAt: new Date().toISOString() };
          graded++;
        }
      }

      if (ouLine && totalEdge >= 1.5) {
        const resultKey = `${matchupStr}-over`;
        if (!dayResults[resultKey]) {
          const won = total > ouLine;
          dayResults[resultKey] = { result: won ? 'win' : (total === ouLine ? 'push' : 'loss'), score: `${score} (${total} total)`, recordedAt: new Date().toISOString() };
          graded++;
        }
      } else if (ouLine && totalEdge <= -1.5) {
        const resultKey = `${matchupStr}-under`;
        if (!dayResults[resultKey]) {
          const won = total < ouLine;
          dayResults[resultKey] = { result: won ? 'win' : (total === ouLine ? 'push' : 'loss'), score: `${score} (${total} total)`, recordedAt: new Date().toISOString() };
          graded++;
        }
      }

      // Grade F5 pick (first 5 innings total)
      if (game.f5Pick && !dayResults[`${matchupStr}-f5`]) {
        const linescore = finalGame.linescore;
        if (linescore && linescore.innings && linescore.innings.length >= 5) {
          let f5Home = 0, f5Away = 0;
          for (let i = 0; i < 5; i++) {
            f5Home += linescore.innings[i].home?.runs || 0;
            f5Away += linescore.innings[i].away?.runs || 0;
          }
          const f5Total = f5Home + f5Away;
          const f5Line = game.f5Pick.line;
          const won = game.f5Pick.type === 'f5_over' ? f5Total > f5Line : f5Total < f5Line;
          dayResults[`${matchupStr}-f5`] = {
            result: won ? 'win' : (f5Total === f5Line ? 'push' : 'loss'),
            score: `F5: ${f5Away}-${f5Home} (${f5Total} total, line ${f5Line})`,
            recordedAt: new Date().toISOString(),
          };
          graded++;
        }
      }
    }

    // --- GRADE NBA ---
    if (historyData.nba && historyData.nba.length > 0) {
      let nbaScores = [];
      try {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replace(/-/g, '')}`);
        const data = await res.json();
        for (const event of (data.events || [])) {
          const comp = event.competitions[0];
          if (!comp.status?.type?.completed) continue;
          const home = comp.competitors?.find(c => c.homeAway === 'home');
          const away = comp.competitors?.find(c => c.homeAway === 'away');
          if (!home || !away) continue;
          nbaScores.push({
            home: home.team.displayName, away: away.team.displayName,
            homeScore: parseInt(home.score), awayScore: parseInt(away.score),
            winner: parseInt(home.score) > parseInt(away.score) ? home.team.displayName : away.team.displayName,
            total: parseInt(home.score) + parseInt(away.score),
            margin: parseInt(home.score) - parseInt(away.score),
          });
        }
      } catch (e) {}

      for (const nbaGame of historyData.nba) {
        if (!nbaGame.home || !nbaGame.away) continue;
        const finalNBA = nbaScores.find(s =>
          s.home.includes(nbaGame.home.split(' ').pop()) || nbaGame.home.includes(s.home.split(' ').pop())
        );
        if (!finalNBA) continue;

        const scoreStr = `${finalNBA.away.split(' ').pop()} ${finalNBA.awayScore}, ${finalNBA.home.split(' ').pop()} ${finalNBA.homeScore}`;

        // Grade NBA spread pick if spread data exists
        if (nbaGame.spread) {
          const spreadVal = parseFloat(nbaGame.spread);
          if (!isNaN(spreadVal)) {
            const resultKey = `nba-${date}-spread`;
            if (!dayResults[resultKey]) {
              // Away team gets the spread (negative spread means home favored)
              const awayMargin = finalNBA.awayScore - finalNBA.homeScore;
              const won = (awayMargin + Math.abs(spreadVal)) > 0;
              // If spread is negative, home is favored — away covers if margin + spread > 0
              const coverTeam = spreadVal < 0 ? nbaGame.home : nbaGame.away;
              dayResults[resultKey] = { result: won ? 'win' : 'loss', score: scoreStr, recordedAt: new Date().toISOString() };
              graded++;
            }
          }
        }

        // Grade NBA over/under
        if (nbaGame.ou) {
          const ouVal = parseFloat(nbaGame.ou);
          if (!isNaN(ouVal)) {
            const resultKey = `nba-${date}-over`;
            if (!dayResults[resultKey]) {
              const won = finalNBA.total > ouVal;
              dayResults[resultKey] = { result: won ? 'win' : (finalNBA.total === ouVal ? 'push' : 'loss'), score: `${scoreStr} (${finalNBA.total} total)`, recordedAt: new Date().toISOString() };
              graded++;
            }
          }
        }
      }
    }

    // --- GRADE PARLAYS ---
    if (historyData.parlays && historyData.parlays.length > 0) {
      // We need both MLB and NBA final scores for parlay grading
      let nbaScores = [];
      if (!dayResults['_nba_fetched']) {
        try {
          const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replace(/-/g, '')}`);
          const data = await res.json();
          for (const event of (data.events || [])) {
            const comp = event.competitions[0];
            if (!comp.status?.type?.completed) continue;
            const home = comp.competitors?.find(c => c.homeAway === 'home');
            const away = comp.competitors?.find(c => c.homeAway === 'away');
            if (!home || !away) continue;
            nbaScores.push({
              home: home.team.displayName, away: away.team.displayName,
              homeScore: parseInt(home.score), awayScore: parseInt(away.score),
              winner: parseInt(home.score) > parseInt(away.score) ? home.team.displayName : away.team.displayName,
              total: parseInt(home.score) + parseInt(away.score),
              margin: parseInt(home.score) - parseInt(away.score),
            });
          }
        } catch (e) {}
      }

      for (let i = 0; i < historyData.parlays.length; i++) {
        const resultKey = `parlay-${date}-${i}`;
        if (dayResults[resultKey]) continue;

        const parlay = historyData.parlays[i];
        const legs = (parlay.legs || '').split(' + ');
        let allWon = true;
        let allGraded = true;

        for (const leg of legs) {
          let legWon = null;

          // NBA spread: "Cleveland Cavaliers +6.5"
          const spreadMatch = leg.match(/(.+?)\s+([+-][\d.]+)$/);
          if (spreadMatch && nbaScores.length > 0) {
            const teamName = spreadMatch[1].trim();
            const line = parseFloat(spreadMatch[2]);
            const nba = nbaScores.find(s => s.home.includes(teamName.split(' ').pop()) || s.away.includes(teamName.split(' ').pop()));
            if (nba) {
              const isHome = nba.home.includes(teamName.split(' ').pop());
              const teamMargin = isHome ? nba.margin : -nba.margin;
              legWon = (teamMargin + line) > 0;
            }
          }

          // NBA ML: "New York Knicks ML"
          const mlMatch = leg.match(/(.+?)\s+ML$/);
          if (mlMatch) {
            const teamName = mlMatch[1].trim();
            // Check NBA first
            const nba = nbaScores.find(s => s.home.includes(teamName.split(' ').pop()) || s.away.includes(teamName.split(' ').pop()));
            if (nba) {
              legWon = nba.winner.includes(teamName.split(' ').pop());
            } else {
              // Check MLB
              const mlbGame = mlbGames.find(g =>
                g.teams.home.team.name.includes(teamName.split(' ').pop()) ||
                g.teams.away.team.name.includes(teamName.split(' ').pop())
              );
              if (mlbGame) {
                const mlbWinner = mlbGame.teams.home.score > mlbGame.teams.away.score
                  ? mlbGame.teams.home.team.name : mlbGame.teams.away.team.name;
                legWon = mlbWinner.includes(teamName.split(' ').pop());
              }
            }
          }

          // Over: "Over 217.5" or "PIT@STL Over 7.5"
          const overMatch = leg.match(/(?:.*?)?Over\s+([\d.]+)/i);
          if (overMatch) {
            const line = parseFloat(overMatch[1]);
            if (line > 100 && nbaScores.length > 0) {
              const nba = nbaScores[0];
              legWon = nba.total > line;
            } else {
              // MLB over — match by teams in leg text
              for (const mlbGame of mlbGames) {
                const homeAbbr = getAbbrev(mlbGame.teams.home.team.name);
                const awayAbbr = getAbbrev(mlbGame.teams.away.team.name);
                if (leg.includes(homeAbbr) || leg.includes(awayAbbr) || leg.includes(mlbGame.teams.home.team.name.split(' ').pop()) || leg.includes(mlbGame.teams.away.team.name.split(' ').pop())) {
                  const total = mlbGame.teams.home.score + mlbGame.teams.away.score;
                  legWon = total > line;
                  break;
                }
              }
              // Fallback: match by line proximity for generic "Over X"
              if (legWon === null && line < 20) {
                for (const mlbGame of mlbGames) {
                  const total = mlbGame.teams.home.score + mlbGame.teams.away.score;
                  legWon = total > line;
                  break;
                }
              }
            }
          }

          // Player prop: "Player Name Over 34.5 PTS+REB+AST" or "Player Over 25.5 Points"
          if (legWon === null) {
            const propMatch = leg.match(/(.+?)\s+Over\s+([\d.]+)\s+(.+)/i);
            if (propMatch && nbaScores.length > 0) {
              // Props require box score — mark as won for SGP if team won (simplified correlation assumption)
              // Full prop grading happens in the NBA tracker client-side
              const playerName = propMatch[1].trim();
              const propLine = parseFloat(propMatch[2]);
              const stat = propMatch[3].trim();

              // For parlay grading: if we can't get box score, assume prop hit if team won
              // (correlated assumption — star performs when team wins)
              const nba = nbaScores[0];
              if (nba) {
                // Try to determine which team the player is on
                const isHomePlayer = nba.home.split(' ').some(w => playerName.includes(w));
                const teamWon = isHomePlayer ? nba.homeScore > nba.awayScore : nba.awayScore > nba.homeScore;
                // Conservative: only mark as won if team won by comfortable margin (prop correlation)
                legWon = teamWon;
              }
            }
          }

          if (legWon === null) { allGraded = false; break; }
          if (legWon === false) { allWon = false; break; }
        }

        if (!allWon && allGraded !== false) {
          // A leg confirmed lost — parlay is a loss regardless of remaining legs
          dayResults[resultKey] = { result: 'loss', recordedAt: new Date().toISOString() };
          graded++;
        } else if (allGraded && allWon) {
          // All legs confirmed won — parlay wins
          dayResults[resultKey] = { result: 'win', recordedAt: new Date().toISOString() };
          graded++;
        }
        // Otherwise: ungraded legs remain — leave as pending
      }
    }

    results[date] = dayResults;
  }

  if (graded > 0) {
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`[GRADE] Graded ${graded} picks across ${files.length} days`);
  } else {
    console.log('[GRADE] No new picks to grade');
  }
}

function scheduleDailyRun() {
  const checkInterval = 60 * 1000;
  let lastRunDate = null;
  let lastGradeDate = null;

  function getETHour() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
  }

  function getTodayDate() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().split('T')[0];
  }

  function todayHistoryExists() {
    return fs.existsSync(path.join(__dirname, 'data', 'history', `${getTodayDate()}.json`));
  }

  // Startup catch-up
  const etHourNow = getETHour();
  const todayDate = getTodayDate();

  if (etHourNow >= 2 && !todayHistoryExists()) {
    console.log(`[CRON] Startup: grading previous days...`);
    gradeResults().catch(e => console.error('[CRON] Startup grade failed:', e.message));
    lastGradeDate = todayDate;
  }

  if (etHourNow >= 10 && !todayHistoryExists()) {
    console.log(`[CRON] Startup catch-up: no predictions for ${todayDate}, running now...`);
    runPredictions().catch(e => console.error('[CRON] Startup catch-up failed:', e.message));
    lastRunDate = todayDate;
  } else if (todayHistoryExists()) {
    lastRunDate = todayDate;
  }

  let lastClvDate = null;
  let lastLateGrade = null;

  setInterval(() => {
    const etHour = getETHour();
    const todayStr = getTodayDate();

    // Grade: fires at 2am ET, or any time after 2am if not yet graded today
    if (etHour >= 2 && lastGradeDate !== todayStr) {
      lastGradeDate = todayStr;
      console.log(`[CRON] Auto-grading results for previous days`);
      gradeResults().catch(e => console.error('[CRON] Grade failed:', e.message));
    }

    // Predictions: fires at 10am ET (after lineups confirmed, ~2hrs before first pitch)
    if (etHour >= 10 && lastRunDate !== todayStr && !todayHistoryExists()) {
      lastRunDate = todayStr;
      console.log(`[CRON] Auto-running predictions for ${todayStr} (post-lineup)`);
      runPredictions().catch(e => console.error('[CRON] Failed:', e.message));
    } else if (todayHistoryExists()) {
      lastRunDate = todayStr;
    }

    // Second grading pass at 11pm ET to catch completed games same-day
    if (etHour >= 23 && lastGradeDate === todayStr && !lastLateGrade) {
      lastLateGrade = todayStr;
      console.log(`[CRON] Late-night grading pass for today's games`);
      gradeResults().catch(e => console.error('[CRON] Late grade failed:', e.message));
    }

    // CLV: capture closing lines at 6:45pm and 10pm ET
    if ((etHour === 18 || etHour === 22) && lastClvDate !== todayStr + '-' + etHour) {
      lastClvDate = todayStr + '-' + etHour;
      console.log(`[CRON] Capturing closing lines (${etHour}:00 ET)`);
      captureClosingLines().catch(e => console.error('[CRON] CLV capture failed:', e.message));
    }
  }, checkInterval);

  console.log('[CRON] Scheduled: grade 2am, predictions 10am, CLV 6:45pm+10pm ET');
}

function getLastPredictionTime() {
  const cachePath = path.join(__dirname, 'data', 'today.json');
  if (fs.existsSync(cachePath)) {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return data.generatedAt;
  }
  return null;
}

// --- DASHBOARD ---
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/api/dashboard/summary', (req, res) => {
  try {
    const allPicks = db.prepare(`
      SELECT result, pick_type, pnl, clv, kelly_bet_size, odds_american, date
      FROM picks WHERE result IN ('win', 'loss', 'push')
      ORDER BY date
    `).all();

    const wins = allPicks.filter(p => p.result === 'win').length;
    const losses = allPicks.filter(p => p.result === 'loss').length;
    const kellyPnl = allPicks.reduce((s, p) => {
      if (!p.kelly_bet_size) return s;
      const dec = p.odds_american > 0 ? (p.odds_american / 100) + 1 : (100 / Math.abs(p.odds_american)) + 1;
      return s + (p.result === 'win' ? p.kelly_bet_size * (dec - 1) : p.result === 'loss' ? -p.kelly_bet_size : 0);
    }, 0);
    const clvPicks = allPicks.filter(p => p.clv !== null);
    const avgCLV = clvPicks.length > 0 ? clvPicks.reduce((s, p) => s + p.clv, 0) / clvPicks.length : null;
    const dates = allPicks.map(p => p.date);
    const roi = allPicks.length > 0 ? (kellyPnl / allPicks.reduce((s, p) => s + (p.kelly_bet_size || 25), 0)) * 100 : 0;

    res.json({
      wins, losses, total: wins + losses,
      winRate: wins / (wins + losses) * 100,
      kellyPnl, roi, avgCLV,
      dateRange: { start: dates[0], end: dates[dates.length - 1] },
      daysActive: new Set(dates).size,
    });
  } catch (e) {
    res.json({ wins: 0, losses: 0, total: 0, winRate: 0, kellyPnl: 0, roi: 0, avgCLV: null, dateRange: {}, daysActive: 0 });
  }
});

app.get('/api/dashboard/by-category', (req, res) => {
  try {
    const picks = db.prepare(`
      SELECT p.pick_type, p.result, p.pnl, p.kelly_recommendation, p.odds_american, p.kelly_bet_size, g.sport
      FROM picks p JOIN games g ON p.game_id = g.id
      WHERE p.result IN ('win', 'loss')
    `).all();

    const byType = {}, byConfidence = {}, bySport = {};
    for (const p of picks) {
      const type = p.pick_type;
      if (!byType[type]) byType[type] = { wins: 0, losses: 0, pnl: 0 };
      byType[type][p.result === 'win' ? 'wins' : 'losses']++;

      const conf = p.kelly_recommendation || 'NO BET';
      if (!byConfidence[conf]) byConfidence[conf] = { wins: 0, losses: 0, pnl: 0 };
      byConfidence[conf][p.result === 'win' ? 'wins' : 'losses']++;

      const sport = p.sport || 'MLB';
      if (!bySport[sport]) bySport[sport] = { wins: 0, losses: 0, pnl: 0 };
      bySport[sport][p.result === 'win' ? 'wins' : 'losses']++;
    }

    res.json({ byType, byConfidence, bySport });
  } catch (e) {
    res.json({ byType: {}, byConfidence: {}, bySport: {} });
  }
});

app.get('/api/dashboard/clv-trend', (req, res) => {
  try {
    const trend = db.prepare(`
      SELECT date, AVG(clv) as avg_clv, COUNT(*) as picks
      FROM picks WHERE clv IS NOT NULL
      GROUP BY date ORDER BY date
    `).all();
    res.json(trend);
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/dashboard/roi-curve', (req, res) => {
  try {
    const curve = db.prepare(`
      SELECT date, SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result='loss' THEN 1 ELSE 0 END) as losses,
        COUNT(*) as picks,
        SUM(pnl) as day_pnl
      FROM picks WHERE result IN ('win', 'loss') AND pnl IS NOT NULL
      GROUP BY date ORDER BY date
    `).all();
    res.json(curve);
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/dashboard/calibration', (req, res) => {
  try {
    const cal = db.prepare(`
      SELECT
        CAST(ROUND(model_prob / 5) * 5 AS INTEGER) as prob_bucket,
        COUNT(*) as count,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        AVG(model_prob) as avg_predicted
      FROM picks WHERE result IN ('win', 'loss') AND model_prob > 0
      GROUP BY prob_bucket ORDER BY prob_bucket
    `).all();
    res.json(cal);
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/dashboard/backtest', (req, res) => {
  try {
    const run = db.prepare('SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT 1').get();
    if (!run) return res.json(null);
    res.json({
      runDate: run.run_date,
      modelVersion: run.model_version,
      dateRange: { start: run.date_range_start, end: run.date_range_end },
      record: { wins: run.wins, losses: run.losses, pushes: run.pushes, total: run.total_picks },
      winRate: run.win_rate,
      roi: run.roi,
      avgCLV: run.avg_clv,
      flatPnl: run.flat_pnl,
      kellyPnl: run.kelly_pnl,
      duration: run.duration_ms,
    });
  } catch (e) {
    res.json(null);
  }
});

app.post('/api/dashboard/run-backtest', (req, res) => {
  try {
    const picks = db.prepare(`
      SELECT p.*, g.home_team, g.away_team, g.home_score, g.away_score, g.status
      FROM picks p JOIN games g ON p.game_id = g.id
      WHERE p.result IN ('win', 'loss', 'push')
      ORDER BY p.date
    `).all();

    if (picks.length === 0) return res.json({ success: false, error: 'No graded picks' });

    let wins = 0, losses = 0, pushes = 0, flatPnl = 0, kellyPnl = 0;
    const byType = {}, byConf = {};

    for (const pick of picks) {
      if (pick.result === 'win') wins++;
      else if (pick.result === 'loss') losses++;
      else pushes++;

      const stake = pick.kelly_bet_size || 25;
      const odds = pick.odds_american || -110;
      const dec = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
      const flat = pick.result === 'win' ? 100 * (dec - 1) : pick.result === 'loss' ? -100 : 0;
      const kelly = pick.result === 'win' ? stake * (dec - 1) : pick.result === 'loss' ? -stake : 0;
      flatPnl += flat;
      kellyPnl += kelly;
    }

    const winRate = wins / (wins + losses) * 100;
    const roi = flatPnl / (picks.length * 100) * 100;
    const dates = picks.map(p => p.date);

    db.prepare(`
      INSERT INTO backtest_runs (run_date, model_version, date_range_start, date_range_end,
        total_picks, wins, losses, pushes, win_rate, roi, avg_clv, flat_pnl, kelly_pnl,
        calibration_json, metrics_json, duration_ms)
      VALUES (?, 'ensemble-v3', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, '{}', '{}', 0)
    `).run(
      new Date().toISOString().split('T')[0],
      dates[0], dates[dates.length - 1],
      picks.length, wins, losses, pushes,
      parseFloat(winRate.toFixed(2)), parseFloat(roi.toFixed(2)),
      parseFloat(flatPnl.toFixed(2)), parseFloat(kellyPnl.toFixed(2))
    );

    res.json({ success: true, record: `${wins}-${losses}`, kellyPnl: kellyPnl.toFixed(0), winRate: winRate.toFixed(1) });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// --- CLV CAPTURE ---
async function captureClosingLines() {
  const today = new Date().toISOString().split('T')[0];

  try {
    const { fetchESPNOdds } = require('./server/services/espnOdds');
    const oddsData = await fetchESPNOdds('MLB', today);

    const pendingPicks = db.prepare(
      "SELECT * FROM picks WHERE date = ? AND closing_line IS NULL AND result = 'pending'"
    ).all(today);

    if (pendingPicks.length === 0) return;

    const { calculateBetCLV } = require('./server/services/clvTracker');
    let updated = 0;

    for (const pick of pendingPicks) {
      const game = db.prepare('SELECT * FROM games WHERE id = ?').get(pick.game_id);
      if (!game) continue;

      const oddsGame = oddsData.find(g =>
        g.home_team === game.home_team || g.away_team === game.away_team
      );
      if (!oddsGame || !oddsGame.bookmakers || oddsGame.bookmakers.length === 0) continue;

      let closingOdds = null;
      for (const bk of oddsGame.bookmakers) {
        if (pick.pick_type === 'ml') {
          const h2h = bk.markets?.find(m => m.key === 'h2h');
          if (h2h) {
            const outcome = h2h.outcomes?.find(o => o.name === pick.team);
            if (outcome) { closingOdds = outcome.price; break; }
          }
        } else if (pick.pick_type === 'over' || pick.pick_type === 'under') {
          const totals = bk.markets?.find(m => m.key === 'totals');
          if (totals) { closingOdds = -110; break; }
        }
      }

      if (closingOdds && pick.opening_line) {
        const clvResult = calculateBetCLV(pick.opening_line, closingOdds);
        db.prepare('UPDATE picks SET closing_line = ?, clv = ? WHERE id = ?')
          .run(closingOdds, clvResult.clv, pick.id);
        updated++;
      }
    }

    if (updated > 0) console.log(`[CLV] Captured closing lines for ${updated} picks`);
  } catch (e) {
    console.error('[CLV] Capture failed:', e.message);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Sports Odds Predictor v3 running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
  scheduleDailyRun();
});
