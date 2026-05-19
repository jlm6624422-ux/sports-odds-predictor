#!/bin/bash
# Daily prediction + results update script
# Run at 7am ET via cron: 0 7 * * * cd /home/jmcdon11/workspace/projects/sports-odds-predictor && ./daily-update.sh

set -e
cd "$(dirname "$0")"

echo "[$(date)] Starting daily update..."

# Run predictions and generate today's picks page
node -e "
const { fetchESPNOdds } = require('./server/services/espnOdds');
const { ensembleMLB } = require('./server/services/ensembleModel');
const { buildCurrentElo } = require('./server/services/eloBuilder');
const { fetchTeamRunDifferentials } = require('./server/services/enhancedModel');
const { MlbStatsService } = require('./server/services/mlbStats');
const fs = require('fs');
const path = require('path');

async function main() {
  const mlb = new MlbStatsService();
  const today = new Date().toISOString().split('T')[0];
  const todayShort = today.replace(/-/g, '').slice(4,8).replace(/^0?(\d)(\d{2})/, '\$1-\$2').replace(/^(\d{2})/, (m) => parseInt(m.slice(0,2)) + '-' + m.slice(2));

  console.log('[predictions] Running for ' + today);

  const [{ ratings: eloRatings }, standings, pitcherData, oddsData] = await Promise.all([
    buildCurrentElo('MLB'),
    fetchTeamRunDifferentials(),
    mlb.getProbablePitchers(today),
    fetchESPNOdds('MLB', today),
  ]);

  const oddsMap = new Map();
  for (const g of oddsData) oddsMap.set(g.home_team, g);

  const games = pitcherData.dates?.[0]?.games || [];
  const results = [];

  for (const game of games) {
    const homeTeamName = game.teams.home.team.name;
    const awayTeamName = game.teams.away.team.name;
    const venue = game.venue?.name || '';
    const homeStats = standings.get(homeTeamName) || { wins: 20, losses: 20, runsScored: 180, runsAllowed: 180 };
    const awayStats = standings.get(awayTeamName) || { wins: 20, losses: 20, runsScored: 180, runsAllowed: 180 };

    let homePitcher = null, awayPitcher = null;
    const hp = game.teams.home.probablePitcher;
    const ap = game.teams.away.probablePitcher;
    if (hp) { try { const pInfo = await mlb.getPlayerInfo(hp.id); const person = pInfo.people?.[0]; const pitching = person?.stats?.find(s => s.group?.displayName === 'pitching' && s.type?.displayName === 'season'); const splits = pitching?.splits?.[0]?.stat; if (splits) { homePitcher = { name: hp.fullName, hand: person.pitchHand?.code || 'R', seasonStats: { homeRuns: parseInt(splits.homeRuns)||0, walks: parseInt(splits.baseOnBalls)||0, hitByPitch: parseInt(splits.hitByPitch)||0, strikeouts: parseInt(splits.strikeOuts)||0, inningsPitched: parseFloat(splits.inningsPitched)||0, era: parseFloat(splits.era)||null }}; } } catch(e) {} }
    if (!homePitcher && hp) homePitcher = { name: hp.fullName, hand: 'R' };
    if (ap) { try { const pInfo = await mlb.getPlayerInfo(ap.id); const person = pInfo.people?.[0]; const pitching = person?.stats?.find(s => s.group?.displayName === 'pitching' && s.type?.displayName === 'season'); const splits = pitching?.splits?.[0]?.stat; if (splits) { awayPitcher = { name: ap.fullName, hand: person.pitchHand?.code || 'R', seasonStats: { homeRuns: parseInt(splits.homeRuns)||0, walks: parseInt(splits.baseOnBalls)||0, hitByPitch: parseInt(splits.hitByPitch)||0, strikeouts: parseInt(splits.strikeOuts)||0, inningsPitched: parseFloat(splits.inningsPitched)||0, era: parseFloat(splits.era)||null }}; } } catch(e) {} }
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

    results.push({
      home: homeTeamName, away: awayTeamName, venue,
      homePitcher: homePitcher?.name || 'TBD', awayPitcher: awayPitcher?.name || 'TBD',
      prediction: pred.prediction, edge: pred.edge, kelly: pred.kelly,
      confidence: pred.confidence, modelsUsed: pred.modelsUsed, coinFlip: pred.coinFlip,
    });
  }

  // Save data
  const dataDir = path.join(__dirname, 'data');
  const historyDir = path.join(dataDir, 'history');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

  const output = { date: today, generatedAt: new Date().toISOString(), mlb: results };
  fs.writeFileSync(path.join(dataDir, 'today.json'), JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(historyDir, today + '.json'), JSON.stringify(output, null, 2));

  const picks = results.filter(r => !r.coinFlip);
  const bets = picks.filter(r => r.kelly && r.kelly.betSize > 0);
  console.log('[predictions] ' + results.length + ' games, ' + picks.length + ' picks, ' + bets.length + ' kelly bets');
}

main().catch(e => { console.error('[predictions] FAILED:', e.message); process.exit(1); });
"

echo "[$(date)] Predictions complete. Committing and pushing..."

# Ensure correct GitHub account
gh auth switch --user jlm6624422-ux 2>/dev/null || true

# Git commit and push
git add -A
if git diff --cached --quiet; then
  echo "[$(date)] No changes to commit"
else
  git commit -m "Daily update: $(date +%Y-%m-%d) predictions

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  git push origin master
  echo "[$(date)] Pushed to GitHub (Railway will auto-deploy)"
fi

echo "[$(date)] Daily update complete."
