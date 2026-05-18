/**
 * Closing Line Value (CLV) Tracker
 * Adapted from BetTrack (WFord26/BetTrack)
 *
 * CLV = the gold standard metric for evaluating betting skill.
 * Measures difference between odds when you bet vs odds at game start.
 * Positive CLV = you consistently beat the closing line = long-term edge.
 */

const { calculateImpliedProbability } = require('./oddsCalculator');

/**
 * Calculate CLV for a single bet.
 * @param {number} placedOdds - American odds when bet was placed
 * @param {number} closingOdds - American odds at game start (closing line)
 * @returns {{ clv, category, placedImplied, closingImplied }}
 */
function calculateBetCLV(placedOdds, closingOdds) {
  const placedImplied = calculateImpliedProbability(placedOdds);
  const closingImplied = calculateImpliedProbability(closingOdds);

  const clv = ((closingImplied - placedImplied) / placedImplied) * 100;

  let category;
  if (clv > 1) category = 'positive';
  else if (clv < -1) category = 'negative';
  else category = 'neutral';

  return {
    clv: parseFloat(clv.toFixed(2)),
    category,
    placedImplied: parseFloat((placedImplied * 100).toFixed(1)),
    closingImplied: parseFloat((closingImplied * 100).toFixed(1)),
  };
}

/**
 * Generate CLV report from an array of settled bets.
 * @param {Array} bets - [{ placedOdds, closingOdds, result, stake, sport }]
 * @returns {Object} CLV report
 */
function generateCLVReport(bets) {
  if (bets.length === 0) {
    return { totalBets: 0, averageCLV: 0, positiveCLV: 0, negativeCLV: 0, clvWinRate: 0 };
  }

  const analyzed = bets.map(bet => ({
    ...bet,
    ...calculateBetCLV(bet.placedOdds, bet.closingOdds),
  }));

  const totalBets = analyzed.length;
  const averageCLV = analyzed.reduce((sum, b) => sum + b.clv, 0) / totalBets;
  const positiveCLV = analyzed.filter(b => b.category === 'positive').length;
  const negativeCLV = analyzed.filter(b => b.category === 'negative').length;

  // CLV win rate: how often positive-CLV bets actually win
  const positiveCLVBets = analyzed.filter(b => b.category === 'positive' && b.result);
  const positiveCLVWins = positiveCLVBets.filter(b => b.result === 'won').length;
  const clvWinRate = positiveCLVBets.length > 0
    ? (positiveCLVWins / positiveCLVBets.length) * 100
    : 0;

  // By sport breakdown
  const bySport = {};
  for (const bet of analyzed) {
    const sport = bet.sport || 'unknown';
    if (!bySport[sport]) bySport[sport] = [];
    bySport[sport].push(bet.clv);
  }
  const sportBreakdown = Object.entries(bySport).map(([sport, clvs]) => ({
    sport,
    averageCLV: parseFloat((clvs.reduce((s, v) => s + v, 0) / clvs.length).toFixed(2)),
    count: clvs.length,
  }));

  // ROI calculation
  const settled = analyzed.filter(b => b.result && b.stake);
  const totalStaked = settled.reduce((sum, b) => sum + (b.stake || 0), 0);
  const totalReturned = settled.reduce((sum, b) => {
    if (b.result === 'won') {
      const decimal = b.placedOdds > 0 ? (b.placedOdds / 100) + 1 : (100 / Math.abs(b.placedOdds)) + 1;
      return sum + (b.stake * decimal);
    }
    if (b.result === 'push') return sum + b.stake;
    return sum;
  }, 0);
  const roi = totalStaked > 0 ? ((totalReturned - totalStaked) / totalStaked) * 100 : 0;

  return {
    totalBets,
    averageCLV: parseFloat(averageCLV.toFixed(2)),
    positiveCLV,
    negativeCLV,
    neutralCLV: totalBets - positiveCLV - negativeCLV,
    clvWinRate: parseFloat(clvWinRate.toFixed(1)),
    roi: parseFloat(roi.toFixed(2)),
    bySport: sportBreakdown,
    topBets: analyzed.sort((a, b) => b.clv - a.clv).slice(0, 5),
    worstBets: analyzed.sort((a, b) => a.clv - b.clv).slice(0, 5),
  };
}

module.exports = { calculateBetCLV, generateCLVReport };
