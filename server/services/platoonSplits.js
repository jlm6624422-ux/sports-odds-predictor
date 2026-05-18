/**
 * Platoon Splits Module
 *
 * LHB vs RHP = +.020 wOBA advantage. Based on The Book (Tango, Lichtman, Dolphin, 2006).
 * Extreme-split pitchers facing stacked lineups = value on totals.
 * Regress individual splits toward population platoon mean (sample sizes are small).
 */

const { MlbStatsService } = require('./mlbStats');
const { regressToMean } = require('./fipCalculator');

const mlb = new MlbStatsService();

// Population-level platoon advantages (from The Book)
const PLATOON_CONSTANTS = {
  wOBA_LHB_vs_RHP: 0.020,  // LHB hit ~.020 higher wOBA vs RHP than vs LHP
  wOBA_RHB_vs_LHP: 0.015,  // RHB hit ~.015 higher wOBA vs LHP than vs RHP
  BA_platoon_adj: 0.015,    // Batting average platoon gap
  ISO_platoon_adj: 0.020,   // ISO (power) platoon gap
  K_rate_platoon: -0.02,    // Strikeout rate lower for platoon advantage
  BB_rate_platoon: 0.01,    // Walk rate higher for platoon advantage
};

// wOBA weights for run estimation (2025-2026 values)
const WOBA_WEIGHTS = {
  BB: 0.69,
  HBP: 0.72,
  single: 0.88,
  double: 1.24,
  triple: 1.56,
  HR: 2.01,
};
const WOBA_SCALE = 1.21;
const LEAGUE_WOBA = 0.315;
const LEAGUE_RPG = 4.50;

/**
 * Estimate team wOBA against a specific pitcher handedness.
 *
 * @param {Object} teamStats - { battingAvg, obp, slg, wOBA, leftPct } or from API
 * @param {string} pitcherHand - 'L' or 'R'
 * @returns {{ adjustedWOBA, platoonAdvantage, runsAboveAvg }}
 */
function estimateTeamPlatoonWOBA(teamStats, pitcherHand) {
  const baseWOBA = teamStats.wOBA || LEAGUE_WOBA;
  const leftPct = teamStats.leftPct || 0.45; // % of lineup that bats left

  let platoonAdj = 0;
  if (pitcherHand === 'R') {
    // LHBs have advantage vs RHP
    platoonAdj = leftPct * PLATOON_CONSTANTS.wOBA_LHB_vs_RHP;
  } else {
    // RHBs have advantage vs LHP
    platoonAdj = (1 - leftPct) * PLATOON_CONSTANTS.wOBA_RHB_vs_LHP;
  }

  const adjustedWOBA = baseWOBA + platoonAdj;
  const runsAboveAvg = ((adjustedWOBA - LEAGUE_WOBA) / WOBA_SCALE) * 38; // ~38 PA per game

  return {
    adjustedWOBA: parseFloat(adjustedWOBA.toFixed(3)),
    baseWOBA: parseFloat(baseWOBA.toFixed(3)),
    platoonAdvantage: parseFloat(platoonAdj.toFixed(3)),
    runsAboveAvg: parseFloat(runsAboveAvg.toFixed(2)),
    pitcherHand,
  };
}

/**
 * Assess pitcher's platoon vulnerability.
 * Some pitchers have extreme splits (e.g., LHP who can't get LHB out).
 *
 * @param {Object} splits - { vsLeft: { era, whip, ba }, vsRight: { era, whip, ba } }
 * @param {string} pitcherHand - 'L' or 'R'
 * @param {number} totalBattersVsSame - Sample size vs same-hand batters
 * @returns {{ splitDiff, vulnerability, regressed }}
 */
function assessPitcherPlatoonVulnerability(splits, pitcherHand, totalBattersVsSame = 100) {
  if (!splits || !splits.vsLeft || !splits.vsRight) {
    return { splitDiff: 0, vulnerability: 'unknown', regressed: true };
  }

  // ERA split
  const eraSplit = pitcherHand === 'L'
    ? splits.vsRight.era - splits.vsLeft.era  // LHP: how much worse vs RHB
    : splits.vsLeft.era - splits.vsRight.era;  // RHP: how much worse vs LHB

  // Regress toward population split based on sample size
  const populationSplit = pitcherHand === 'L' ? 0.5 : 0.4; // ERA points typical split
  const { regressed } = regressToMean(eraSplit, totalBattersVsSame, populationSplit, 150);

  let vulnerability;
  if (regressed >= 1.5) vulnerability = 'extreme';
  else if (regressed >= 0.8) vulnerability = 'significant';
  else if (regressed >= 0.4) vulnerability = 'normal';
  else vulnerability = 'reverse_platoon'; // Rare: better vs opposite hand

  return {
    splitDiff: parseFloat(eraSplit.toFixed(2)),
    regressedSplit: parseFloat(regressed.toFixed(2)),
    vulnerability,
    sampleSize: totalBattersVsSame,
  };
}

