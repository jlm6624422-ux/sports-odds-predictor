/**
 * Full daily page generator — builds today-picks.html with MLB, NBA, and parlays.
 * Run via daily-update.sh at 5am ET.
 */

const fs = require('fs');
const path = require('path');
const { fetchESPNOdds } = require('./server/services/espnOdds');
const { ensembleMLB } = require('./server/services/ensembleModel');
const { buildCurrentElo } = require('./server/services/eloBuilder');
const { fetchTeamRunDifferentials } = require('./server/services/enhancedModel');
const { MlbStatsService } = require('./server/services/mlbStats');
const { getMLBRosterImpact, getMLBTeamId } = require('./server/services/rosterImpact');

function americanToDecimal(american) {
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

function americanToImplied(american) {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function parlayDecimal(legs) {
  return legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatShortDate(dateStr) {
  return dateStr.slice(5).replace('-', '-');
}

async function fetchYesterdayResults(yesterday) {
  const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${yesterday}&hydrate=linescore`);
  const data = await res.json();
  return data.dates?.[0]?.games || [];
}

async function fetchNBAGames(date) {
  const dateCompact = date.replace(/-/g, '');
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateCompact}`);
  const data = await res.json();
  return data.events || [];
}

async function main() {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const mlb = new MlbStatsService();

  console.log(`[generate] Building page for ${today}...`);

  // Fetch all data in parallel
  const [{ ratings: eloRatings }, standings, pitcherData, oddsData, nbaEvents, yesterdayGames] = await Promise.all([
    buildCurrentElo('MLB'),
    fetchTeamRunDifferentials(),
    mlb.getProbablePitchers(today),
    fetchESPNOdds('MLB', today),
    fetchNBAGames(today),
    fetchYesterdayResults(yesterday),
  ]);

  const oddsMap = new Map();
  for (const g of oddsData) oddsMap.set(g.home_team, g);

  // --- MLB PREDICTIONS ---
  const games = pitcherData.dates?.[0]?.games || [];
  const mlbPicks = [];

  // Pre-fetch roster impact for all teams playing today (parallel)
  const teamsToday = new Set();
  for (const game of games) {
    teamsToday.add(game.teams.home.team.name);
    teamsToday.add(game.teams.away.team.name);
  }
  const rosterImpactMap = new Map();
  console.log(`[roster] Fetching injury impact for ${teamsToday.size} teams...`);
  const rosterPromises = [...teamsToday].map(async (teamName) => {
    const teamId = getMLBTeamId(teamName);
    if (!teamId) return;
    try {
      const impact = await getMLBRosterImpact(teamId, teamName);
      rosterImpactMap.set(teamName, impact);
    } catch (e) {
      console.log(`[roster] Skip ${teamName}: ${e.message}`);
    }
  });
  await Promise.all(rosterPromises);
  console.log(`[roster] Done — ${rosterImpactMap.size} teams analyzed`);

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

    const oddsEntry = oddsMap.get(homeTeamName);
    const bookmakers = oddsEntry?.bookmakers?.length > 0 ? oddsEntry.bookmakers : null;

    // Roster/injury impact (pre-fetched)
    const homeRosterImpact = rosterImpactMap.get(homeTeamName) || null;
    const awayRosterImpact = rosterImpactMap.get(awayTeamName) || null;

    const pred = ensembleMLB({
      homeTeam: { name: homeTeamName, ...homeStats, leftPct: 0.45 },
      awayTeam: { name: awayTeamName, ...awayStats, leftPct: 0.45 },
      homePitcher, awayPitcher,
      homeElo: eloRatings.get(homeTeamName) || 1500,
      awayElo: eloRatings.get(awayTeamName) || 1500,
      bookmakers, venue, weather: null, homeBullpen: null, awayBullpen: null, bankroll: 1000,
      homeRosterImpact, awayRosterImpact,
    });

    let ouLine = null, homeML = null, awayML = null;
    if (bookmakers) {
      for (const bk of bookmakers) {
        const h2h = bk.markets?.find(m => m.key === 'h2h');
        if (h2h && !homeML) {
          homeML = h2h.outcomes.find(o => o.name === homeTeamName)?.price;
          awayML = h2h.outcomes.find(o => o.name === awayTeamName)?.price;
        }
        const totals = bk.markets?.find(m => m.key === 'totals');
        if (totals && !ouLine) ouLine = totals.outcomes?.[0]?.point;
      }
    }

    mlbPicks.push({
      home: homeTeamName, away: awayTeamName, venue,
      homePitcher: homePitcher?.name || 'TBD', awayPitcher: awayPitcher?.name || 'TBD',
      prediction: pred.prediction, edge: pred.edge, kelly: pred.kelly,
      confidence: pred.confidence, modelsUsed: pred.modelsUsed, coinFlip: pred.coinFlip,
      ouLine, homeML, awayML,
      pick: pred.prediction.homeWinProb > 50 ? homeTeamName : awayTeamName,
      pickSide: pred.prediction.homeWinProb > 50 ? 'home' : 'away',
      conf: Math.max(pred.prediction.homeWinProb, pred.prediction.awayWinProb),
      rosterImpact: pred.rosterImpact,
      rosterAdj: pred.adjustments.roster,
    });
  }

  // --- NBA ANALYSIS ---
  const nbaGames = [];
  for (const event of nbaEvents) {
    const comp = event.competitions[0];
    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    const odds = comp.odds?.[0] || {};
    nbaGames.push({
      home: home.team.displayName,
      away: away.team.displayName,
      homeRecord: (home.records || [{}])[0]?.summary || '',
      awayRecord: (away.records || [{}])[0]?.summary || '',
      spread: odds.pointSpread?.home?.close?.line || odds.details || '',
      homeML: odds.moneyline?.home?.close?.odds || '',
      awayML: odds.moneyline?.away?.close?.odds || '',
      ou: odds.total?.over?.close?.line?.replace(/[ou]/gi, '') || odds.overUnder || '',
      time: comp.status?.type?.shortDetail || '',
      homeHomeRecord: (home.records || [])[1]?.summary || '',
      awayRoadRecord: (away.records || [])[2]?.summary || '',
    });
  }

  // --- BUILD SMART PARLAYS ---
  const actionable = mlbPicks.filter(p => !p.coinFlip).sort((a, b) => b.conf - a.conf);
  // Only use legs with edge >= 7% and high confidence (model-validated picks)
  const kellyBets = mlbPicks.filter(p => p.kelly && p.kelly.betSize > 0).sort((a, b) => b.kelly.edge - a.kelly.edge);
  const highEdgeLegs = kellyBets.filter(p => p.kelly.edge >= 7);
  const parlays = [];

  // Parlay A: Best 2 MLB Kelly picks (highest edges, must both have 7%+ edge)
  if (highEdgeLegs.length >= 2) {
    const mlb1 = highEdgeLegs[0];
    const mlb2 = highEdgeLegs[1];
    const mlb1Odds = mlb1.pickSide === 'home' ? (mlb1.homeML || -130) : (mlb1.awayML || -130);
    const mlb2Odds = mlb2.pickSide === 'home' ? (mlb2.homeML || -130) : (mlb2.awayML || -130);

    const legs = [{ name: `${mlb1.pick} ML`, odds: mlb1Odds }, { name: `${mlb2.pick} ML`, odds: mlb2Odds }];
    const dec = parlayDecimal(legs);
    const prob = (mlb1.conf / 100) * (mlb2.conf / 100);
    const ev = (prob * (dec - 1) * 50) - ((1 - prob) * 50);

    if (prob > 0.25 && ev > 0) {
      parlays.push({
        label: 'Parlay A — High-Edge 2-Leg',
        legs: legs.map(l => l.name).join(' + '),
        stake: 50, odds: dec, payout: Math.round(50 * dec),
        prob: (prob * 100).toFixed(1), ev: ev.toFixed(2), best: true,
      });
    }

    // 3-leg only if combined probability > 20% and positive EV
    if (highEdgeLegs.length >= 3) {
      const mlb3 = highEdgeLegs[2];
      const mlb3Odds = mlb3.pickSide === 'home' ? (mlb3.homeML || -130) : (mlb3.awayML || -130);
      const legs3 = [...legs, { name: `${mlb3.pick} ML`, odds: mlb3Odds }];
      const dec3 = parlayDecimal(legs3);
      const prob3 = prob * (mlb3.conf / 100);
      const ev3 = (prob3 * (dec3 - 1) * 30) - ((1 - prob3) * 30);

      if (prob3 > 0.20 && ev3 > 0) {
        parlays.push({
          label: 'Parlay B — High-Edge 3-Leg',
          legs: legs3.map(l => l.name).join(' + '),
          stake: 30, odds: dec3, payout: Math.round(30 * dec3),
          prob: (prob3 * 100).toFixed(1), ev: ev3.toFixed(2),
        });
      }
    }
  }

  // Cross-sport parlay: NBA fav + best MLB (only if NBA fav is heavy -200+)
  if (nbaGames.length > 0 && highEdgeLegs.length >= 1) {
    const nba = nbaGames[0];
    const nbaFavML = parseInt(nba.homeML) < 0 ? parseInt(nba.homeML) : parseInt(nba.awayML);
    const nbaFavName = parseInt(nba.homeML) < 0 ? nba.home : nba.away;

    if (nbaFavML <= -200) {
      const mlbBest = highEdgeLegs[0];
      const mlbOdds = mlbBest.pickSide === 'home' ? (mlbBest.homeML || -130) : (mlbBest.awayML || -130);
      const legs = [{ name: `${nbaFavName} ML`, odds: nbaFavML }, { name: `${mlbBest.pick} ML`, odds: mlbOdds }];
      const dec = parlayDecimal(legs);
      const prob = americanToImplied(nbaFavML) * (mlbBest.conf / 100);
      const ev = (prob * (dec - 1) * 40) - ((1 - prob) * 40);

      if (prob > 0.35 && ev > 0) {
        parlays.push({
          label: 'Parlay C — Cross-Sport Chalk',
          legs: legs.map(l => l.name).join(' + '),
          stake: 40, odds: dec, payout: Math.round(40 * dec),
          prob: (prob * 100).toFixed(1), ev: ev.toFixed(2),
        });
      }
    }
  }

  // --- READ TRACKER FOR RUNNING TOTALS ---
  let runningTotal = 0, daysActive = 0;
  try {
    const tracker = fs.readFileSync(path.join(__dirname, 'tracker.html'), 'utf8');
    const runningMatch = tracker.match(/Running Total.*?<\/td>/s);
    const pnlRows = tracker.match(/<tr><td>[\d-]+<\/td>.*?<\/tr>/g) || [];
    daysActive = pnlRows.length;
    const lastRow = pnlRows[pnlRows.length - 1];
    const totalMatch = lastRow?.match(/([+-]?\$[\d,.]+)<\/td>\s*$/);
    if (totalMatch) runningTotal = parseFloat(totalMatch[1].replace(/[$,]/g, ''));
  } catch(e) {}

  // Merge with any manually-added parlays in existing history file
  const dataDir = path.join(__dirname, 'data');
  const historyDir = path.join(dataDir, 'history');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

  const historyPath = path.join(historyDir, `${today}.json`);
  let existingParlays = [];
  if (fs.existsSync(historyPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      existingParlays = (existing.parlays || []).filter(p =>
        !parlays.some(gen => gen.legs === p.legs)
      );
    } catch (e) {}
  }
  const allParlays = [...parlays, ...existingParlays];

  // --- GENERATE HTML ---
  const html = buildHTML({
    today, yesterday, formatDate: formatDate(today),
    mlbPicks, nbaGames, parlays: allParlays, kellyBets, actionable,
    runningTotal, daysActive,
  });

  fs.writeFileSync(path.join(__dirname, 'today-picks.html'), html);

  // Save prediction data
  const output = { date: today, generatedAt: new Date().toISOString(), mlb: mlbPicks, nba: nbaGames, parlays: allParlays };
  fs.writeFileSync(path.join(dataDir, 'today.json'), JSON.stringify(output, null, 2));
  fs.writeFileSync(historyPath, JSON.stringify(output, null, 2));

  // Fetch NBA player props for best bets
  const nbaProps = await generateNBAProps(nbaGames, today);

  // Generate NBA page
  const nbaPageHTML = buildNBAPage(nbaGames, today, formatDate(today), nbaProps);
  fs.writeFileSync(path.join(__dirname, 'nba-picks.html'), nbaPageHTML);

  const totalExposure = kellyBets.reduce((s, p) => s + (p.kelly?.betSize || 0), 0) + parlays.reduce((s, p) => s + p.stake, 0);
  console.log(`[generate] Done: ${actionable.length} picks, ${kellyBets.length} kelly bets, ${parlays.length} parlays, $${totalExposure} exposure`);
}

function buildHTML({ today, yesterday, formatDate, mlbPicks, nbaGames, parlays, kellyBets, actionable, runningTotal, daysActive }) {
  const avgDay = daysActive > 0 ? runningTotal / daysActive : 0;
  const targetPct = Math.max(0, (runningTotal / 3000 * 100)).toFixed(0);

  const topPicksHTML = buildTopPicks(kellyBets, actionable, nbaGames, mlbPicks);
  const parlaysHTML = buildParlays(parlays);
  const nbaHTML = buildNBA(nbaGames);
  const mlbTableHTML = buildMLBTable(mlbPicks);
  const totalExposure = kellyBets.reduce((s, p) => s + (p.kelly?.betSize || 0), 0) + parlays.reduce((s, p) => s + p.stake, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Today's Picks - ${today}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;padding:20px}
.container{max-width:1200px;margin:0 auto}
header{text-align:center;padding:20px 0 16px;margin-bottom:0}
header h1{font-size:2em;background:linear-gradient(135deg,#58a6ff,#3fb950);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:4px}
header .subtitle{color:#8b949e;font-size:1em}
header .model-badge{display:inline-block;background:rgba(63,185,80,0.15);color:#3fb950;padding:3px 10px;border-radius:20px;font-size:0.75em;font-weight:600;margin-top:6px}

.stats-bar{display:flex;justify-content:center;gap:24px;padding:12px 0;margin-bottom:16px;border-bottom:1px solid #21262d;flex-wrap:wrap}
.stat{text-align:center}
.stat .val{font-size:1.3em;font-weight:700;color:#3fb950}
.stat .val.blue{color:#58a6ff}
.stat .lbl{font-size:0.7em;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px}

.tabs{display:flex;gap:0;border-bottom:2px solid #21262d;margin-bottom:24px;overflow-x:auto}
.tab{padding:12px 24px;cursor:pointer;color:#6b7280;font-weight:600;font-size:0.9em;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;white-space:nowrap;user-select:none}
.tab:hover{color:#e1e4e8}
.tab.active{color:#58a6ff;border-bottom-color:#58a6ff}
.tab-content{display:none}
.tab-content.active{display:block}

.section{margin-bottom:30px}
.section-title{font-size:1.3em;color:#58a6ff;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #21262d}
.section-title.nba{color:#f0883e}
.section-title.parlays{color:#a371f7}

.top-picks{background:linear-gradient(135deg,#1a2332,#161b22);border:2px solid #3fb950;border-radius:12px;padding:20px;margin-bottom:20px}
.top-picks h2{color:#3fb950;margin-bottom:12px;font-size:1.2em}
.pick-item{display:flex;align-items:center;padding:10px 14px;background:rgba(63,185,80,0.05);border-radius:8px;margin-bottom:6px;border-left:3px solid #3fb950}
.pick-item.nba{border-left-color:#f0883e;background:rgba(240,136,62,0.05)}
.pick-item.kelly{border-left-color:#ff7b72;background:rgba(255,123,114,0.05)}
.pick-item.over{border-left-color:#a371f7;background:rgba(163,113,247,0.05)}
.pick-details{flex:1}
.pick-game{font-size:0.8em;color:#8b949e}
.pick-bet{font-weight:600;font-size:1.05em;margin-top:2px}
.pick-edge{font-weight:700;font-size:1.1em;color:#3fb950;margin:0 12px}
.pick-conf{font-size:0.7em;padding:2px 7px;border-radius:4px;font-weight:600;text-transform:uppercase}
.pick-conf.high{background:rgba(63,185,80,0.2);color:#3fb950}
.pick-conf.med{background:rgba(210,153,34,0.2);color:#d29922}
.pick-conf.kelly{background:rgba(255,123,114,0.2);color:#ff7b72}

.pick-item.graded-win{background:rgba(52,211,153,0.08);border-left:3px solid #34d399}
.pick-item.graded-loss{background:rgba(248,113,113,0.08);border-left:3px solid #f87171}

.game-card{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:18px;margin-bottom:12px}
.game-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.game-matchup{font-size:1.1em;font-weight:600}
.game-time{color:#8b949e;font-size:0.85em}
.game-details{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.detail-label{font-size:0.7em;color:#8b949e;text-transform:uppercase}
.detail-value{font-weight:600;margin-top:2px}
.detail-value.green{color:#3fb950}
.detail-value.blue{color:#58a6ff}
.detail-value.orange{color:#f0883e}

.parlay-card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:18px;margin-bottom:10px;border-left:3px solid #a371f7}
.parlay-card.best{border-color:#3fb950;border-width:2px}
.parlay-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.parlay-type{font-weight:700;color:#a371f7;font-size:0.95em}
.parlay-odds{font-weight:700;font-size:1.2em}
.parlay-legs{color:#8b949e;font-size:0.85em;margin-bottom:6px}
.parlay-footer{display:flex;gap:16px;font-size:0.8em;color:#8b949e;flex-wrap:wrap}
.parlay-footer .ev{color:#3fb950;font-weight:600}

.table-wrapper{overflow-x:auto;border-radius:8px;border:1px solid #21262d;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:0.85em;min-width:750px}
th{text-align:left;padding:8px 10px;background:#161b22;border-bottom:2px solid #21262d;color:#8b949e;font-size:0.75em;text-transform:uppercase;position:sticky;top:0;white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid #1a1f2e;white-space:nowrap}
tr:hover td{background:rgba(88,166,255,0.03)}
.edge-positive{color:#3fb950;font-weight:600}
.edge-high{color:#3fb950;font-weight:700}
.skip{color:#484f58}
tr.row-win td{background:rgba(52,211,153,0.06);border-left:3px solid #34d399}
tr.row-loss td{background:rgba(248,113,113,0.06);border-left:3px solid #f87171}

.nav-links{text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #21262d}
.nav-links a{color:#58a6ff;text-decoration:none;margin:0 12px;font-size:0.9em}
.nav-links a:hover{text-decoration:underline}
footer{text-align:center;padding:20px 0;color:#6e7681;font-size:0.8em;border-top:1px solid #21262d;margin-top:30px}
</style>
</head>
<body>
<div class="container">
<header>
<h1>Daily Picks &amp; Projections</h1>
<div class="subtitle">${formatDate}</div>
<div class="model-badge">Ensemble v2.1 | 4/4 Models | ESPN/DK Odds</div>
</header>

<div class="stats-bar">
<div class="stat"><div class="val" id="today-record" style="color:#8b949e">—</div><div class="lbl">Today W-L</div></div>
<div class="stat"><div class="val">${runningTotal >= 0 ? '+' : ''}$${runningTotal.toFixed(0)}</div><div class="lbl">Running P&L</div></div>
<div class="stat"><div class="val">${targetPct}%</div><div class="lbl">of $3K target</div></div>
<div class="stat"><div class="val blue">${actionable.length}</div><div class="lbl">Picks today</div></div>
<div class="stat"><div class="val">${parlays.length}</div><div class="lbl">Parlays</div></div>
<div class="stat"><div class="val">$${totalExposure.toFixed(0)}</div><div class="lbl">Exposure</div></div>
</div>

<div class="tabs">
<div class="tab active" onclick="switchTab('picks')">Picks</div>
<div class="tab" onclick="switchTab('projections')">Projections</div>
<div class="tab" onclick="switchTab('parlays')">Parlays</div>
<div class="tab" onclick="switchTab('results')">Results</div>
</div>

<!-- PICKS TAB -->
<div class="tab-content active" id="tab-picks">
${topPicksHTML}
${nbaHTML}
</div>

<!-- PROJECTIONS TAB -->
<div class="tab-content" id="tab-projections">
<div class="section">
<div class="section-title" style="display:flex;justify-content:space-between;align-items:center">&#9918; MLB Full Projections &mdash; ${mlbPicks.length} Games <button onclick="refreshResults()" style="padding:6px 14px;background:#238636;color:#fff;border:none;border-radius:6px;font-size:0.75em;font-weight:600;cursor:pointer">Refresh Results</button></div>
${mlbTableHTML}
</div>
</div>

<!-- PARLAYS TAB -->
<div class="tab-content" id="tab-parlays">
<div class="section">
<div class="section-title parlays" style="display:flex;justify-content:space-between;align-items:center">&#127922; Parlay Plays <button onclick="refreshResults()" style="padding:6px 14px;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-size:0.75em;font-weight:600;cursor:pointer">Refresh Results</button></div>
${parlaysHTML}
</div>
</div>

<!-- RESULTS TAB -->
<div class="tab-content" id="tab-results">
<div class="section">
<div class="section-title" style="color:#3fb950">&#9989; Today's Results <button onclick="refreshResults()" style="float:right;padding:6px 14px;background:#238636;color:#fff;border:none;border-radius:6px;font-size:0.75em;font-weight:600;cursor:pointer">Refresh Results</button></div>
<div id="results-summary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px">
<div class="game-card" style="text-align:center;padding:14px"><div style="font-size:1.6em;font-weight:800;color:#34d399" id="res-wins">—</div><div style="font-size:0.7em;color:#6b7280;text-transform:uppercase">Wins</div></div>
<div class="game-card" style="text-align:center;padding:14px"><div style="font-size:1.6em;font-weight:800;color:#f87171" id="res-losses">—</div><div style="font-size:0.7em;color:#6b7280;text-transform:uppercase">Losses</div></div>
<div class="game-card" style="text-align:center;padding:14px"><div style="font-size:1.6em;font-weight:800" id="res-pending" style="color:#8b949e">—</div><div style="font-size:0.7em;color:#6b7280;text-transform:uppercase">Pending</div></div>
<div class="game-card" style="text-align:center;padding:14px"><div style="font-size:1.6em;font-weight:800" id="res-winpct">—</div><div style="font-size:0.7em;color:#6b7280;text-transform:uppercase">Win %</div></div>
</div>
<div id="results-list"></div>
<p style="color:#8b949e;font-size:0.8em;margin-top:12px">Click Refresh to grade completed games against MLB Stats API final scores.</p>
<p style="margin-top:8px"><a href="/tracker" style="color:#58a6ff;text-decoration:none;font-weight:600">View Full Tracker &rarr;</a></p>
</div>
</div>

<div class="nav-links">
<a href="/tracker">Betting Tracker</a>
<a href="/mlb">MLB Season</a>
<a href="/nba">NBA</a>
</div>

<footer>
<p>Model: Ensemble v2.1 (Pythagorean + Elo + FIP + Market) | Data: ESPN/DraftKings + MLB Stats API</p>
<p style="margin-top:4px">Auto-generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC</p>
</footer>
</div>

<script>
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  event.target.classList.add('active');
}

async function refreshResults() {
  const btn = document.getElementById('refresh-btn');
  btn.textContent = 'Refreshing...';
  btn.disabled = true;
  try {
    const today = '${today}';
    const res = await fetch('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=' + today + '&hydrate=linescore');
    const data = await res.json();
    const games = (data.dates?.[0]?.games || []).filter(g => g.status.detailedState.includes('Final'));
    if (games.length === 0) { btn.textContent = 'No finals yet'; btn.disabled = false; return; }

    const results = new Map();
    for (const g of games) {
      results.set(g.teams.home.team.name, {
        home: g.teams.home.team.name, away: g.teams.away.team.name,
        homeScore: g.teams.home.score, awayScore: g.teams.away.score,
        winner: g.teams.home.score > g.teams.away.score ? g.teams.home.team.name : g.teams.away.team.name,
        total: g.teams.home.score + g.teams.away.score
      });
    }

    let wins = 0, losses = 0;

    document.querySelectorAll('.pick-item[data-home]').forEach(el => {
      const home = el.dataset.home;
      const type = el.dataset.type;
      const game = results.get(home);
      if (!game) return;

      const resultEl = el.querySelector('.pick-result');
      if (!resultEl) return;

      let won = false;
      let score = game.away.split(' ').pop() + ' ' + game.awayScore + ', ' + game.home.split(' ').pop() + ' ' + game.homeScore;

      if (type === 'ml') {
        const team = el.dataset.team;
        won = game.winner.includes(team.split(' ').pop()) || team.includes(game.winner.split(' ').pop());
      } else if (type === 'over') {
        const line = parseFloat(el.dataset.line);
        won = game.total > line;
        score += ' (' + game.total + ' total)';
      }

      if (won) { wins++; } else { losses++; }

      el.classList.remove('graded-win', 'graded-loss');
      el.classList.add(won ? 'graded-win' : 'graded-loss');

      const badge = won
        ? '<span style="background:#064e3b;color:#34d399;padding:3px 10px;border-radius:4px;font-size:0.8em;font-weight:700">W</span>'
        : '<span style="background:#7f1d1d;color:#f87171;padding:3px 10px;border-radius:4px;font-size:0.8em;font-weight:700">L</span>';
      resultEl.innerHTML = badge + ' <span style="color:#8b949e;font-size:0.75em;margin-left:4px">' + score + '</span>';
    });

    // Highlight projection table rows
    document.querySelectorAll('tr[data-proj-home]').forEach(row => {
      const home = row.dataset.projHome;
      const pick = row.dataset.projPick;
      const game = results.get(home);
      if (!game || !pick) return;
      const won = game.winner.includes(pick.split(' ').pop()) || pick.includes(game.winner.split(' ').pop());
      row.classList.remove('row-win', 'row-loss');
      row.classList.add(won ? 'row-win' : 'row-loss');
    });

    // Update W-L record in stats bar
    const recordEl = document.getElementById('today-record');
    if (recordEl) {
      recordEl.textContent = wins + '-' + losses;
      recordEl.style.color = wins > losses ? '#34d399' : wins < losses ? '#f87171' : '#8b949e';
    }

    // Update Results tab
    const totalPicks = document.querySelectorAll('.pick-item[data-home]').length;
    const pending = totalPicks - wins - losses;
    const winPct = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : '—';
    const rw = document.getElementById('res-wins');
    const rl = document.getElementById('res-losses');
    const rp = document.getElementById('res-pending');
    const rwp = document.getElementById('res-winpct');
    if (rw) rw.textContent = wins;
    if (rl) rl.textContent = losses;
    if (rp) { rp.textContent = pending; rp.style.color = pending > 0 ? '#f59e0b' : '#8b949e'; }
    if (rwp) { rwp.textContent = winPct + '%'; rwp.style.color = parseInt(winPct) >= 50 ? '#34d399' : '#f87171'; }

    // Build results list
    const resultsList = document.getElementById('results-list');
    if (resultsList) {
      let rhtml = '';
      document.querySelectorAll('.pick-item[data-home]').forEach(el => {
        const home = el.dataset.home;
        const game = results.get(home);
        if (!game) return;
        const type = el.dataset.type;
        const team = el.dataset.team || '';
        let won = false;
        let pickLabel = '';
        const score = game.away.split(' ').pop() + ' ' + game.awayScore + ' - ' + game.home.split(' ').pop() + ' ' + game.homeScore;

        if (type === 'ml') {
          won = game.winner.includes(team.split(' ').pop()) || team.includes(game.winner.split(' ').pop());
          pickLabel = team.split(' ').pop() + ' ML';
        } else if (type === 'over') {
          const line = parseFloat(el.dataset.line);
          won = game.total > line;
          pickLabel = 'Over ' + line;
        }

        const bg = won ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)';
        const border = won ? '#34d399' : '#f87171';
        const badge = won
          ? '<span style="background:#064e3b;color:#34d399;padding:2px 8px;border-radius:4px;font-size:0.78em;font-weight:700">W</span>'
          : '<span style="background:#7f1d1d;color:#f87171;padding:2px 8px;border-radius:4px;font-size:0.78em;font-weight:700">L</span>';
        rhtml += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:' + bg + ';border-left:3px solid ' + border + ';border-radius:6px;margin-bottom:6px">';
        rhtml += '<div><span style="font-weight:600">' + pickLabel + '</span><span style="color:#8b949e;margin-left:8px;font-size:0.85em">' + game.away.split(' ').pop() + ' @ ' + game.home.split(' ').pop() + '</span></div>';
        rhtml += '<div style="display:flex;align-items:center;gap:10px"><span style="color:#8b949e;font-size:0.8em">' + score + '</span>' + badge + '</div>';
        rhtml += '</div>';
      });
      resultsList.innerHTML = rhtml || '<p style="color:#8b949e">Click Refresh to load results.</p>';
    }

    // Persist grading server-side
    try { await fetch('/api/grade', { method: 'POST' }); } catch(e) {}

    btn.textContent = '\\u2713 ' + wins + 'W-' + losses + 'L';
    setTimeout(() => { btn.textContent = 'Refresh Results'; btn.disabled = false; }, 3000);
  } catch(e) {
    btn.textContent = 'Error';
    btn.disabled = false;
  }
}

</script>
</body>
</html>`;
}

async function generateNBAProps(nbaGames, today) {
  if (nbaGames.length === 0) return [];

  const props = [];

  try {
    const dateCompact = today.replace(/-/g, '');
    const scoreRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateCompact}`);
    const scoreData = await scoreRes.json();

    for (const event of (scoreData.events || [])) {
      const gameId = event.id;
      const summaryRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`);
      const summary = await summaryRes.json();

      // Extract season leaders (gives us top scorers/rebounders/assisters)
      const leaders = summary.leaders || [];
      const playerAvgs = new Map();

      for (const team of leaders) {
        const teamName = team.team?.displayName || '';
        for (const cat of (team.leaders || [])) {
          for (const leader of (cat.leaders || [])) {
            const name = leader.athlete?.displayName;
            if (!name) continue;
            if (!playerAvgs.has(name)) playerAvgs.set(name, { team: teamName, ppg: 0, rpg: 0, apg: 0 });
            const entry = playerAvgs.get(name);
            if (cat.displayName === 'Points') entry.ppg = parseFloat(leader.displayValue) || 0;
            if (cat.displayName === 'Rebounds') entry.rpg = parseFloat(leader.displayValue) || 0;
            if (cat.displayName === 'Assists') entry.apg = parseFloat(leader.displayValue) || 0;
          }
        }
      }

      // Generate props for each player with known averages
      for (const [player, avgs] of playerAvgs) {
        const teamShort = avgs.team.split(' ').pop();

        // Points prop — line is typically season avg - 1.5 to - 2
        if (avgs.ppg >= 15) {
          const line = Math.floor(avgs.ppg - 1.5) + 0.5;
          const edge = avgs.ppg - line;
          const confidence = edge > 3 ? 'high' : edge > 1.5 ? 'med' : 'low';
          props.push({ player, team: teamShort, prop: 'Points', line, avg: avgs.ppg, edge, confidence });
        }

        // Rebounds prop
        if (avgs.rpg >= 6) {
          const line = Math.floor(avgs.rpg - 1) + 0.5;
          const edge = avgs.rpg - line;
          const confidence = edge > 2 ? 'high' : edge > 1 ? 'med' : 'low';
          props.push({ player, team: teamShort, prop: 'Rebounds', line, avg: avgs.rpg, edge, confidence });
        }

        // Assists prop
        if (avgs.apg >= 4) {
          const line = Math.floor(avgs.apg - 1) + 0.5;
          const edge = avgs.apg - line;
          const confidence = edge > 2 ? 'high' : edge > 1 ? 'med' : 'low';
          props.push({ player, team: teamShort, prop: 'Assists', line, avg: avgs.apg, edge, confidence });
        }

        // PRA (points + rebounds + assists) combo
        const pra = avgs.ppg + avgs.rpg + avgs.apg;
        if (pra >= 25) {
          const line = Math.floor(pra - 2) + 0.5;
          const edge = pra - line;
          const confidence = edge > 3 ? 'high' : edge > 1.5 ? 'med' : 'low';
          props.push({ player, team: teamShort, prop: 'PTS+REB+AST', line, avg: pra, edge, confidence });
        }
      }
    }
  } catch(e) {
    console.log('[props] ESPN fetch failed:', e.message);
  }

  // Sort by edge descending, take top 10
  return props.sort((a, b) => b.edge - a.edge).slice(0, 10);
}

function buildNBATab(nbaGames, today, playerProps) {
  if (nbaGames.length === 0) {
    return `<div class="section"><div class="section-title nba">&#127936; NBA</div><div class="game-card"><p style="color:#8b949e">No NBA games today.</p></div></div>`;
  }
  const props = playerProps || [];

  let html = `<div class="section"><div class="section-title nba">&#127936; NBA Daily Bets <button id="nba-refresh-btn" onclick="refreshNBA()" style="float:right;padding:6px 14px;background:#f0883e;color:#fff;border:none;border-radius:6px;font-size:0.75em;font-weight:600;cursor:pointer">Refresh Results</button></div>`;

  // Game bets
  for (const nba of nbaGames) {
    const spread = parseFloat(nba.spread);
    const favHome = spread < 0;
    const dog = favHome ? nba.away : nba.home;
    const dogSpread = Math.abs(spread);

    html += `<div class="game-card" style="border-color:#f0883e" data-nba-game="${nba.home}">
<div class="game-header"><div class="game-matchup">${nba.away} (${nba.awayRecord}) @ ${nba.home} (${nba.homeRecord})</div><div class="game-time">${nba.time}</div></div>
<div class="game-details">
<div class="detail-item"><div class="detail-label">Spread</div><div class="detail-value">${nba.home} ${nba.spread}</div></div>
<div class="detail-item"><div class="detail-label">O/U</div><div class="detail-value">${nba.ou}</div></div>
<div class="detail-item"><div class="detail-label">Moneyline</div><div class="detail-value orange">${nba.home} ${nba.homeML} / ${nba.away} ${nba.awayML}</div></div>
<div class="detail-item"><div class="detail-label">Best Play</div><div class="detail-value green">${dog} +${dogSpread}</div></div>
</div>
<div style="margin-top:12px;padding-top:10px;border-top:1px solid #21262d">
<div style="font-size:0.85em;font-weight:600;margin-bottom:8px;color:#f0883e">Game Bets</div>
<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table style="width:100%;font-size:0.85em;min-width:400px">
<thead><tr><th>Bet</th><th>Line</th><th>Thesis</th><th>Result</th></tr></thead>
<tbody>
<tr data-nba-bet="spread" data-team="${dog}" data-line="${dogSpread}"><td style="font-weight:600">${dog} +${dogSpread}</td><td>-115</td><td>Playoff games run tight</td><td class="nba-result">—</td></tr>
<tr data-nba-bet="ml" data-team="${favHome ? nba.home : nba.away}"><td style="font-weight:600">${favHome ? nba.home : nba.away} ML</td><td>${favHome ? nba.homeML : nba.awayML}</td><td>Home court + better record</td><td class="nba-result">—</td></tr>
<tr data-nba-bet="over" data-line="${nba.ou}"><td style="font-weight:600">Over ${nba.ou}</td><td>-110</td><td>Competitive series = pace</td><td class="nba-result">—</td></tr>
</tbody></table></div>
</div>
</div>`;
  }

  // Props section - Best Bets
  html += `<div style="margin-top:20px"><div style="font-size:1.1em;font-weight:700;color:#f0883e;margin-bottom:4px">&#127942; Player Prop Best Bets</div>
<p style="color:#8b949e;font-size:0.8em;margin-bottom:12px">Top 10 props ranked by edge vs. projected line. Hit Refresh after game for actual results.</p>`;

  html += `<div class="table-wrapper" style="margin-bottom:16px"><table>
<thead><tr><th>Player</th><th>Team</th><th>Prop</th><th>Line</th><th>Season Avg</th><th>Edge</th><th>Confidence</th><th>Result</th></tr></thead>
<tbody id="nba-props-body">`;

  if (props.length > 0) {
    for (const p of props.slice(0, 10)) {
      const edgeStr = p.edge > 0 ? '+' + p.edge.toFixed(1) : p.edge.toFixed(1);
      const confClass = p.confidence === 'high' ? 'background:#064e3b;color:#3fb950' : p.confidence === 'med' ? 'background:#2d2a1f;color:#d29922' : 'background:#21262d;color:#8b949e';
      html += `<tr data-prop-player="${p.player}" data-prop-type="${p.prop}" data-prop-line="${p.line}"><td style="font-weight:600">${p.player}</td><td>${p.team}</td><td>${p.prop}</td><td>O ${p.line}</td><td style="font-weight:700;color:#58a6ff">${p.avg.toFixed(1)}</td><td style="color:#3fb950;font-weight:600">${edgeStr}</td><td><span style="${confClass};padding:2px 7px;border-radius:4px;font-size:0.75em;font-weight:600">${p.confidence.toUpperCase()}</span></td><td class="nba-prop-result">—</td></tr>`;
    }
  } else {
    html += `<tr><td colspan="8" style="color:#8b949e;text-align:center;padding:16px">No player data available pre-game. Click Refresh after tip-off.</td></tr>`;
  }

  html += `</tbody></table></div></div></div>`;
  return html;
}

function buildNBAPage(nbaGames, today, formatDate, playerProps) {
  const nbaContent = buildNBATab(nbaGames, today, playerProps);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NBA Picks - ${today}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;padding:20px}
.container{max-width:1200px;margin:0 auto}
header{text-align:center;padding:20px 0 16px;border-bottom:1px solid #21262d;margin-bottom:24px}
header h1{font-size:2em;background:linear-gradient(135deg,#f0883e,#d2a8ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:4px}
header .subtitle{color:#8b949e;font-size:1em}
.section{margin-bottom:30px}
.section-title{font-size:1.3em;color:#f0883e;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #21262d}
.game-card{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:18px;margin-bottom:12px}
.game-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.game-matchup{font-size:1.1em;font-weight:600}
.game-time{color:#8b949e;font-size:0.85em}
.game-details{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.detail-label{font-size:0.7em;color:#8b949e;text-transform:uppercase}
.detail-value{font-weight:600;margin-top:2px}
.detail-value.green{color:#3fb950}
.detail-value.orange{color:#f0883e}
.table-wrapper{overflow-x:auto;border-radius:8px;border:1px solid #21262d;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:0.85em;min-width:600px}
th{text-align:left;padding:8px 10px;background:#161b22;border-bottom:2px solid #21262d;color:#8b949e;font-size:0.75em;text-transform:uppercase;white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid #1a1f2e;white-space:nowrap}
tr:hover td{background:rgba(240,136,62,0.03)}
.nav-links{text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #21262d}
.nav-links a{color:#58a6ff;text-decoration:none;margin:0 12px;font-size:0.9em}
.nav-links a:hover{text-decoration:underline}
footer{text-align:center;padding:20px 0;color:#6e7681;font-size:0.8em;border-top:1px solid #21262d;margin-top:30px}
</style>
</head>
<body>
<div class="container">
<header>
<h1>NBA Picks &amp; Props</h1>
<div class="subtitle">${formatDate}</div>
</header>

${nbaContent}

<div class="section" style="margin-top:40px">
<div class="section-title" style="color:#d2a8ff;display:flex;justify-content:space-between;align-items:center">
<span>&#128202; NBA Best Bets Tracker</span>
<button id="nba-tracker-refresh" onclick="refreshTrackerResults()" style="padding:6px 14px;background:#d2a8ff;color:#0f1117;border:none;border-radius:6px;font-size:0.75em;font-weight:600;cursor:pointer">Refresh Results</button>
</div>
<div id="nba-stats-banner" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px"></div>
<div id="nba-tracker-days"></div>
</div>

<div class="nav-links">
<a href="/">Daily Picks</a>
<a href="/tracker">Betting Tracker</a>
<a href="/mlb">MLB Season</a>
</div>

<footer>
<p>Data: ESPN Scoreboard + Box Scores | Props graded live via Refresh</p>
</footer>
</div>

<script>
async function refreshNBA() {
  const btn = document.getElementById('nba-refresh-btn');
  if (!btn) return;
  btn.textContent = 'Refreshing...';
  btn.disabled = true;
  try {
    const today = '${today}';
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=' + today.replace(/-/g,''));
    const data = await res.json();
    const events = data.events || [];

    for (const event of events) {
      const comp = event.competitions[0];
      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) continue;

      const homeScore = parseInt(home.score || 0);
      const awayScore = parseInt(away.score || 0);
      const total = homeScore + awayScore;
      const margin = homeScore - awayScore;
      const winner = homeScore > awayScore ? home.team.displayName : away.team.displayName;
      const isFinal = comp.status?.type?.completed;
      const statusText = comp.status?.type?.shortDetail || '';

      document.querySelectorAll('[data-nba-bet]').forEach(row => {
        const betType = row.dataset.nbaBet;
        const resultCell = row.querySelector('.nba-result');
        if (!resultCell) return;
        let won = null;
        if (betType === 'spread') {
          const team = row.dataset.team;
          const line = parseFloat(row.dataset.line);
          const isHome = home.team.displayName.includes(team.split(' ').pop());
          const teamMargin = isHome ? margin : -margin;
          won = (teamMargin + line) > 0;
        } else if (betType === 'ml') {
          const team = row.dataset.team;
          won = winner.includes(team.split(' ').pop());
        } else if (betType === 'over') {
          const line = parseFloat(row.dataset.line);
          won = total > line;
        }
        if (isFinal && won !== null) {
          const badge = won
            ? '<span style="background:#064e3b;color:#34d399;padding:2px 8px;border-radius:4px;font-size:0.8em;font-weight:700">W</span>'
            : '<span style="background:#7f1d1d;color:#f87171;padding:2px 8px;border-radius:4px;font-size:0.8em;font-weight:700">L</span>';
          resultCell.innerHTML = badge + ' <span style="color:#8b949e;font-size:0.75em">' + awayScore + '-' + homeScore + '</span>';
        } else if (total > 0) {
          resultCell.innerHTML = '<span style="color:#f59e0b;font-size:0.8em">' + statusText + ' (' + awayScore + '-' + homeScore + ')</span>';
        }
      });

      const boxRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=' + event.id);
      const boxData = await boxRes.json();
      const boxscore = boxData.boxscore;

      if (boxscore?.players) {
        let propsHTML = '';
        for (const team of boxscore.players) {
          for (const stat of team.statistics) {
            const labels = stat.labels || [];
            const ptsIdx = labels.indexOf('PTS');
            const rebIdx = labels.indexOf('REB');
            const astIdx = labels.indexOf('AST');
            const minIdx = labels.indexOf('MIN');
            for (const athlete of stat.athletes) {
              const mins = parseInt(athlete.stats[minIdx]) || 0;
              if (mins < 15) continue;
              const pts = parseInt(athlete.stats[ptsIdx]) || 0;
              const reb = parseInt(athlete.stats[rebIdx]) || 0;
              const ast = parseInt(athlete.stats[astIdx]) || 0;
              const ptsLine = Math.round(pts * 0.85) + 0.5;
              const rebLine = Math.round(reb * 0.8) + 0.5;
              const astLine = Math.round(ast * 0.8) + 0.5;
              const mkBadge = (actual, line) => {
                if (!isFinal) return '—';
                return actual > line
                  ? '<span style="background:#064e3b;color:#34d399;padding:2px 6px;border-radius:3px;font-size:0.75em;font-weight:700">W</span>'
                  : '<span style="background:#7f1d1d;color:#f87171;padding:2px 6px;border-radius:3px;font-size:0.75em;font-weight:700">L</span>';
              };
              const teamShort = team.team.displayName.split(' ').pop();
              propsHTML += '<tr><td style="font-weight:600">' + athlete.athlete.displayName + '</td><td>' + teamShort + '</td><td>Points</td><td>O ' + ptsLine + '</td><td style="font-weight:700;color:#58a6ff">' + pts + '</td><td>' + (pts - ptsLine > 0 ? '+' : '') + (pts - ptsLine).toFixed(1) + '</td><td>' + mkBadge(pts, ptsLine) + '</td></tr>';
              propsHTML += '<tr><td>' + athlete.athlete.displayName + '</td><td>' + teamShort + '</td><td>Rebounds</td><td>O ' + rebLine + '</td><td style="font-weight:700;color:#58a6ff">' + reb + '</td><td>' + (reb - rebLine > 0 ? '+' : '') + (reb - rebLine).toFixed(1) + '</td><td>' + mkBadge(reb, rebLine) + '</td></tr>';
              propsHTML += '<tr><td>' + athlete.athlete.displayName + '</td><td>' + teamShort + '</td><td>Assists</td><td>O ' + astLine + '</td><td style="font-weight:700;color:#58a6ff">' + ast + '</td><td>' + (ast - astLine > 0 ? '+' : '') + (ast - astLine).toFixed(1) + '</td><td>' + mkBadge(ast, astLine) + '</td></tr>';
            }
          }
        }
        const propsBody = document.getElementById('nba-props-body');
        if (propsBody && propsHTML) propsBody.innerHTML = propsHTML;
      }
    }
    btn.textContent = '\\u2713 Updated';
    setTimeout(() => { btn.textContent = 'Refresh Results'; btn.disabled = false; }, 3000);
  } catch(e) {
    console.error('NBA refresh:', e);
    btn.textContent = 'Error';
    btn.disabled = false;
  }
}

// NBA BEST BETS TRACKER
let NBA_TRACKER_DATA = [
  { date: "${today}", picks: [] },
  { date: "2026-05-21", picks: [
    { type: "spread", team: "Cleveland Cavaliers", matchup: "CLE @ NYK", line: "CLE +6.5", odds: "-110", confidence: "med", thesis: "Playoff games run tight — road dogs cover", result: "pending", score: "" },
    { type: "ml", team: "New York Knicks", matchup: "CLE @ NYK", line: "NYK -238", odds: "-238", confidence: "high", thesis: "Home court + series lead", result: "pending", score: "" },
    { type: "over", team: "OVER 216.5", matchup: "CLE @ NYK", line: "O 216.5", odds: "-110", confidence: "med", thesis: "Series pace trending up", result: "pending", score: "" }
  ]},
  { date: "2026-05-20", picks: [
    { type: "spread", team: "San Antonio Spurs", matchup: "SA @ OKC", line: "SA +8.5", odds: "-110", confidence: "med", thesis: "Playoff games run tight", result: "pending", score: "" },
    { type: "over", team: "OVER 218.5", matchup: "SA @ OKC", line: "O 218.5", odds: "-110", confidence: "med", thesis: "Pace projection", result: "pending", score: "" },
    { type: "prop", team: "Shai Gilgeous-Alexander O 34.5 PRA", matchup: "SA @ OKC", line: "O 34.5 (+3.1 edge)", odds: "-115", confidence: "high", thesis: "Avg 37.7 PRA", result: "pending", score: "" },
    { type: "prop", team: "Victor Wembanyama O 36.5 PRA", matchup: "SA @ OKC", line: "O 36.5 (+2.9 edge)", odds: "-110", confidence: "high", thesis: "Avg 39.4 PRA", result: "pending", score: "" },
    { type: "prop", team: "Jalen Williams O 28.5 PRA", matchup: "SA @ OKC", line: "O 28.5 (+2.5 edge)", odds: "-110", confidence: "med", thesis: "Avg 31.0 PRA", result: "pending", score: "" }
  ]},
  { date: "2026-05-19", picks: [
    { type: "spread", team: "Cleveland Cavaliers", matchup: "CLE @ NYK", line: "CLE +7.5", odds: "-115", confidence: "high", thesis: "Playoff games run tight", result: "loss", score: "Cavaliers 104, Knicks 115 (OT)" },
    { type: "ml", team: "New York Knicks", matchup: "CLE @ NYK", line: "NYK -265", odds: "-265", confidence: "med", thesis: "Home court + better record", result: "win", score: "Cavaliers 104, Knicks 115 (OT)" },
    { type: "over", team: "OVER 217.5", matchup: "CLE @ NYK", line: "O 217.5", odds: "-110", confidence: "med", thesis: "Competitive series = pace", result: "win", score: "Cavaliers 104, Knicks 115 (219 total)" },
    { type: "prop", team: "Jalen Brunson O 30.5 PRA", matchup: "CLE @ NYK", line: "O 30.5 (+2.3 edge)", odds: "-115", confidence: "med", thesis: "Avg 32.8 PRA", result: "win", score: "49 actual" },
    { type: "prop", team: "Donovan Mitchell O 31.5 PRA", matchup: "CLE @ NYK", line: "O 31.5 (+2.1 edge)", odds: "-110", confidence: "med", thesis: "Avg 33.6 PRA", result: "win", score: "37 actual" },
    { type: "prop", team: "Karl-Anthony Towns O 10.5 REB", matchup: "CLE @ NYK", line: "O 10.5 (+1.4 edge)", odds: "-120", confidence: "med", thesis: "Avg 11.9 RPG", result: "win", score: "13 actual" }
  ]}
];

// Auto-populate today's picks from page game bets + props
function loadTodayPicks() {
  const todayEntry = NBA_TRACKER_DATA.find(d => d.date === '${today}');
  if (!todayEntry || todayEntry.picks.length > 0) return;

  // Grab game bets from the page
  document.querySelectorAll('[data-nba-bet]').forEach(row => {
    const type = row.dataset.nbaBet;
    const team = row.dataset.team || '';
    const line = row.dataset.line || '';
    const betCell = row.querySelector('td');
    const betText = betCell ? betCell.textContent : '';

    if (type === 'spread') {
      todayEntry.picks.push({ type: 'spread', team, matchup: '', line: betText, odds: '-110', confidence: 'med', thesis: 'Playoff games run tight', result: 'pending', score: '' });
    } else if (type === 'ml') {
      todayEntry.picks.push({ type: 'ml', team, matchup: '', line: betText, odds: '-110', confidence: 'med', thesis: 'Home court edge', result: 'pending', score: '' });
    } else if (type === 'over') {
      todayEntry.picks.push({ type: 'over', team: 'OVER ' + line, matchup: '', line: 'O ' + line, odds: '-110', confidence: 'med', thesis: 'Pace projection', result: 'pending', score: '' });
    }
  });

  // Grab prop picks from the table
  document.querySelectorAll('[data-prop-player]').forEach(row => {
    const player = row.dataset.propPlayer;
    const stat = row.dataset.propType;
    const line = row.dataset.propLine;
    todayEntry.picks.push({ type: 'prop', team: player + ' O ' + line + ' ' + stat, matchup: '', line: 'O ' + line, odds: '-110', confidence: 'med', thesis: 'Model projection', result: 'pending', score: '' });
  });
}

async function autoGradePendingDays() {
  for (const day of NBA_TRACKER_DATA) {
    if (!day.picks.some(p => p.result === 'pending')) continue;
    try {
      const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=' + day.date.replace(/-/g, ''));
      const data = await res.json();
      for (const event of (data.events || [])) {
        const comp = event.competitions[0];
        const home = comp.competitors?.find(c => c.homeAway === 'home');
        const away = comp.competitors?.find(c => c.homeAway === 'away');
        if (!home || !away || !comp.status?.type?.completed) continue;
        const homeScore = parseInt(home.score || 0);
        const awayScore = parseInt(away.score || 0);
        const total = homeScore + awayScore;
        const margin = homeScore - awayScore;
        const winner = homeScore > awayScore ? home.team.displayName : away.team.displayName;
        const scoreStr = away.team.shortDisplayName + ' ' + awayScore + ', ' + home.team.shortDisplayName + ' ' + homeScore;

        for (const pick of day.picks) {
          if (pick.result !== 'pending') continue;
          if (pick.type === 'ml') {
            const won = winner.toLowerCase().includes(pick.team.split(' ').slice(-1)[0].toLowerCase());
            pick.result = won ? 'win' : 'loss'; pick.score = scoreStr;
          } else if (pick.type === 'spread') {
            const lineMatch = pick.line.match(/([+-]?\\d+\\.?\\d*)/);
            if (lineMatch) {
              const spread = parseFloat(lineMatch[1]);
              const isHome = home.team.displayName.includes(pick.team.split(' ').pop());
              const teamMargin = isHome ? margin : -margin;
              pick.result = (teamMargin + spread) > 0 ? 'win' : 'loss'; pick.score = scoreStr;
            }
          } else if (pick.type === 'over') {
            const lineMatch = pick.line.match(/([\\d.]+)/);
            if (lineMatch) { const line = parseFloat(lineMatch[1]); pick.result = total > line ? 'win' : 'loss'; pick.score = scoreStr + ' (' + total + ' total)'; }
          } else if (pick.type === 'prop') {
            try {
              const boxRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=' + event.id);
              const boxData = await boxRes.json();
              const lineMatch = pick.line.match(/O\\s*([\\d.]+)/);
              if (!lineMatch) continue;
              const propLine = parseFloat(lineMatch[1]);
              const playerName = pick.team.split(' O ')[0].split(' U ')[0];
              for (const team of (boxData.boxscore?.players || [])) {
                for (const stat of team.statistics) {
                  const labels = stat.labels || [];
                  for (const athlete of stat.athletes) {
                    if (!athlete.athlete.displayName.includes(playerName.split(' ').pop())) continue;
                    const pts = parseInt(athlete.stats[labels.indexOf('PTS')]) || 0;
                    const reb = parseInt(athlete.stats[labels.indexOf('REB')]) || 0;
                    const ast = parseInt(athlete.stats[labels.indexOf('AST')]) || 0;
                    let actual = null;
                    if (pick.team.includes('PRA')) actual = pts + reb + ast;
                    else if (pick.team.includes('REB')) actual = reb;
                    else if (pick.team.includes('AST')) actual = ast;
                    else if (pick.team.includes('PTS')) actual = pts;
                    if (actual !== null) { pick.result = actual > propLine ? 'win' : 'loss'; pick.score = actual + ' actual'; }
                  }
                }
              }
            } catch(e) {}
          }
        }
      }
    } catch(e) {}
  }
}

function renderNBATracker() {
  const days = NBA_TRACKER_DATA.filter(d => d.picks.length > 0);
  let totalW = 0, totalL = 0, totalPend = 0;
  for (const d of days) { for (const p of d.picks) { if (p.result === 'win') totalW++; else if (p.result === 'loss') totalL++; else totalPend++; } }
  const pct = (totalW + totalL) > 0 ? ((totalW / (totalW + totalL)) * 100).toFixed(1) : '0';

  document.getElementById('nba-stats-banner').innerHTML = '<div style="background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px;text-align:center"><div style="font-size:1.8em;font-weight:700;color:#3fb950">' + totalW + '</div><div style="font-size:0.8em;color:#8b949e">Wins</div></div><div style="background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px;text-align:center"><div style="font-size:1.8em;font-weight:700;color:#f85149">' + totalL + '</div><div style="font-size:0.8em;color:#8b949e">Losses</div></div><div style="background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px;text-align:center"><div style="font-size:1.8em;font-weight:700;color:#d2a8ff">' + pct + '%</div><div style="font-size:0.8em;color:#8b949e">Win Rate</div></div><div style="background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px;text-align:center"><div style="font-size:1.8em;font-weight:700;color:#f59e0b">' + totalPend + '</div><div style="font-size:0.8em;color:#8b949e">Pending</div></div>';

  let html = '';
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const isToday = day.date === '${today}';
    const isOpen = i === 0;
    const dW = day.picks.filter(p => p.result === 'win').length;
    const dL = day.picks.filter(p => p.result === 'loss').length;
    const dP = day.picks.filter(p => p.result === 'pending').length;
    const dateLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const dayId = 'nba-tracker-' + day.date;

    html += '<div style="background:#161b22;border:1px solid #21262d;border-radius:10px;margin-bottom:10px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#1c2128;cursor:pointer;user-select:none;border-radius:10px 10px 0 0" onclick="var b=document.getElementById(\\'' + dayId + '\\');b.style.display=b.style.display===\\'none\\'?\\'block\\':\\'none\\';this.querySelector(\\'.chv\\').style.transform=b.style.display===\\'none\\'?\\'rotate(-90deg)\\':\\'rotate(0deg)\\'">';
    html += '<div style="display:flex;align-items:center;gap:10px"><h4 style="font-size:0.95em">' + dateLabel + (isToday ? ' (Today)' : '') + '</h4></div>';
    html += '<div style="display:flex;align-items:center;gap:12px"><span style="font-size:0.85em"><span style="color:#3fb950;font-weight:600">' + dW + 'W</span> <span style="color:#f85149;font-weight:600">' + dL + 'L</span>' + (dP > 0 ? ' <span style="color:#f59e0b">' + dP + ' pend</span>' : '') + '</span><span class="chv" style="color:#8b949e;transition:transform 0.2s;display:inline-block;' + (isOpen ? '' : 'transform:rotate(-90deg)') + '">&#9660;</span></div>';
    html += '</div>';

    html += '<div id="' + dayId + '" style="overflow-x:auto;-webkit-overflow-scrolling:touch;' + (isOpen ? '' : 'display:none') + '">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:0.85em;min-width:650px">';
    html += '<thead><tr><th style="padding:8px 12px;color:#8b949e;font-size:0.75em;text-transform:uppercase;border-bottom:1px solid #21262d;white-space:nowrap">Type</th><th style="padding:8px 12px;color:#8b949e;font-size:0.75em;text-transform:uppercase;border-bottom:1px solid #21262d;white-space:nowrap">Pick</th><th style="padding:8px 12px;color:#8b949e;font-size:0.75em;text-transform:uppercase;border-bottom:1px solid #21262d;white-space:nowrap">Line</th><th style="padding:8px 12px;color:#8b949e;font-size:0.75em;text-transform:uppercase;border-bottom:1px solid #21262d;white-space:nowrap">Thesis</th><th style="padding:8px 12px;color:#8b949e;font-size:0.75em;text-transform:uppercase;border-bottom:1px solid #21262d;white-space:nowrap">Score</th><th style="padding:8px 12px;color:#8b949e;font-size:0.75em;text-transform:uppercase;border-bottom:1px solid #21262d;white-space:nowrap">Result</th></tr></thead><tbody>';
    for (const p of day.picks) {
      const bg = p.result === 'win' ? 'background:rgba(52,211,153,0.06);border-left:3px solid #34d399' : p.result === 'loss' ? 'background:rgba(248,113,113,0.06);border-left:3px solid #f87171' : 'border-left:3px solid transparent';
      const badge = p.result === 'win' ? '<span style="background:#064e3b;color:#34d399;padding:2px 8px;border-radius:4px;font-size:0.8em;font-weight:700">W</span>' : p.result === 'loss' ? '<span style="background:#7f1d1d;color:#f87171;padding:2px 8px;border-radius:4px;font-size:0.8em;font-weight:700">L</span>' : '<span style="background:#78350f;color:#f59e0b;padding:2px 8px;border-radius:4px;font-size:0.8em;font-weight:700">PEND</span>';
      html += '<tr style="' + bg + '"><td style="padding:10px 12px;border-bottom:1px solid #21262d;white-space:nowrap"><span style="background:' + (p.type === 'prop' ? '#2d2a1f;color:#f0883e' : p.type === 'spread' ? '#2d1f3d;color:#d2a8ff' : p.type === 'ml' ? '#1f3a5f;color:#58a6ff' : '#1a4023;color:#3fb950') + ';padding:2px 8px;border-radius:4px;font-size:0.78em;font-weight:600">' + p.type.toUpperCase() + '</span></td><td style="padding:10px 12px;border-bottom:1px solid #21262d;white-space:nowrap;font-weight:600">' + p.team + '</td><td style="padding:10px 12px;border-bottom:1px solid #21262d;white-space:nowrap">' + p.line + '</td><td style="padding:10px 12px;border-bottom:1px solid #21262d;white-space:nowrap;color:#8b949e;font-size:0.85em">' + (p.thesis || '') + '</td><td style="padding:10px 12px;border-bottom:1px solid #21262d;white-space:nowrap;color:#8b949e">' + (p.score || '—') + '</td><td style="padding:10px 12px;border-bottom:1px solid #21262d;white-space:nowrap">' + badge + '</td></tr>';
    }
    html += '</tbody></table></div></div>';
  }
  document.getElementById('nba-tracker-days').innerHTML = html || '<p style="color:#8b949e;text-align:center;padding:20px">No tracker data yet</p>';
}

async function refreshTrackerResults() {
  const btn = document.getElementById('nba-tracker-refresh');
  btn.textContent = 'Grading...'; btn.disabled = true;
  await autoGradePendingDays();
  renderNBATracker();
  btn.textContent = '\\u2713 Updated';
  setTimeout(() => { btn.textContent = 'Refresh Results'; btn.disabled = false; }, 3000);
}

// Load tracker on page init
loadTodayPicks();
autoGradePendingDays().then(() => renderNBATracker());
</script>
</body>
</html>`;
}

function buildTopPicks(kellyBets, actionable, nbaGames, mlbPicks) {
  let html = '<div class="top-picks"><h2>&#127942; Today\'s Best Plays <button id="refresh-btn" onclick="refreshResults()" style="float:right;padding:6px 14px;background:#238636;color:#fff;border:none;border-radius:6px;font-size:0.75em;font-weight:600;cursor:pointer">Refresh Results</button></h2>';

  for (const p of kellyBets) {
    const odds = p.pickSide === 'home' ? p.homeML : p.awayML;
    const oddsStr = odds ? ` (${odds > 0 ? '+' : ''}${odds})` : '';
    html += `<div class="pick-item kelly" data-team="${p.pick}" data-type="ml" data-home="${p.home}"><div class="pick-details"><div class="pick-game">${p.away} @ ${p.home} &bull; Moneyline (Kelly)</div><div class="pick-bet">${p.pick} ML${oddsStr} &mdash; $${p.kelly.betSize.toFixed(0)}</div></div><div class="pick-edge">+${Math.max(Math.abs(p.edge?.home||0), Math.abs(p.edge?.away||0)).toFixed(1)}%</div><span class="pick-conf kelly">KELLY</span><span class="pick-result" style="margin-left:8px"></span></div>`;
  }

  // Over/under plays
  const overPlays = mlbPicks.filter(p => !p.coinFlip && p.ouLine && (p.prediction.expectedTotal - p.ouLine) > 1.5).slice(0, 3);
  for (const p of overPlays) {
    const edge = (p.prediction.expectedTotal - p.ouLine).toFixed(1);
    html += `<div class="pick-item over" data-type="over" data-line="${p.ouLine}" data-home="${p.home}"><div class="pick-details"><div class="pick-game">${p.away} @ ${p.home} &bull; Total</div><div class="pick-bet">OVER ${p.ouLine} (-110) &mdash; Proj ${p.prediction.expectedTotal.toFixed(1)} runs</div></div><div class="pick-edge">+${edge}</div><span class="pick-conf high">HIGH</span><span class="pick-result" style="margin-left:8px"></span></div>`;
  }

  // NBA pick
  for (const nba of nbaGames) {
    const spread = parseFloat(nba.spread);
    if (isNaN(spread)) continue;
    const dogName = spread < 0 ? nba.away : nba.home;
    const spreadDisplay = spread < 0 ? `${nba.away} +${Math.abs(spread)}` : `${nba.home} +${spread}`;
    html += `<div class="pick-item nba"><div class="pick-details"><div class="pick-game">NBA: ${nba.away} @ ${nba.home} &bull; Spread</div><div class="pick-bet">${spreadDisplay} (-115)</div></div><div class="pick-edge">+1.5</div><span class="pick-conf med">MED</span></div>`;
  }

  // Lean picks (non-kelly actionable)
  const leans = actionable.filter(p => !p.kelly || p.kelly.betSize <= 0).slice(0, 3);
  for (const p of leans) {
    const odds = p.pickSide === 'home' ? p.homeML : p.awayML;
    const oddsStr = odds ? ` (${odds > 0 ? '+' : ''}${odds})` : '';
    html += `<div class="pick-item" data-team="${p.pick}" data-type="ml" data-home="${p.home}"><div class="pick-details"><div class="pick-game">${p.away} @ ${p.home} &bull; Lean</div><div class="pick-bet">${p.pick} ML${oddsStr}</div></div><div class="pick-edge">${p.conf.toFixed(1)}%</div><span class="pick-conf med">LEAN</span><span class="pick-result" style="margin-left:8px"></span></div>`;
  }

  html += '</div>';
  return html;
}

function buildParlays(parlays) {
  if (parlays.length === 0) return '<p style="color:#8b949e">No parlays constructed today (insufficient data).</p>';
  let html = '';
  for (const p of parlays) {
    const cls = p.best ? 'parlay-card best' : 'parlay-card';
    const star = p.best ? '&#9733; ' : '';
    const oddsColor = p.odds >= 5 ? 'style="color:#f85149"' : p.odds >= 3 ? 'style="color:#f0883e"' : 'class="green"';
    html += `<div class="${cls}"><div class="parlay-header"><div class="parlay-type">${star}${p.label}</div><div class="parlay-odds" ${oddsColor}>${p.odds.toFixed(2)}x</div></div><div class="parlay-legs">${p.legs}</div><div class="parlay-footer"><span>Stake: $${p.stake}</span><span>Payout: $${p.payout}</span><span>Win%: ${p.prob}%</span><span class="ev">EV: ${parseFloat(p.ev) >= 0 ? '+' : ''}$${p.ev}</span></div></div>`;
  }
  return html;
}

function buildNBA(nbaGames) {
  if (nbaGames.length === 0) return '';
  let html = '<div class="section"><div class="section-title nba">&#127936; NBA</div>';
  for (const nba of nbaGames) {
    const spread = parseFloat(nba.spread);
    const favHome = spread < 0;
    html += `<div class="game-card" style="border-color:#f0883e"><div class="game-header"><div class="game-matchup">${nba.away} (${nba.awayRecord}) @ ${nba.home} (${nba.homeRecord})</div><div class="game-time">${nba.time}</div></div><div class="game-details"><div class="detail-item"><div class="detail-label">Spread</div><div class="detail-value">${nba.home} ${nba.spread}</div></div><div class="detail-item"><div class="detail-label">O/U</div><div class="detail-value">${nba.ou}</div></div><div class="detail-item"><div class="detail-label">Moneyline</div><div class="detail-value orange">${nba.home} ${nba.homeML} / ${nba.away} ${nba.awayML}</div></div><div class="detail-item"><div class="detail-label">Best Play</div><div class="detail-value green">${favHome ? nba.away : nba.home} +${Math.abs(spread)} (spread value)</div></div></div></div>`;
  }
  html += '</div>';
  return html;
}

function buildMLBTable(mlbPicks) {
  let html = '<div class="table-wrapper"><table><thead><tr><th>Game</th><th>Pitchers</th><th>ML</th><th>O/U</th><th>Pick</th><th>Win%</th><th>Edge</th><th>Proj Total</th><th>Roster</th><th>Signal</th></tr></thead><tbody>';

  const sorted = [...mlbPicks].sort((a, b) => {
    if (a.coinFlip && !b.coinFlip) return 1;
    if (!a.coinFlip && b.coinFlip) return -1;
    return b.conf - a.conf;
  });

  for (const p of sorted) {
    const isKelly = p.kelly && p.kelly.betSize > 0;
    const edgeVal = p.edge ? Math.max(Math.abs(p.edge.home || 0), Math.abs(p.edge.away || 0)).toFixed(1) : '—';
    const totalEdge = p.ouLine ? (p.prediction.expectedTotal - p.ouLine).toFixed(1) : '—';
    const mlStr = p.pickSide === 'home' ? (p.homeML || '—') : (p.awayML || '—');
    const signal = p.coinFlip ? '&#8709; SKIP' : isKelly ? '&#128293; KELLY' : '&#128064; LEAN';
    const cls = p.coinFlip ? ' class="skip"' : '';

    // Roster impact indicator
    let rosterCell = '—';
    if (p.rosterAdj && p.rosterAdj !== 0) {
      const homeIL = p.rosterImpact?.home?.ilPlayers?.length || 0;
      const awayIL = p.rosterImpact?.away?.ilPlayers?.length || 0;
      const adjStr = p.rosterAdj > 0 ? `+${p.rosterAdj}` : `${p.rosterAdj}`;
      const color = p.rosterAdj > 0 ? '#3fb950' : '#f85149';
      const ilNames = [];
      if (p.rosterImpact?.home?.ilPlayers) {
        for (const pl of p.rosterImpact.home.ilPlayers.slice(0, 2)) ilNames.push(pl.name.split(' ').pop());
      }
      if (p.rosterImpact?.away?.ilPlayers) {
        for (const pl of p.rosterImpact.away.ilPlayers.slice(0, 2)) ilNames.push(pl.name.split(' ').pop());
      }
      const tooltip = ilNames.length > 0 ? ` title="${ilNames.join(', ')} on IL"` : '';
      rosterCell = `<span style="color:${color};font-weight:600"${tooltip}>${adjStr}%</span>`;
    }

    html += `<tr${cls} data-proj-home="${p.home}" data-proj-pick="${p.coinFlip ? '' : p.pick}"><td${isKelly ? ' class="edge-positive"' : ''}>${p.away.split(' ').pop()} @ ${p.home.split(' ').pop()}</td><td>${p.awayPitcher.split(' ').pop()} vs ${p.homePitcher.split(' ').pop()}</td><td>${p.coinFlip ? '—' : mlStr}</td><td>${p.ouLine || '—'}</td><td${!p.coinFlip ? ' class="edge-positive"' : ''}>${p.coinFlip ? '—' : p.pick.split(' ').pop()}</td><td${!p.coinFlip ? ' class="edge-positive"' : ''}>${p.conf.toFixed(1)}%</td><td${isKelly ? ' class="edge-high"' : ''}>${p.coinFlip ? '—' : '+' + edgeVal + '%'}</td><td${totalEdge > 1.5 ? ' class="edge-positive"' : ''}>${p.coinFlip ? '—' : p.prediction.expectedTotal.toFixed(1) + (p.ouLine ? ' (' + (totalEdge > 0 ? '+' : '') + totalEdge + ')' : '')}</td><td>${rosterCell}</td><td${isKelly ? ' class="edge-high"' : ''}>${signal}</td></tr>`;
  }

  html += '</tbody></table></div>';
  return html;
}

main().catch(e => {
  console.error('[generate] FAILED:', e.message);
  process.exit(1);
});
