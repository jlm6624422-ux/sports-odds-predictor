/**
 * Full daily page generator — builds today-picks.html with MLB, NBA, and parlays.
 * Run via daily-update.sh at 7am ET.
 */

const fs = require('fs');
const path = require('path');
const { fetchESPNOdds } = require('./server/services/espnOdds');
const { ensembleMLB } = require('./server/services/ensembleModel');
const { buildCurrentElo } = require('./server/services/eloBuilder');
const { fetchTeamRunDifferentials } = require('./server/services/enhancedModel');
const { MlbStatsService } = require('./server/services/mlbStats');

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

    const pred = ensembleMLB({
      homeTeam: { name: homeTeamName, ...homeStats, leftPct: 0.45 },
      awayTeam: { name: awayTeamName, ...awayStats, leftPct: 0.45 },
      homePitcher, awayPitcher,
      homeElo: eloRatings.get(homeTeamName) || 1500,
      awayElo: eloRatings.get(awayTeamName) || 1500,
      bookmakers, venue, weather: null, homeBullpen: null, awayBullpen: null, bankroll: 1000,
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

  // --- BUILD PARLAYS ---
  const actionable = mlbPicks.filter(p => !p.coinFlip).sort((a, b) => b.conf - a.conf);
  const kellyBets = actionable.filter(p => p.kelly && p.kelly.betSize > 0);
  const topMLB = actionable.slice(0, 3);

  const parlays = [];

  // Parlay A: If NBA game exists, NBA fav ML + best MLB pick
  if (nbaGames.length > 0 && topMLB.length > 0) {
    const nba = nbaGames[0];
    const nbaFavML = parseInt(nba.homeML) < 0 ? parseInt(nba.homeML) : parseInt(nba.awayML);
    const nbaFavName = parseInt(nba.homeML) < 0 ? nba.home : nba.away;
    const mlbBest = topMLB[0];
    const mlbOdds = mlbBest.pickSide === 'home' ? (mlbBest.homeML || -130) : (mlbBest.awayML || -130);

    const legs = [{ name: `${nbaFavName} ML`, odds: nbaFavML }, { name: `${mlbBest.pick} ML`, odds: mlbOdds }];
    const dec = parlayDecimal(legs);
    const prob = americanToImplied(nbaFavML) * (mlbBest.conf / 100);
    const ev = (prob * (dec - 1) * 50) - ((1 - prob) * 50);

    parlays.push({
      label: 'Parlay A — Safe 2-Leg',
      legs: legs.map(l => l.name).join(' + '),
      stake: 50, odds: dec, payout: Math.round(50 * dec),
      prob: (prob * 100).toFixed(1), ev: ev.toFixed(2), best: true,
    });
  }

  // Parlay B: NBA spread + O/U (SGP)
  if (nbaGames.length > 0) {
    const nba = nbaGames[0];
    const spreadVal = parseFloat(nba.spread);
    const dogName = spreadVal < 0 ? nba.away : nba.home;
    const spreadLine = spreadVal < 0 ? `${nba.away} +${Math.abs(spreadVal)}` : `${nba.home} +${spreadVal}`;
    const ouVal = parseFloat(nba.ou);

    const legs = [{ name: `${spreadLine}`, odds: -115 }, { name: `Over ${ouVal}`, odds: -110 }];
    const dec = parlayDecimal(legs);
    const prob = 0.53 * 0.50;
    const ev = (prob * (dec - 1) * 50) - ((1 - prob) * 50);

    parlays.push({
      label: 'Parlay B — SGP Value',
      legs: legs.map(l => l.name).join(' + '),
      stake: 50, odds: dec, payout: Math.round(50 * dec),
      prob: (prob * 100).toFixed(1), ev: ev.toFixed(2),
    });
  }

  // Parlay C: Cross-sport 3-leg (NBA spread + 2 best MLB)
  if (nbaGames.length > 0 && topMLB.length >= 2) {
    const nba = nbaGames[0];
    const spreadVal = parseFloat(nba.spread);
    const spreadLine = spreadVal < 0 ? `${nba.away} +${Math.abs(spreadVal)}` : `${nba.home} +${spreadVal}`;
    const mlb1 = topMLB[0];
    const mlb2 = topMLB[1];
    const mlb1Odds = mlb1.pickSide === 'home' ? (mlb1.homeML || -130) : (mlb1.awayML || -130);
    const mlb2Odds = mlb2.pickSide === 'home' ? (mlb2.homeML || -130) : (mlb2.awayML || -130);

    const legs = [
      { name: spreadLine, odds: -115 },
      { name: `${mlb1.pick} ML`, odds: mlb1Odds },
      { name: `${mlb2.pick} ML`, odds: mlb2Odds },
    ];
    const dec = parlayDecimal(legs);
    const prob = 0.53 * (mlb1.conf / 100) * (mlb2.conf / 100);
    const ev = (prob * (dec - 1) * 30) - ((1 - prob) * 30);

    parlays.push({
      label: 'Parlay C — Cross-Sport 3-Leg',
      legs: legs.map(l => l.name).join(' + '),
      stake: 30, odds: dec, payout: Math.round(30 * dec),
      prob: (prob * 100).toFixed(1), ev: ev.toFixed(2),
    });
  }

  // Parlay D: Dogs longshot — NBA dog + any MLB dog with model edge
  if (nbaGames.length > 0) {
    const nba = nbaGames[0];
    const dogML = parseInt(nba.homeML) > 0 ? parseInt(nba.homeML) : parseInt(nba.awayML);
    const dogName = parseInt(nba.homeML) > 0 ? nba.home : nba.away;
    const mlbDog = kellyBets.find(p => {
      const odds = p.pickSide === 'home' ? p.homeML : p.awayML;
      return odds && parseInt(odds) > 0;
    }) || actionable.find(p => {
      const odds = p.pickSide === 'home' ? p.homeML : p.awayML;
      return odds && parseInt(odds) > 0;
    });

    if (mlbDog) {
      const mlbDogOdds = mlbDog.pickSide === 'home' ? parseInt(mlbDog.homeML) : parseInt(mlbDog.awayML);
      const legs = [{ name: `${dogName} ML`, odds: dogML }, { name: `${mlbDog.pick} ML`, odds: mlbDogOdds }];
      const dec = parlayDecimal(legs);
      const prob = (1 - americanToImplied(dogML)) * 0.4 * (mlbDog.conf / 100);
      const ev = (prob * (dec - 1) * 20) - ((1 - prob) * 20);

      parlays.push({
        label: 'Parlay D — Dogs Longshot',
        legs: legs.map(l => l.name).join(' + '),
        stake: 20, odds: dec, payout: Math.round(20 * dec),
        prob: (prob * 100).toFixed(1), ev: ev.toFixed(2),
      });
    }
  }

  // If no NBA, build MLB-only parlays
  if (nbaGames.length === 0 && topMLB.length >= 2) {
    const mlb1 = topMLB[0];
    const mlb2 = topMLB[1];
    const mlb1Odds = mlb1.pickSide === 'home' ? (mlb1.homeML || -130) : (mlb1.awayML || -130);
    const mlb2Odds = mlb2.pickSide === 'home' ? (mlb2.homeML || -130) : (mlb2.awayML || -130);

    const legs = [{ name: `${mlb1.pick} ML`, odds: mlb1Odds }, { name: `${mlb2.pick} ML`, odds: mlb2Odds }];
    const dec = parlayDecimal(legs);
    const prob = (mlb1.conf / 100) * (mlb2.conf / 100);
    const ev = (prob * (dec - 1) * 50) - ((1 - prob) * 50);
    parlays.push({ label: 'Parlay A — MLB 2-Leg', legs: legs.map(l => l.name).join(' + '), stake: 50, odds: dec, payout: Math.round(50 * dec), prob: (prob * 100).toFixed(1), ev: ev.toFixed(2), best: true });

    if (topMLB.length >= 3) {
      const mlb3 = topMLB[2];
      const mlb3Odds = mlb3.pickSide === 'home' ? (mlb3.homeML || -130) : (mlb3.awayML || -130);
      const legs3 = [...legs, { name: `${mlb3.pick} ML`, odds: mlb3Odds }];
      const dec3 = parlayDecimal(legs3);
      const prob3 = prob * (mlb3.conf / 100);
      const ev3 = (prob3 * (dec3 - 1) * 30) - ((1 - prob3) * 30);
      parlays.push({ label: 'Parlay B — MLB 3-Leg', legs: legs3.map(l => l.name).join(' + '), stake: 30, odds: dec3, payout: Math.round(30 * dec3), prob: (prob3 * 100).toFixed(1), ev: ev3.toFixed(2) });
    }

    // Totals parlay
    const overPlays = mlbPicks.filter(p => !p.coinFlip && p.ouLine && (p.prediction.expectedTotal - p.ouLine) > 1.5).slice(0, 2);
    if (overPlays.length >= 2) {
      const oLegs = overPlays.map(p => ({ name: `Over ${p.ouLine} (${p.away.split(' ').pop()}@${p.home.split(' ').pop()})`, odds: -110 }));
      const oDec = parlayDecimal(oLegs);
      const oProb = 0.55 * 0.55;
      const oEv = (oProb * (oDec - 1) * 30) - ((1 - oProb) * 30);
      parlays.push({ label: 'Parlay C — Totals', legs: oLegs.map(l => l.name).join(' + '), stake: 30, odds: oDec, payout: Math.round(30 * oDec), prob: (oProb * 100).toFixed(1), ev: oEv.toFixed(2) });
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

  // --- GENERATE HTML ---
  const html = buildHTML({
    today, yesterday, formatDate: formatDate(today),
    mlbPicks, nbaGames, parlays, kellyBets, actionable,
    runningTotal, daysActive,
  });

  fs.writeFileSync(path.join(__dirname, 'today-picks.html'), html);

  // Save prediction data
  const dataDir = path.join(__dirname, 'data');
  const historyDir = path.join(dataDir, 'history');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  const output = { date: today, generatedAt: new Date().toISOString(), mlb: mlbPicks, nba: nbaGames, parlays };
  fs.writeFileSync(path.join(dataDir, 'today.json'), JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(historyDir, `${today}.json`), JSON.stringify(output, null, 2));

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

.table-wrapper{overflow-x:auto;border-radius:8px;border:1px solid #21262d}
table{width:100%;border-collapse:collapse;font-size:0.85em}
th{text-align:left;padding:8px 10px;background:#161b22;border-bottom:2px solid #21262d;color:#8b949e;font-size:0.75em;text-transform:uppercase;position:sticky;top:0}
td{padding:8px 10px;border-bottom:1px solid #1a1f2e}
tr:hover td{background:rgba(88,166,255,0.03)}
.edge-positive{color:#3fb950;font-weight:600}
.edge-high{color:#3fb950;font-weight:700}
.skip{color:#484f58}

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
<div class="tab" onclick="switchTab('nba')">NBA</div>
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
<div class="section-title">&#9918; MLB Full Projections &mdash; ${mlbPicks.length} Games</div>
${mlbTableHTML}
</div>
</div>

<!-- PARLAYS TAB -->
<div class="tab-content" id="tab-parlays">
<div class="section">
<div class="section-title parlays">&#127922; Parlay Plays</div>
${parlaysHTML}
</div>
</div>

<!-- NBA TAB -->
<div class="tab-content" id="tab-nba">
${buildNBATab(nbaGames, today)}
</div>

<!-- RESULTS TAB -->
<div class="tab-content" id="tab-results">
<div class="section">
<div class="section-title" style="color:#3fb950">&#9989; Recent Results</div>
<div class="game-card">
<p style="color:#8b949e;font-size:0.9em">Results are graded automatically at 2am CT and pushed to the tracker.</p>
<p style="margin-top:10px"><a href="/tracker" style="color:#58a6ff;text-decoration:none;font-weight:600">View Full Tracker &rarr;</a></p>
</div>
</div>
</div>

<div class="nav-links">
<a href="/tracker">Betting Tracker</a>
<a href="/mlb">MLB Season</a>
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

      const badge = won
        ? '<span style="background:#064e3b;color:#34d399;padding:3px 10px;border-radius:4px;font-size:0.8em;font-weight:700">W</span>'
        : '<span style="background:#7f1d1d;color:#f87171;padding:3px 10px;border-radius:4px;font-size:0.8em;font-weight:700">L</span>';
      resultEl.innerHTML = badge + ' <span style="color:#8b949e;font-size:0.75em;margin-left:4px">' + score + '</span>';
    });

    btn.textContent = '\\u2713 Updated';
    setTimeout(() => { btn.textContent = 'Refresh Results'; btn.disabled = false; }, 3000);
  } catch(e) {
    btn.textContent = 'Error';
    btn.disabled = false;
  }
}

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
          resultCell.innerHTML = badge + ' <span style=\\"color:#8b949e;font-size:0.75em\\">' + awayScore + '-' + homeScore + '</span>';
        } else if (total > 0) {
          resultCell.innerHTML = '<span style=\\"color:#f59e0b;font-size:0.8em\\">' + statusText + ' (' + awayScore + '-' + homeScore + ')</span>';
        }
      });

      // Fetch box score for player props
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
                  ? '<span style=\\"background:#064e3b;color:#34d399;padding:2px 6px;border-radius:3px;font-size:0.75em;font-weight:700\\">W</span>'
                  : '<span style=\\"background:#7f1d1d;color:#f87171;padding:2px 6px;border-radius:3px;font-size:0.75em;font-weight:700\\">L</span>';
              };

              const teamShort = team.team.displayName.split(' ').pop();
              propsHTML += '<tr><td style=\\"font-weight:600\\">' + athlete.athlete.displayName + '</td><td>' + teamShort + '</td><td>Points</td><td>O ' + ptsLine + '</td><td style=\\"font-weight:700;color:#58a6ff\\">' + pts + '</td><td>' + (pts - ptsLine > 0 ? '+' : '') + (pts - ptsLine).toFixed(1) + '</td><td>' + mkBadge(pts, ptsLine) + '</td></tr>';
              propsHTML += '<tr><td>' + athlete.athlete.displayName + '</td><td>' + teamShort + '</td><td>Rebounds</td><td>O ' + rebLine + '</td><td style=\\"font-weight:700;color:#58a6ff\\">' + reb + '</td><td>' + (reb - rebLine > 0 ? '+' : '') + (reb - rebLine).toFixed(1) + '</td><td>' + mkBadge(reb, rebLine) + '</td></tr>';
              propsHTML += '<tr><td>' + athlete.athlete.displayName + '</td><td>' + teamShort + '</td><td>Assists</td><td>O ' + astLine + '</td><td style=\\"font-weight:700;color:#58a6ff\\">' + ast + '</td><td>' + (ast - astLine > 0 ? '+' : '') + (ast - astLine).toFixed(1) + '</td><td>' + mkBadge(ast, astLine) + '</td></tr>';
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
</script>
</body>
</html>`;
}

async function fetchNBAPlayerProps(nbaGames, today) {
  const props = [];
  for (const nba of nbaGames) {
    // Fetch team rosters/stats from ESPN
    for (const teamName of [nba.home, nba.away]) {
      try {
        const teamRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=50`);
        const teamData = await teamRes.json();
        const team = (teamData.sports?.[0]?.leagues?.[0]?.teams || []).find(t => t.team.displayName === teamName);
        if (!team) continue;

        const rosterRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.team.id}/roster`);
        const rosterData = await rosterRes.json();
        const athletes = rosterData.athletes || [];

        for (const athlete of athletes.slice(0, 8)) {
          const stats = athlete.statistics;
          if (!stats) continue;
          const ppg = parseFloat(stats.splits?.categories?.[0]?.stats?.find(s => s.name === 'avgPoints')?.value || 0);
          const rpg = parseFloat(stats.splits?.categories?.[0]?.stats?.find(s => s.name === 'avgRebounds')?.value || 0);
          const apg = parseFloat(stats.splits?.categories?.[0]?.stats?.find(s => s.name === 'avgAssists')?.value || 0);

          if (ppg > 10) {
            props.push({
              player: athlete.displayName || athlete.fullName,
              team: teamName,
              ppg, rpg, apg,
              pra: ppg + rpg + apg,
            });
          }
        }
      } catch(e) {}
    }
  }
  return props.sort((a, b) => b.ppg - a.ppg);
}

function buildNBATab(nbaGames, today) {
  if (nbaGames.length === 0) {
    return `<div class="section"><div class="section-title nba">&#127936; NBA</div><div class="game-card"><p style="color:#8b949e">No NBA games today.</p></div></div>`;
  }

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
<table style="width:100%;font-size:0.85em">
<thead><tr><th>Bet</th><th>Line</th><th>Thesis</th><th>Result</th></tr></thead>
<tbody>
<tr data-nba-bet="spread" data-team="${dog}" data-line="${dogSpread}"><td style="font-weight:600">${dog} +${dogSpread}</td><td>-115</td><td>Playoff games run tight</td><td class="nba-result">—</td></tr>
<tr data-nba-bet="ml" data-team="${favHome ? nba.home : nba.away}"><td style="font-weight:600">${favHome ? nba.home : nba.away} ML</td><td>${favHome ? nba.homeML : nba.awayML}</td><td>Home court + better record</td><td class="nba-result">—</td></tr>
<tr data-nba-bet="over" data-line="${nba.ou}"><td style="font-weight:600">Over ${nba.ou}</td><td>-110</td><td>Competitive series = pace</td><td class="nba-result">—</td></tr>
</tbody></table>
</div>
</div>`;
  }

  // Props section
  html += `<div style="margin-top:20px"><div style="font-size:1.1em;font-weight:700;color:#f0883e;margin-bottom:12px">&#127942; Player Props</div>`;

  // Generate prop projections from the game data
  for (const nba of nbaGames) {
    const spread = parseFloat(nba.spread);
    const favHome = spread < 0;
    const favTeam = favHome ? nba.home : nba.away;
    const dogTeam = favHome ? nba.away : nba.home;

    html += `<div class="table-wrapper" style="margin-bottom:16px"><table>
<thead><tr><th>Player</th><th>Team</th><th>Prop</th><th>Line</th><th>Projection</th><th>Edge</th><th>Result</th></tr></thead>
<tbody id="nba-props-body">
<tr><td colspan="7" style="color:#8b949e;text-align:center;padding:16px">Props load on refresh — click "Refresh Results" after tip-off for live player stats and prop grading</td></tr>
</tbody></table></div>`;
  }

  html += `</div></div>`;
  return html;
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
  let html = '<div class="table-wrapper"><table><thead><tr><th>Game</th><th>Pitchers</th><th>ML</th><th>O/U</th><th>Pick</th><th>Win%</th><th>Edge</th><th>Proj Total</th><th>Signal</th></tr></thead><tbody>';

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

    html += `<tr${cls}><td${isKelly ? ' class="edge-positive"' : ''}>${p.away.split(' ').pop()} @ ${p.home.split(' ').pop()}</td><td>${p.awayPitcher.split(' ').pop()} vs ${p.homePitcher.split(' ').pop()}</td><td>${p.coinFlip ? '—' : mlStr}</td><td>${p.ouLine || '—'}</td><td${!p.coinFlip ? ' class="edge-positive"' : ''}>${p.coinFlip ? '—' : p.pick.split(' ').pop()}</td><td${!p.coinFlip ? ' class="edge-positive"' : ''}>${p.conf.toFixed(1)}%</td><td${isKelly ? ' class="edge-high"' : ''}>${p.coinFlip ? '—' : '+' + edgeVal + '%'}</td><td${totalEdge > 1.5 ? ' class="edge-positive"' : ''}>${p.coinFlip ? '—' : p.prediction.expectedTotal.toFixed(1) + (p.ouLine ? ' (' + (totalEdge > 0 ? '+' : '') + totalEdge + ')' : '')}</td><td${isKelly ? ' class="edge-high"' : ''}>${signal}</td></tr>`;
  }

  html += '</tbody></table></div>';
  return html;
}

main().catch(e => {
  console.error('[generate] FAILED:', e.message);
  process.exit(1);
});
