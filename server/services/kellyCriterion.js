/**
 * Kelly Criterion Bankroll Management
 *
 * Optimal bet sizing based on edge and odds.
 * Uses fractional Kelly (1/4) for conservative growth while managing ruin risk.
 * Based on Kelly (1956) information theory and Pinnacle's bankroll methodology.
 */

const DEFAULT_FRACTION = 0.25; // Quarter Kelly (conservative, industry standard)
const MAX_BET_PCT = 0.03;     // Never bet more than 3% of bankroll
const MIN_EDGE_THRESHOLD = 0.05; // Only bet when edge > 5% (was 3% — too many marginal bets)

/**
 * Calculate full Kelly stake percentage.
 * Kelly% = (b*p - q) / b
 * where b = decimal odds - 1, p = model probability, q = 1 - p
 *
 * @param {number} modelProb - Your model's win probability (0-1)
 * @param {number} americanOdds - American odds for the bet
 * @returns {number} Full Kelly percentage (0-1), or 0 if no edge
 */
function fullKelly(modelProb, americanOdds) {
  const decimal = americanOdds > 0
    ? (americanOdds / 100) + 1
    : (100 / Math.abs(americanOdds)) + 1;

  const b = decimal - 1; // Net profit per $1 wagered
  const p = modelProb;
  const q = 1 - p;

  const kelly = (b * p - q) / b;
  return Math.max(0, kelly);
}

/**
 * Calculate recommended bet size using fractional Kelly.
 *
 * @param {number} modelProb - Your model's win probability (0-1)
 * @param {number} americanOdds - American odds for the bet
 * @param {number} bankroll - Current bankroll in dollars
 * @param {Object} options - { fraction, maxBetPct, minEdge }
 * @returns {Object} { betSize, kellyPct, edge, impliedProb, recommendation }
 */
function calculateBetSize(modelProb, americanOdds, bankroll, options = {}) {
  const fraction = options.fraction || DEFAULT_FRACTION;
  const maxBetPct = options.maxBetPct || MAX_BET_PCT;
  const minEdge = options.minEdge || MIN_EDGE_THRESHOLD;

  // Calculate implied probability from odds
  const decimal = americanOdds > 0
    ? (americanOdds / 100) + 1
    : (100 / Math.abs(americanOdds)) + 1;
  const impliedProb = 1 / decimal;

  // Calculate edge
  const edge = modelProb - impliedProb;

  // No bet if edge below threshold
  if (edge < minEdge) {
    return {
      betSize: 0,
      kellyPct: 0,
      fractionalKellyPct: 0,
      edge: parseFloat((edge * 100).toFixed(2)),
      impliedProb: parseFloat((impliedProb * 100).toFixed(1)),
      modelProb: parseFloat((modelProb * 100).toFixed(1)),
      recommendation: 'NO BET',
      reason: `Edge ${(edge * 100).toFixed(1)}% below ${(minEdge * 100).toFixed(0)}% threshold`,
    };
  }

  // Full Kelly
  const kelly = fullKelly(modelProb, americanOdds);

  // Fractional Kelly
  let fractionalKelly = kelly * fraction;

  // Cap at max bet percentage
  fractionalKelly = Math.min(fractionalKelly, maxBetPct);

  // Calculate dollar amount
  const betSize = Math.round(bankroll * fractionalKelly * 100) / 100;

  // Confidence tier (aligned with 5% min edge)
  let recommendation;
  if (edge >= 0.10) recommendation = 'STRONG BET';
  else if (edge >= 0.07) recommendation = 'STANDARD BET';
  else if (edge >= 0.05) recommendation = 'SMALL BET';
  else recommendation = 'NO BET';

  return {
    betSize: parseFloat(betSize.toFixed(2)),
    kellyPct: parseFloat((kelly * 100).toFixed(2)),
    fractionalKellyPct: parseFloat((fractionalKelly * 100).toFixed(2)),
    edge: parseFloat((edge * 100).toFixed(2)),
    impliedProb: parseFloat((impliedProb * 100).toFixed(1)),
    modelProb: parseFloat((modelProb * 100).toFixed(1)),
    recommendation,
    expectedValue: parseFloat(((modelProb * (decimal - 1)) - (1 - modelProb)).toFixed(4)),
  };
}

/**
 * Size a slate of bets optimally given a bankroll.
 * Allocates proportionally by edge, respecting max total exposure.
 *
 * @param {Array} bets - [{ name, modelProb, americanOdds }]
 * @param {number} bankroll - Total bankroll
 * @param {Object} options - { fraction, maxBetPct, minEdge, maxTotalExposure }
 * @returns {Array} Sized bets with recommendations
 */
function sizeSlate(bets, bankroll, options = {}) {
  const maxTotalExposure = options.maxTotalExposure || 0.12; // Max 12% of bankroll at risk per day
  const minEdge = options.minEdge || MIN_EDGE_THRESHOLD;

  // Calculate individual Kelly for each bet
  const sized = bets.map(bet => ({
    ...bet,
    ...calculateBetSize(bet.modelProb, bet.americanOdds, bankroll, options),
  }));

  // Filter to actionable bets
  const actionable = sized.filter(b => b.betSize > 0);

  // Check total exposure
  const totalExposure = actionable.reduce((sum, b) => sum + b.betSize, 0);
  const totalPct = totalExposure / bankroll;

  // If over max exposure, scale down proportionally
  if (totalPct > maxTotalExposure) {
    const scaleFactor = maxTotalExposure / totalPct;
    for (const bet of actionable) {
      bet.betSize = parseFloat((bet.betSize * scaleFactor).toFixed(2));
      bet.fractionalKellyPct = parseFloat((bet.fractionalKellyPct * scaleFactor).toFixed(2));
      bet.scaled = true;
    }
  }

  return {
    bets: sized.sort((a, b) => b.edge - a.edge),
    summary: {
      totalBets: actionable.length,
      totalExposure: actionable.reduce((sum, b) => sum + b.betSize, 0),
      exposurePct: parseFloat((actionable.reduce((sum, b) => sum + b.betSize, 0) / bankroll * 100).toFixed(1)),
      avgEdge: actionable.length > 0
        ? parseFloat((actionable.reduce((sum, b) => sum + b.edge, 0) / actionable.length).toFixed(2))
        : 0,
      expectedProfit: parseFloat(
        actionable.reduce((sum, b) => sum + (b.betSize * b.expectedValue), 0).toFixed(2)
      ),
    },
  };
}

module.exports = {
  fullKelly,
  calculateBetSize,
  sizeSlate,
  DEFAULT_FRACTION,
  MAX_BET_PCT,
  MIN_EDGE_THRESHOLD,
};
