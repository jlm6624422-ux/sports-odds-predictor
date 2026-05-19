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
</script>
</body>
</html>`;
}

function buildTopPicks(kellyBets, actionable, nbaGames, mlbPicks) {
  let html = '<div class="top-picks"><h2>&#127942; Today\'s Best Plays</h2>';

  for (const p of kellyBets) {
    const odds = p.pickSide === 'home' ? p.homeML : p.awayML;
    const oddsStr = odds ? ` (${odds > 0 ? '+' : ''}${odds})` : '';
    html += `<div class="pick-item kelly"><div class="pick-details"><div class="pick-game">${p.away} @ ${p.home} &bull; Moneyline (Kelly)</div><div class="pick-bet">${p.pick} ML${oddsStr} &mdash; $${p.kelly.betSize.toFixed(0)}</div></div><div class="pick-edge">+${Math.max(Math.abs(p.edge?.home||0), Math.abs(p.edge?.away||0)).toFixed(1)}%</div><span class="pick-conf kelly">KELLY</span></div>`;
  }

  // Over/under plays
  const overPlays = mlbPicks.filter(p => !p.coinFlip && p.ouLine && (p.prediction.expectedTotal - p.ouLine) > 1.5).slice(0, 3);
  for (const p of overPlays) {
    const edge = (p.prediction.expectedTotal - p.ouLine).toFixed(1);
    html += `<div class="pick-item over"><div class="pick-details"><div class="pick-game">${p.away} @ ${p.home} &bull; Total</div><div class="pick-bet">OVER ${p.ouLine} (-110) &mdash; Proj ${p.prediction.expectedTotal.toFixed(1)} runs</div></div><div class="pick-edge">+${edge}</div><span class="pick-conf high">HIGH</span></div>`;
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
    html += `<div class="pick-item"><div class="pick-details"><div class="pick-game">${p.away} @ ${p.home} &bull; Lean</div><div class="pick-bet">${p.pick} ML${oddsStr}</div></div><div class="pick-edge">${p.conf.toFixed(1)}%</div><span class="pick-conf med">LEAN</span></div>`;
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
