/**
 * Grade yesterday's predictions against actual results.
 * Outputs a report showing what we projected vs what happened,
 * updates tracker.html with W/L and P&L.
 *
 * Run at 2am CT (all games final by then).
 */

const fs = require('fs');
const path = require('path');

function americanToDecimal(american) {
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

async function fetchMLBScores(date) {
  const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore`);
  const data = await res.json();
  const games = data.dates?.[0]?.games || [];
  const results = new Map();
  for (const g of games) {
    if (!g.status.detailedState.includes('Final')) continue;
    const home = g.teams.home.team.name;
    const away = g.teams.away.team.name;
    results.set(home, {
      home, away,
      homeScore: g.teams.home.score,
      awayScore: g.teams.away.score,
      winner: g.teams.home.score > g.teams.away.score ? home : away,
      total: g.teams.home.score + g.teams.away.score,
    });
  }
  return results;
}

async function fetchNBAScores(date) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replace(/-/g, '')}`);
  const data = await res.json();
  const results = [];
  for (const event of (data.events || [])) {
    const comp = event.competitions[0];
    if (!comp.status?.type?.completed) continue;
    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;
    results.push({
      home: home.team.displayName, away: away.team.displayName,
      homeScore: parseInt(home.score), awayScore: parseInt(away.score),
      winner: parseInt(home.score) > parseInt(away.score) ? home.team.displayName : away.team.displayName,
      total: parseInt(home.score) + parseInt(away.score),
      margin: parseInt(home.score) - parseInt(away.score),
    });
  }
  return results;
}