/**
 * Calculate total run adjustment from platoon matchup.
 *
 * @param {Object} params
 * @param {string} params.homePitcherHand - 'L' or 'R'
 * @param {string} params.awayPitcherHand - 'L' or 'R'
 * @param {Object} params.homeTeamStats - { wOBA, leftPct }
 * @param {Object} params.awayTeamStats - { wOBA, leftPct }
 * @param {Object|null} params.homePitcherSplits - Pitcher's vs L/R splits
 * @param {Object|null} params.awayPitcherSplits - Pitcher's vs L/R splits
 * @returns {{ homeRunAdj, awayRunAdj, totalAdj, analysis }}
 */
function getPlatoonRunAdjustment(params) {
  const { homePitcherHand, awayPitcherHand, homeTeamStats, awayTeamStats,
    homePitcherSplits, awayPitcherSplits } = params;

  // Away team hitting vs home pitcher
  const awayVsHomePitcher = estimateTeamPlatoonWOBA(
    awayTeamStats || { wOBA: LEAGUE_WOBA, leftPct: 0.45 },
    homePitcherHand
  );

  // Home team hitting vs away pitcher
  const homeVsAwayPitcher = estimateTeamPlatoonWOBA(
    homeTeamStats || { wOBA: LEAGUE_WOBA, leftPct: 0.45 },
    awayPitcherHand
  );

  // Pitcher vulnerability adjustments
  let homePitcherVuln = 0;
  let awayPitcherVuln = 0;
  if (homePitcherSplits) {
    const vuln = assessPitcherPlatoonVulnerability(homePitcherSplits, homePitcherHand);
    if (vuln.vulnerability === 'extreme') homePitcherVuln = 0.5;
    else if (vuln.vulnerability === 'significant') homePitcherVuln = 0.25;
  }
  if (awayPitcherSplits) {
    const vuln = assessPitcherPlatoonVulnerability(awayPitcherSplits, awayPitcherHand);
    if (vuln.vulnerability === 'extreme') awayPitcherVuln = 0.5;
    else if (vuln.vulnerability === 'significant') awayPitcherVuln = 0.25;
  }

  const awayRunAdj = awayVsHomePitcher.runsAboveAvg + homePitcherVuln;
  const homeRunAdj = homeVsAwayPitcher.runsAboveAvg + awayPitcherVuln;
  const totalAdj = homeRunAdj + awayRunAdj;

  const analysis = [];
  if (awayVsHomePitcher.platoonAdvantage > 0.01) {
    analysis.push(`Away team has platoon edge vs ${homePitcherHand}HP (+${awayVsHomePitcher.platoonAdvantage.toFixed(3)} wOBA)`);
  }
  if (homeVsAwayPitcher.platoonAdvantage > 0.01) {
    analysis.push(`Home team has platoon edge vs ${awayPitcherHand}HP (+${homeVsAwayPitcher.platoonAdvantage.toFixed(3)} wOBA)`);
  }
  if (homePitcherVuln > 0) analysis.push(`Home pitcher has ${homePitcherSplits ? 'significant' : 'extreme'} platoon vulnerability`);
  if (awayPitcherVuln > 0) analysis.push(`Away pitcher has ${awayPitcherSplits ? 'significant' : 'extreme'} platoon vulnerability`);

  return {
    homeRunAdj: parseFloat(homeRunAdj.toFixed(2)),
    awayRunAdj: parseFloat(awayRunAdj.toFixed(2)),
    totalAdj: parseFloat(totalAdj.toFixed(2)),
    analysis: analysis.length > 0 ? analysis : ['Normal platoon matchup'],
  };
}

module.exports = {
  estimateTeamPlatoonWOBA,
  assessPitcherPlatoonVulnerability,
  getPlatoonRunAdjustment,
  PLATOON_CONSTANTS,
  WOBA_WEIGHTS,
};
