const fs = require('fs');
const path = require('path');
const { initDatabase } = require('../server/config/database');
const { picks, backtestRuns } = require('../server/services/dbService');

function americanToDecimal(american) {
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

function main() {
  const start = Date.now();
  const db = initDatabase();

  const allPicks = db.prepare(`
    SELECT p.*, g.home_team, g.away_team, g.home_score, g.away_score, g.status
    FROM picks p JOIN games g ON p.game_id = g.id
    WHERE p.result IN ('win', 'loss', 'push')
    ORDER BY p.date
  `).all();

  if (allPicks.length === 0) {
    console.log('No graded picks found. Run migration first: node scripts/migrate-json-to-sqlite.js');
    return;
  }

  const dateRange = { start: allPicks[0].date, end: allPicks[allPicks.length - 1].date };

  // Metrics
  let wins = 0, losses = 0, pushes = 0;
  let flatPnl = 0, kellyPnl = 0;
  const byType = {};
  const byConfidence = {};
  const calibrationBuckets = {};
  const dailyPnl = {};
  let totalCLV = 0, clvCount = 0;

  for (const pick of allPicks) {
    const type = pick.pick_type;
    const conf = pick.kelly_recommendation || 'NO BET';

    if (pick.result === 'win') wins++;
    else if (pick.result === 'loss') losses++;
    else pushes++;

    // Flat $100 P&L
    const flatStake = 100;
    const odds = pick.odds_american || -110;
    const decimal = americanToDecimal(odds);
    const flatProfit = pick.result === 'win' ? flatStake * (decimal - 1) : (pick.result === 'loss' ? -flatStake : 0);
    flatPnl += flatProfit;

    // Kelly P&L
    const kellyStake = pick.kelly_bet_size || 0;
    const kellyProfit = pick.result === 'win' ? kellyStake * (decimal - 1) : (pick.result === 'loss' ? -kellyStake : 0);
    kellyPnl += kellyProfit;

    // By type
    if (!byType[type]) byType[type] = { wins: 0, losses: 0, pnl: 0 };
    byType[type][pick.result === 'win' ? 'wins' : 'losses']++;
    byType[type].pnl += flatProfit;

    // By confidence/recommendation
    if (!byConfidence[conf]) byConfidence[conf] = { wins: 0, losses: 0, pnl: 0 };
    byConfidence[conf][pick.result === 'win' ? 'wins' : 'losses']++;
    byConfidence[conf].pnl += kellyProfit;

    // Calibration
    if (pick.model_prob > 0) {
      const bucket = Math.round(pick.model_prob / 5) * 5;
      if (!calibrationBuckets[bucket]) calibrationBuckets[bucket] = { predicted: 0, actual: 0, count: 0 };
      calibrationBuckets[bucket].predicted += pick.model_prob / 100;
      calibrationBuckets[bucket].actual += pick.result === 'win' ? 1 : 0;
      calibrationBuckets[bucket].count++;
    }

    // CLV
    if (pick.clv !== null && pick.clv !== undefined) {
      totalCLV += pick.clv;
      clvCount++;
    }

    // Daily
    if (!dailyPnl[pick.date]) dailyPnl[pick.date] = { flat: 0, kelly: 0, picks: 0 };
    dailyPnl[pick.date].flat += flatProfit;
    dailyPnl[pick.date].kelly += kellyProfit;
    dailyPnl[pick.date].picks++;
  }

  const winRate = wins / (wins + losses);
  const roi = flatPnl / (allPicks.length * 100);
  const avgCLV = clvCount > 0 ? totalCLV / clvCount : null;
  const duration = Date.now() - start;

  // Output report
  console.log('\n' + '═'.repeat(60));
  console.log('  BACKTEST REPORT');
  console.log('  ' + dateRange.start + ' → ' + dateRange.end);
  console.log('═'.repeat(60));
  console.log(`\n  Total picks: ${allPicks.length} (${wins}W-${losses}L-${pushes}P)`);
  console.log(`  Win rate:    ${(winRate * 100).toFixed(1)}%`);
  console.log(`  Flat ROI:    ${(roi * 100).toFixed(1)}% ($${flatPnl.toFixed(0)} on $${allPicks.length * 100} wagered)`);
  console.log(`  Kelly P&L:   $${kellyPnl.toFixed(0)}`);
  if (avgCLV !== null) console.log(`  Avg CLV:     ${avgCLV.toFixed(2)}%`);
  console.log(`  Runtime:     ${duration}ms`);

  console.log('\n  BY PICK TYPE:');
  for (const [type, stats] of Object.entries(byType)) {
    const wr = stats.wins / (stats.wins + stats.losses);
    console.log(`    ${type.padEnd(8)} ${stats.wins}-${stats.losses} (${(wr * 100).toFixed(1)}%) $${stats.pnl.toFixed(0)}`);
  }

  console.log('\n  BY RECOMMENDATION:');
  for (const [conf, stats] of Object.entries(byConfidence)) {
    const wr = stats.wins / (stats.wins + stats.losses);
    console.log(`    ${conf.padEnd(14)} ${stats.wins}-${stats.losses} (${(wr * 100).toFixed(1)}%) Kelly: $${stats.pnl.toFixed(0)}`);
  }

  console.log('\n  CALIBRATION (predicted vs actual):');
  for (const [bucket, data] of Object.entries(calibrationBuckets).sort((a, b) => a[0] - b[0])) {
    const avgPredicted = data.predicted / data.count;
    const avgActual = data.actual / data.count;
    const bar = '█'.repeat(Math.round(avgActual * 20));
    console.log(`    ${bucket}%: predicted ${(avgPredicted * 100).toFixed(0)}%, actual ${(avgActual * 100).toFixed(0)}% (n=${data.count}) ${bar}`);
  }

  console.log('\n  DAILY P&L (last 7 days):');
  const days = Object.entries(dailyPnl).sort().slice(-7);
  let cumulative = 0;
  for (const [date, data] of days) {
    cumulative += data.kelly;
    console.log(`    ${date.slice(5)}: ${data.picks} picks, flat $${data.flat >= 0 ? '+' : ''}${data.flat.toFixed(0)}, kelly $${data.kelly >= 0 ? '+' : ''}${data.kelly.toFixed(0)} (cum: $${cumulative.toFixed(0)})`);
  }

  console.log('\n' + '═'.repeat(60));

  // Save to DB
  const calibration = {};
  for (const [bucket, data] of Object.entries(calibrationBuckets)) {
    calibration[bucket] = {
      predicted: (data.predicted / data.count).toFixed(3),
      actual: (data.actual / data.count).toFixed(3),
      count: data.count,
    };
  }

  try {
    backtestRuns.insert({
      run_date: new Date().toISOString().split('T')[0],
      model_version: 'ensemble-v3',
      date_range_start: dateRange.start,
      date_range_end: dateRange.end,
      total_picks: allPicks.length,
      wins, losses, pushes,
      win_rate: parseFloat((winRate * 100).toFixed(2)),
      roi: parseFloat((roi * 100).toFixed(2)),
      avg_clv: avgCLV,
      flat_pnl: parseFloat(flatPnl.toFixed(2)),
      kelly_pnl: parseFloat(kellyPnl.toFixed(2)),
      calibration_json: JSON.stringify(calibration),
      metrics_json: JSON.stringify({ byType, byConfidence, dailyPnl }),
      duration_ms: duration,
    });
    console.log('  Results saved to backtest_runs table.\n');
  } catch (e) {
    console.log('  (Could not save to DB:', e.message, ')\n');
  }
}

main();