async function main() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const mmdd = yesterday.slice(5);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  GRADING REPORT — ${yesterday}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Load what we predicted
  const historyPath = path.join(__dirname, 'data', 'history', `${yesterday}.json`);
  if (!fs.existsSync(historyPath)) {
    console.log(`  No predictions found for ${yesterday} (${historyPath})`);
    console.log('  Run generate-daily.js first or check the date.\n');
    return;
  }

  const predictions = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  const [mlbScores, nbaScores] = await Promise.all([
    fetchMLBScores(yesterday),
    fetchNBAScores(yesterday),
  ]);

  console.log(`  MLB games final: ${mlbScores.size}`);
  console.log(`  NBA games final: ${nbaScores.length}\n`);

  // --- GRADE MLB PICKS ---
  const mlbPicks = (predictions.mlb || []).filter(p => !p.coinFlip);
  const kellyBets = mlbPicks.filter(p => p.kelly && p.kelly.betSize > 0);

  let report = [];
  let straightW = 0, straightL = 0, straightPnl = 0;
  let parlayW = 0, parlayL = 0, parlayPnl = 0;

  console.log('  MLB STRAIGHT BETS');
  console.log('  ' + '—'.repeat(56));

  for (const pick of kellyBets) {
    const game = mlbScores.get(pick.home);
    if (!game) { console.log(`  ? ${pick.pick} — game not found/not final`); continue; }

    const won = game.winner === pick.pick;
    const odds = pick.pickSide === 'home' ? (pick.homeML || -130) : (pick.awayML || 130);
    const stake = pick.kelly.betSize;
    const pnl = won ? parseFloat((stake * (americanToDecimal(odds) - 1)).toFixed(2)) : -stake;

    straightW += won ? 1 : 0;
    straightL += won ? 0 : 1;
    straightPnl += pnl;

    const mark = won ? '✓' : '✗';
    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    console.log(`  ${mark} ${pick.pick} ML (${odds > 0 ? '+' : ''}${odds}) $${stake.toFixed(0)} → ${pnlStr}`);
    console.log(`    ${pick.away} @ ${pick.home}: ${game.awayScore}-${game.homeScore} (${game.winner} wins)`);

    report.push({ type: 'straight', sport: 'MLB', pick: pick.pick + ' ML', matchup: `${pick.away.split(' ').pop()} @ ${pick.home.split(' ').pop()}`, odds, stake, result: won ? 'won' : 'lost', pnl });
  }

  // Grade over/under picks
  const overPlays = (predictions.mlb || []).filter(p => !p.coinFlip && p.ouLine && (p.prediction.expectedTotal - p.ouLine) > 1.5);
  for (const pick of overPlays) {
    const game = mlbScores.get(pick.home);
    if (!game) continue;

    const won = game.total > pick.ouLine;
    const stake = 25;
    const pnl = won ? parseFloat((stake * (americanToDecimal(-110) - 1)).toFixed(2)) : -stake;

    straightW += won ? 1 : 0;
    straightL += won ? 0 : 1;
    straightPnl += pnl;

    const mark = won ? '✓' : '✗';
    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    console.log(`  ${mark} OVER ${pick.ouLine} (${pick.away.split(' ').pop()}@${pick.home.split(' ').pop()}) $${stake} → ${pnlStr}`);
    console.log(`    Actual total: ${game.total} (proj was ${pick.prediction.expectedTotal.toFixed(1)})`);

    report.push({ type: 'straight', sport: 'MLB', pick: `OVER ${pick.ouLine}`, matchup: `${pick.away.split(' ').pop()} @ ${pick.home.split(' ').pop()}`, odds: -110, stake, result: won ? 'won' : 'lost', pnl });
  }

  // --- GRADE NBA ---
  if (nbaScores.length > 0) {
    console.log('\n  NBA');
    console.log('  ' + '—'.repeat(56));
    for (const nba of nbaScores) {
      console.log(`  ${nba.away} ${nba.awayScore} @ ${nba.home} ${nba.homeScore} (${nba.winner} wins)`);
    }
  }

  // --- GRADE PARLAYS ---
  if (predictions.parlays && predictions.parlays.length > 0) {
    console.log('\n  PARLAYS');
    console.log('  ' + '—'.repeat(56));

    for (const parlay of predictions.parlays) {
      const legs = parlay.legs.split(' + ');
      let allWon = true;
      let failedLeg = null;

      for (const leg of legs) {
        let legWon = null;

        // NBA spread: "Cleveland Cavaliers +7.5"
        const spreadMatch = leg.match(/(.+?)\s+([+-][\d.]+)$/);
        if (spreadMatch && nbaScores.length > 0) {
          const teamName = spreadMatch[1].trim();
          const line = parseFloat(spreadMatch[2]);
          const nba = nbaScores[0];
          const isHome = nba.home.includes(teamName) || teamName.includes(nba.home.split(' ').pop());
          const teamMargin = isHome ? nba.margin : -nba.margin;
          legWon = (teamMargin + line) > 0;
        }

        // NBA ML: "New York Knicks ML"
        const nbaMLMatch = leg.match(/(.+?)\s+ML$/);
        if (nbaMLMatch && nbaScores.length > 0) {
          const teamName = nbaMLMatch[1].trim();
          const nba = nbaScores[0];
          legWon = nba.winner.includes(teamName) || teamName.includes(nba.winner.split(' ').pop());
        }

        // Over: "Over 217.5"
        const overMatch = leg.match(/Over\s+([\d.]+)/i);
        if (overMatch) {
          const line = parseFloat(overMatch[1]);
          if (line > 100 && nbaScores.length > 0) {
            legWon = nbaScores[0].total > line;
          } else {
            // MLB over — try to find the game
            for (const [, game] of mlbScores) {
              if (Math.abs(game.total - line) < 10 && line < 20) {
                legWon = game.total > line;
                break;
              }
            }
          }
        }

        // MLB ML: "Tampa Bay Rays ML"
        if (!legWon && nbaMLMatch === null) {
          const mlbMLMatch = leg.match(/(.+?)\s+ML$/);
          if (mlbMLMatch) {
            const teamName = mlbMLMatch[1].trim();
            for (const [, game] of mlbScores) {
              if (game.winner.includes(teamName) || teamName.includes(game.winner.split(' ').pop()) ||
                  game.home.includes(teamName) || game.away.includes(teamName)) {
                legWon = game.winner.includes(teamName) || teamName.includes(game.winner.split(' ').pop());
                break;
              }
            }
          }
        }

        if (legWon === false) { failedLeg = leg; allWon = false; break; }
        if (legWon === null) { allWon = false; break; }
      }

      const won = allWon;
      const pnl = won ? (parlay.payout - parlay.stake) : -parlay.stake;
      parlayW += won ? 1 : 0;
      parlayL += won ? 0 : 1;
      parlayPnl += pnl;

      const mark = won ? '✓' : '✗';
      const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(0)}` : `-$${Math.abs(pnl).toFixed(0)}`;
      console.log(`  ${mark} ${parlay.label} (${parlay.odds.toFixed(2)}x, $${parlay.stake}) → ${pnlStr}`);
      console.log(`    Legs: ${parlay.legs}`);
      if (failedLeg) console.log(`    Failed: ${failedLeg}`);

      report.push({ type: 'parlay', label: parlay.label, legs: parlay.legs, stake: parlay.stake, odds: parlay.odds, payout: parlay.payout, result: won ? 'won' : 'lost', pnl });
    }
  }

  // --- SUMMARY ---
  const dayTotal = straightPnl + parlayPnl;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  DAILY SUMMARY — ${yesterday}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Straights: ${straightW}-${straightL}  ${straightPnl >= 0 ? '+' : ''}$${straightPnl.toFixed(2)}`);
  console.log(`  Parlays:   ${parlayW}-${parlayL}  ${parlayPnl >= 0 ? '+' : ''}$${parlayPnl.toFixed(2)}`);
  console.log(`  DAY TOTAL: ${dayTotal >= 0 ? '+' : ''}$${dayTotal.toFixed(2)}`);
  console.log(`${'═'.repeat(60)}\n`);

  // --- UPDATE TRACKER ---
  const trackerPath = path.join(__dirname, 'tracker.html');
  let tracker = fs.readFileSync(trackerPath, 'utf8');

  // Find and replace pending straight bet rows for yesterday
  for (const bet of report.filter(r => r.type === 'straight')) {
    const pendingPattern = new RegExp(
      `<tr class="pending"><td>${mmdd}</td>.*?${escapeRegex(bet.pick)}.*?</tr>`
    );
    if (pendingPattern.test(tracker)) {
      const cls = bet.result === 'won' ? 'win' : 'loss';
      const badge = bet.result === 'won' ? '<span class="badge-win">W</span>' : '<span class="badge-loss">L</span>';
      const pnlStr = bet.pnl >= 0 ? `+$${bet.pnl.toFixed(2)}` : `-$${Math.abs(bet.pnl).toFixed(2)}`;
      const pnlCls = bet.pnl >= 0 ? 'green' : 'red';

      tracker = tracker.replace(pendingPattern, (match) => {
        return match
          .replace('class="pending"', `class="${cls}"`)
          .replace('<span class="badge-pending">PEND</span>', badge)
          .replace('>—</td></tr>', ` class="${pnlCls}">${pnlStr}</td></tr>`);
      });
    }
  }

  // Find and replace pending parlay rows for yesterday
  for (const bet of report.filter(r => r.type === 'parlay')) {
    const firstLegEscaped = escapeRegex(bet.legs.split(' + ')[0].slice(0, 15));
    const pendingPattern = new RegExp(
      `<tr class="pending"><td>${mmdd}</td>.*?${firstLegEscaped}.*?</tr>`
    );
    if (pendingPattern.test(tracker)) {
      const cls = bet.result === 'won' ? 'win' : 'loss';
      const badge = bet.result === 'won' ? '<span class="badge-win">W</span>' : '<span class="badge-loss">L</span>';
      const pnlStr = bet.pnl >= 0 ? `+$${bet.pnl.toFixed(0)}.00` : `-$${Math.abs(bet.pnl).toFixed(0)}.00`;
      const pnlCls = bet.pnl >= 0 ? 'green' : 'red';

      tracker = tracker.replace(pendingPattern, (match) => {
        return match
          .replace('class="pending"', `class="${cls}"`)
          .replace('<span class="badge-pending">PEND</span>', badge)
          .replace('>—</td></tr>', ` class="${pnlCls}">${pnlStr}</td></tr>`);
      });
    }
  }

  // Add P&L row
  const existingRunning = parseRunningTotal(tracker);
  const newRunning = existingRunning + dayTotal;
  const dayStr = dayTotal >= 0 ? `+$${dayTotal.toFixed(2)}` : `-$${Math.abs(dayTotal).toFixed(2)}`;
  const runStr = newRunning >= 0 ? `+$${newRunning.toFixed(2)}` : `-$${Math.abs(newRunning).toFixed(2)}`;
  const strStr = straightPnl >= 0 ? `+$${straightPnl.toFixed(2)}` : `-$${Math.abs(straightPnl).toFixed(2)}`;
  const parStr = parlayPnl >= 0 ? `+$${parlayPnl.toFixed(2)}` : `-$${Math.abs(parlayPnl).toFixed(2)}`;

  const pnlRow = `<tr><td>${mmdd}</td><td>${straightW}</td><td>${straightL}</td><td class="${straightPnl >= 0 ? 'green' : 'red'}">${strStr}</td><td>${parlayW}</td><td>${parlayL}</td><td class="${parlayPnl >= 0 ? 'green' : 'red'}">${parStr}</td><td class="${dayTotal >= 0 ? 'green' : 'red'}">${dayStr}</td><td class="${newRunning >= 0 ? 'green' : 'red'}">${runStr}</td></tr>`;

  // Insert before closing </tbody> in pnl-body
  tracker = tracker.replace(
    /(id="pnl-body">[\s\S]*?)(\s*<\/tbody>)/,
    `$1                    ${pnlRow}\n                $2`
  );

  // Update monthly pace
  const activeDays = (tracker.match(/<tr><td>\d\d-\d\d<\/td><td>\d+<\/td>/g) || []).length;
  const avgDay = activeDays > 0 ? newRunning / activeDays : 0;
  const daysLeft = 31 - new Date().getDate();
  const needPerDay = daysLeft > 0 ? (3000 - newRunning) / daysLeft : 0;

  tracker = tracker.replace(
    /<div><span style="color:#6b7280;">Days Active:<\/span>.*?<\/div>/,
    `<div><span style="color:#6b7280;">Days Active:</span> ${activeDays}</div>`
  );
  tracker = tracker.replace(
    /<div><span style="color:#6b7280;">Avg\/Day:<\/span>.*?<\/div>/,
    `<div><span style="color:#6b7280;">Avg/Day:</span> <span class="${avgDay >= 0 ? 'green' : 'red'}">${avgDay >= 0 ? '+' : ''}$${avgDay.toFixed(0)}</span></div>`
  );
  tracker = tracker.replace(
    /<div><span style="color:#6b7280;">Projected Monthly:<\/span>.*?<\/div>/,
    `<div><span style="color:#6b7280;">Projected Monthly:</span> <span class="blue">${avgDay >= 0 ? '+' : ''}$${Math.round(avgDay * 30).toLocaleString()}</span></div>`
  );
  tracker = tracker.replace(
    /<div><span style="color:#6b7280;">Need\/Day \(remaining\):<\/span>.*?<\/div>/,
    `<div><span style="color:#6b7280;">Need/Day (remaining):</span> <span>${needPerDay <= 0 ? 'On track!' : `$${Math.round(needPerDay)}/day for ${daysLeft} days`}</span></div>`
  );

  tracker = tracker.replace(/Last updated:.*?\./, `Last updated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`);

  fs.writeFileSync(trackerPath, tracker);

  // Save grading data
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const resultsPath = path.join(dataDir, 'results.json');
  let allResults = {};
  if (fs.existsSync(resultsPath)) allResults = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  allResults[yesterday] = { gradedAt: new Date().toISOString(), straights: { w: straightW, l: straightL, pnl: straightPnl }, parlays: { w: parlayW, l: parlayL, pnl: parlayPnl }, dayTotal, runningTotal: newRunning, bets: report };
  fs.writeFileSync(resultsPath, JSON.stringify(allResults, null, 2));

  console.log(`  Tracker updated. Running total: ${runStr}`);
}

function parseRunningTotal(tracker) {
  const rows = tracker.match(/<tr><td>\d\d-\d\d<\/td><td>\d+<\/td>.*?<\/tr>/g) || [];
  if (rows.length === 0) return 0;
  const lastRow = rows[rows.length - 1];
  const match = lastRow.match(/([+-]?\$[\d,.]+)<\/td>\s*<\/tr>/);
  if (match) return parseFloat(match[1].replace(/[$,]/g, ''));
  return 0;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch(e => {
  console.error('[grade] FAILED:', e.message, e.stack);
  process.exit(1);
});
