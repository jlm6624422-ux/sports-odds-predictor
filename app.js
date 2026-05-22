/**
 * Sports Odds Predictor — PWA Server
 *
 * Serves daily predictions, runs ensemble model on-demand and via cron.
 * Deployable to Railway/Render with auto-predictions at 5am ET daily.
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

app.get('/mlb/today', (req, res) => {
  res.sendFile(path.join(__dirname, 'mlb-today.html'));
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

          if (legWon === null) { allGraded = false; allWon = false; break; }
          if (legWon === false) { allWon = false; break; }
        }

        if (allGraded || !allWon) {
          dayResults[resultKey] = { result: allWon ? 'win' : 'loss', recordedAt: new Date().toISOString() };
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
  const checkInterval = 60 * 1000;
  let lastRunDate = null;
  let lastGradeDate = null;

  function getETHour() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
  }

  function getTodayDate() {
    return new Date().toISOString().split('T')[0];
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

  if (etHourNow >= 5 && !todayHistoryExists()) {
    console.log(`[CRON] Startup catch-up: no predictions for ${todayDate}, running now...`);
    runPredictions().catch(e => console.error('[CRON] Startup catch-up failed:', e.message));
    lastRunDate = todayDate;
  } else if (todayHistoryExists()) {
    lastRunDate = todayDate;
  }

  setInterval(() => {
    const etHour = getETHour();
    const todayStr = getTodayDate();

    // Grade: fires at 2am ET, or any time after 2am if not yet graded today
    if (etHour >= 2 && lastGradeDate !== todayStr) {
      lastGradeDate = todayStr;
      console.log(`[CRON] Auto-grading results for previous days`);
      gradeResults().catch(e => console.error('[CRON] Grade failed:', e.message));
    }

    // Predictions: fires at 5am ET, or any time after 5am if file missing
    if (etHour >= 5 && lastRunDate !== todayStr && !todayHistoryExists()) {
      lastRunDate = todayStr;
      console.log(`[CRON] Auto-running predictions for ${todayStr}`);
      runPredictions().catch(e => console.error('[CRON] Failed:', e.message));
    } else if (todayHistoryExists()) {
      lastRunDate = todayStr;
    }
  }, checkInterval);

  console.log('[CRON] Scheduled: grade at 2am+ ET, predictions at 5am+ ET (with catch-up)');
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
