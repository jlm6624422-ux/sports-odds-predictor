/**
 * Sports Odds Predictor — PWA Server
 *
 * Serves daily predictions, runs ensemble model on-demand and via cron.
 * Deployable to Railway/Render with auto-predictions at 7am ET daily.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

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

  console.log(`[${new Date().toISOString()}] Running predictions for ${today}...`);

  // Fetch all data
  const [{ ratings: eloRatings }, standings, pitcherData] = await Promise.all([
    buildCurrentElo('MLB'),
    fetchTeamRunDifferentials(),
    mlb.getProbablePitchers(today.slice(0, 4) + '-' + today.slice(4, 6) + '-' + today.slice(6, 8)),
  ]);

  // Fetch live odds (ESPN DraftKings lines — no DNS issues)
  const { fetchESPNOdds } = require('./server/services/espnOdds');
  let oddsData = [];
  try {
    oddsData = await fetchESPNOdds('MLB', today.slice(0,4) + '-' + today.slice(4,6) + '-' + today.slice(6,8));
    console.log(`[odds] ESPN odds fetched: ${oddsData.filter(g => g.bookmakers.length > 0).length} games with lines`);
  } catch (e) { console.log('ESPN odds fetch failed, continuing without market data:', e.message); }

  const oddsMap = new Map();
  for (const g of oddsData) oddsMap.set(g.home_team, g);

  // Run ensemble for each game
  const games = pitcherData.dates?.[0]?.games || [];
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
    try { const wi = await getGameWeatherImpact(venue, `${today.slice(0,4)}-${today.slice(4,6)}-${today.slice(6,8)}T19:00`); weather = wi.weather; } catch(e) {}

    const pred = ensembleMLB({
      homeTeam: { name: homeTeamName, ...homeStats, leftPct: 0.45 },
      awayTeam: { name: awayTeamName, ...awayStats, leftPct: 0.45 },
      homePitcher, awayPitcher,
      homeElo: eloRatings.get(homeTeamName) || 1500,
      awayElo: eloRatings.get(awayTeamName) || 1500,
      bookmakers, venue, weather, homeBullpen: null, awayBullpen: null, bankroll: 1000,
    });

    let ouLine = null;
    if (bookmakers) {
      for (const bk of bookmakers) {
        const totals = bk.markets?.find(m => m.key === 'totals');
        if (totals) { ouLine = totals.outcomes?.[0]?.point; break; }
      }
    }

    mlbResults.push({
      home: homeTeamName, away: awayTeamName, venue,
      homePitcher: homePitcher?.name || 'TBD', awayPitcher: awayPitcher?.name || 'TBD',
      prediction: pred.prediction, edge: pred.edge, kelly: pred.kelly,
      subModels: pred.subModels, confidence: pred.confidence, modelsUsed: pred.modelsUsed,
      ouLine, totalEdge: ouLine ? parseFloat((pred.prediction.expectedTotal - ouLine).toFixed(1)) : null,
    });
  }

  // NBA (fetch from ESPN)
  let nbaGames = [];
  try {
    const nbaRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today}`);
    const nbaData = await nbaRes.json();
    nbaGames = (nbaData.events || []).map(e => {
      const comp = e.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      const odds = (comp.odds || [])[0] || {};
      return {
        home: home.team.displayName, away: away.team.displayName,
        homeRecord: (home.records||[{}])[0]?.summary, awayRecord: (away.records||[{}])[0]?.summary,
        spread: odds.details, ou: odds.overUnder,
        status: comp.status?.type?.shortDetail,
      };
    });
  } catch(e) {}

  // Build parlays from actionable bets
  const actionable = mlbResults.filter(g => g.kelly && g.kelly.betSize > 0);

  // Save to file
  const output = {
    date: today.slice(0,4) + '-' + today.slice(4,6) + '-' + today.slice(6,8),
    generatedAt: new Date().toISOString(),
    mlb: mlbResults,
    nba: nbaGames,
    actionableBets: actionable.length,
    summary: {
      mlbGames: mlbResults.length,
      nbaGames: nbaGames.length,
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

// Cron: auto-run predictions at 7am ET
function scheduleDailyRun() {
  const checkInterval = 60 * 1000; // Check every minute
  let lastRunDate = null;

  setInterval(() => {
    const now = new Date();
    const etHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
    const todayStr = now.toISOString().split('T')[0];

    // Run at 7am ET if we haven't run today
    if (etHour === 7 && lastRunDate !== todayStr) {
      lastRunDate = todayStr;
      console.log(`[CRON] Auto-running predictions for ${todayStr}`);
      runPredictions().catch(e => console.error('[CRON] Failed:', e.message));
    }
  }, checkInterval);

  console.log('[CRON] Scheduled daily predictions at 7:00 AM ET');
}

function getLastPredictionTime() {
  const cachePath = path.join(__dirname, 'data', 'today.json');
  if (fs.existsSync(cachePath)) {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return data.generatedAt;
  }
  return null;
}

// Start server
app.listen(PORT, () => {
  console.log(`Sports Odds Predictor running on port ${PORT}`);
  console.log(`Open: http://localhost:${PORT}`);
  scheduleDailyRun();
});
