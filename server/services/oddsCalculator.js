/**
 * Odds Calculator Utility
 * Adapted from BetTrack (WFord26/BetTrack)
 *
 * Comprehensive betting math: conversions, payouts, implied probability,
 * bet settlement, teaser tables.
 */

function americanToDecimal(american) {
  if (american === 0) throw new Error('American odds cannot be zero');
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

function decimalToAmerican(decimal) {
  if (decimal < 1.01) throw new Error('Decimal odds must be at least 1.01');
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function calculateImpliedProbability(americanOdds) {
  return 1 / americanToDecimal(americanOdds);
}

function calculatePayout(stake, americanOdds) {
  return stake * americanToDecimal(americanOdds);
}

function calculateProfit(stake, americanOdds) {
  return calculatePayout(stake, americanOdds) - stake;
}

function calculateParlayOdds(legs) {
  return legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
}

function calculateParlayPayout(stake, legs) {
  return stake * calculateParlayOdds(legs);
}

/**
 * Remove vig from a two-way market to get true probabilities.
 * @param {number} homeOdds - American odds for home
 * @param {number} awayOdds - American odds for away
 * @returns {{ homeProb, awayProb, vig }}
 */
function removeVig(homeOdds, awayOdds) {
  const homeImplied = calculateImpliedProbability(homeOdds);
  const awayImplied = calculateImpliedProbability(awayOdds);
  const totalImplied = homeImplied + awayImplied;
  const vig = totalImplied - 1;
  return {
    homeProb: homeImplied / totalImplied,
    awayProb: awayImplied / totalImplied,
    vig: parseFloat((vig * 100).toFixed(2)),
  };
}

function determineMoneylineOutcome(selection, homeScore, awayScore) {
  if (homeScore === awayScore) return 'push';
  const homeWon = homeScore > awayScore;
  if (selection === 'home') return homeWon ? 'won' : 'lost';
  return homeWon ? 'lost' : 'won';
}

function determineSpreadOutcome(selection, line, homeScore, awayScore) {
  const coverDifferential = (homeScore - awayScore) - line;
  if (coverDifferential === 0) return 'push';
  const homeCovered = coverDifferential > 0;
  if (selection === 'home') return homeCovered ? 'won' : 'lost';
  return homeCovered ? 'lost' : 'won';
}

function determineTotalOutcome(selection, line, totalScore) {
  if (totalScore === line) return 'push';
  const wentOver = totalScore > line;
  if (selection === 'over') return wentOver ? 'won' : 'lost';
  return wentOver ? 'lost' : 'won';
}

/**
 * Calculate Closing Line Value (CLV).
 * Positive = you beat the closing line (good). Negative = you didn't.
 * @param {number} openingOdds - Odds when bet was placed
 * @param {number} closingOdds - Odds at game start
 * @returns {number} CLV percentage
 */
function calculateCLV(openingOdds, closingOdds) {
  const openingImplied = calculateImpliedProbability(openingOdds);
  const closingImplied = calculateImpliedProbability(closingOdds);
  return ((closingImplied - openingImplied) / openingImplied) * 100;
}

module.exports = {
  americanToDecimal,
  decimalToAmerican,
  calculateImpliedProbability,
  calculatePayout,
  calculateProfit,
  calculateParlayOdds,
  calculateParlayPayout,
  removeVig,
  determineMoneylineOutcome,
  determineSpreadOutcome,
  determineTotalOutcome,
  calculateCLV,
};
