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

app.get('/nba', (req, res) => {
  res.sendFile(path.join(__dirname, 'nba-picks.html'));
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
  if (!fs.existsSync(historyDir)) return res.json({ days: [] });

  const files = fs.readdirSync(historyDir).sort().reverse().slice(0, 14);
  const days = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8'));
      if (!data.nba || data.nba.length === 0) continue;
      const picks = [];
      for (const game of data.nba) {
        if (game.propPicks) {
          for (const prop of game.propPicks) {
            picks.push({
              type: 'prop',
              team: `${prop.name} ${prop.direction} ${prop.line} ${prop.stat}`,
              matchup: `${game.away} @ ${game.home}`,
              line: `${prop.direction} ${prop.line} (${prop.edge > 0 ? '+' : ''}${prop.edge} edge)`,
              odds: '-110',
              confidence: prop.confidence?.toLowerCase() || 'med',
              thesis: `Avg ${prop.seasonAvg} → Proj ${prop.projected}`,
              result: 'pending',
              score: '',
            });
          }
        }
      }
      if (picks.length > 0) {
        days.push({ date: f.replace('.json', ''), picks });
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

        picks.push({
          type: 'ml', team, matchup: matchupStr, line: lineStr,
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
  let nbaProps = [];
  try {
    const nbaRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today}`);
    const nbaData = await nbaRes.json();
    const nbaEvents = nbaData.events || [];

    const { generateNBAProps } = require('./server/services/nbaPropsEngine');
    const propsResult = generateNBAProps(nbaEvents);
    nbaGames = propsResult.games;
    nbaProps = propsResult.props;
  } catch(e) {
    console.log('[NBA] Props generation failed, falling back to basic game info:', e.message);
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
    } catch(e2) {}
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

// Cron: auto-run predictions at 7am ET
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

  // Grade the last 3 days of history that have ungraded picks
  const files = fs.readdirSync(historyDir).sort().reverse().slice(0, 3);
  let graded = 0;

  for (const f of files) {
    const date = f.replace('.json', '');
    const dayResults = results[date] || {};

    // Fetch final scores for this date
    let games;
    try {
      const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore`);
      const data = await res.json();
      games = (data.dates?.[0]?.games || []).filter(g => g.status.detailedState.includes('Final'));
    } catch (e) { continue; }

    if (games.length === 0) continue;

    const historyData = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8'));

    for (const game of (historyData.mlb || [])) {
      const prediction = game.prediction || {};
      const edge = game.edge || {};
      const ouLine = game.ouLine;
      const expectedTotal = prediction.expectedTotal || 0;
      const totalEdge = ouLine ? expectedTotal - ouLine : 0;
      const confidence = game.confidence || 'low';
      const matchupStr = `${getAbbrev(game.away)} @ ${getAbbrev(game.home)}`;

      // Find the matching final game
      const finalGame = games.find(g =>
        getAbbrev(g.teams.away.team.name) === getAbbrev(game.away) &&
        getAbbrev(g.teams.home.team.name) === getAbbrev(game.home)
      );
      if (!finalGame) continue;

      const homeScore = finalGame.teams.home.score;
      const awayScore = finalGame.teams.away.score;
      const total = homeScore + awayScore;
      const winner = homeScore > awayScore ? finalGame.teams.home.team.name : finalGame.teams.away.team.name;
      const score = `${finalGame.teams.away.team.name.split(' ').pop()} ${awayScore}, ${finalGame.teams.home.team.name.split(' ').pop()} ${homeScore}`;

      // Grade ML pick
      if (confidence === 'high' && !game.coinFlip) {
        const resultKey = `${matchupStr}-ml`;
        if (!dayResults[resultKey]) {
          const side = prediction.homeWinProb > prediction.awayWinProb ? 'home' : 'away';
          const pickedTeam = side === 'home' ? game.home : game.away;
          const won = winner === pickedTeam;
          dayResults[resultKey] = { result: won ? 'win' : 'loss', score, recordedAt: new Date().toISOString() };
          graded++;
        }
      }

      // Grade O/U pick
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
  const checkInterval = 60 * 1000; // Check every minute
  let lastRunDate = null;
  let lastGradeDate = null;

  // Startup catch-up: if past 7am ET and today's predictions don't exist, run immediately
  const startupNow = new Date();
  const etNow = new Date(startupNow.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const etHourNow = etNow.getHours();
  const todayDate = startupNow.toISOString().split('T')[0];
  const historyPath = path.join(__dirname, 'data', 'history', `${todayDate}.json`);

  if (etHourNow >= 7 && !fs.existsSync(historyPath)) {
    console.log(`[CRON] Startup catch-up: it's ${etHourNow}:00 ET and no predictions for ${todayDate}, running now...`);
    runPredictions().catch(e => console.error('[CRON] Startup catch-up failed:', e.message));
    lastRunDate = todayDate;
  } else if (fs.existsSync(historyPath)) {
    lastRunDate = todayDate;
  }

  if (etHourNow >= 2) {
    lastGradeDate = todayDate;
    if (etHourNow >= 2 && etHourNow < 7) {
      gradeResults().catch(e => console.error('[CRON] Startup grade failed:', e.message));
    }
  }

  setInterval(() => {
    const now = new Date();
    const etHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
    const todayStr = now.toISOString().split('T')[0];

    // 2am ET: grade yesterday's results
    if (etHour === 2 && lastGradeDate !== todayStr) {
      lastGradeDate = todayStr;
      console.log(`[CRON] Auto-grading results for previous days`);
      gradeResults().catch(e => console.error('[CRON] Grade failed:', e.message));
    }

    // 7am ET: run new predictions
    if (etHour === 7 && lastRunDate !== todayStr) {
      lastRunDate = todayStr;
      console.log(`[CRON] Auto-running predictions for ${todayStr}`);
      runPredictions().catch(e => console.error('[CRON] Failed:', e.message));
    }
  }, checkInterval);

  console.log('[CRON] Scheduled: grade results at 2:00 AM ET, predictions at 7:00 AM ET');
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
