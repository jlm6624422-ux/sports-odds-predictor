/**
 * FIP/xFIP Calculator
 *
 * Fielding Independent Pitching - isolates pitcher skill from defense and luck.
 * ERA correlates year-to-year at r=0.4; FIP correlates at r=0.7.
 * Based on Tom Tango's research and Voros McCracken's DIPS theory.
 */

const LEAGUE_AVG_HR_PER_FB = 0.115; // ~11.5% of fly balls become HR (2024-2026 avg)
const FIP_CONSTANT = 3.10; // Adjusts annually; this is ~2025-2026 value

/**
 * Calculate FIP (Fielding Independent Pitching).
 * FIP = ((13*HR) + (3*(BB+HBP)) - (2*K)) / IP + FIP_constant
 *
 * @param {Object} stats - { homeRuns, walks, hitByPitch, strikeouts, inningsPitched }
 * @param {number} fipConstant - League-specific constant (default 3.10)
 * @returns {number} FIP value
 */
function calculateFIP(stats, fipConstant = FIP_CONSTANT) {
  const { homeRuns = 0, walks = 0, hitByPitch = 0, strikeouts = 0, inningsPitched = 0 } = stats;

  if (inningsPitched === 0) return null;

  return ((13 * homeRuns) + (3 * (walks + hitByPitch)) - (2 * strikeouts)) / inningsPitched + fipConstant;
}

/**
 * Calculate xFIP (Expected FIP).
 * Replaces actual HR with expected HR based on fly ball rate and league-avg HR/FB.
 * Better predictor of future performance than FIP.
 *
 * @param {Object} stats - { flyBalls, walks, hitByPitch, strikeouts, inningsPitched }
 * @param {number} hrPerFB - League average HR/FB rate
 * @returns {number} xFIP value
 */
function calculateXFIP(stats, hrPerFB = LEAGUE_AVG_HR_PER_FB) {
  const { flyBalls = 0, walks = 0, hitByPitch = 0, strikeouts = 0, inningsPitched = 0 } = stats;

  if (inningsPitched === 0) return null;

  const expectedHR = flyBalls * hrPerFB;
  return ((13 * expectedHR) + (3 * (walks + hitByPitch)) - (2 * strikeouts)) / inningsPitched + FIP_CONSTANT;
}

/**
 * Calculate SIERA (Skill-Interactive ERA) - simplified version.
 * Accounts for K%, BB%, and ground ball rate interactions.
 *
 * @param {Object} stats - { strikeouts, walks, groundBalls, battersfaced, inningsPitched }
 * @returns {number} Simplified SIERA approximation
 */
function calculateSIERA(stats) {
  const { strikeouts = 0, walks = 0, groundBalls = 0, battersfaced = 0, inningsPitched = 0 } = stats;

  if (battersfaced === 0 || inningsPitched === 0) return null;

  const kRate = strikeouts / battersfaced;
  const bbRate = walks / battersfaced;
  const gbRate = groundBalls / battersfaced;

  // Simplified SIERA formula (actual SIERA has more terms)
  return 6.145 - (16.986 * kRate) + (11.434 * bbRate) - (1.858 * gbRate)
    + (7.653 * kRate * kRate) + (6.145 * bbRate * bbRate)
    - (2.0 * kRate * gbRate) + (1.0 * bbRate * gbRate);
}

/**
 * Regress a pitcher stat toward league mean based on sample size.
 * Uses reliability formula: True = (observed * n + prior * k) / (n + k)
 *
 * Regression constants (from The Book):
 * - ERA: ~70 IP to stabilize
 * - FIP: ~50 IP to stabilize
 * - K%: ~70 PA to stabilize
 * - BB%: ~170 PA to stabilize
 *
 * @param {number} observed - Pitcher's observed stat
 * @param {number} sampleSize - Innings pitched (or PA)
 * @param {number} leagueMean - League average for the stat
 * @param {number} stabilization - IP/PA needed to stabilize (default 50 for FIP)
 * @returns {{ regressed, reliability }}
 */
function regressToMean(observed, sampleSize, leagueMean, stabilization = 50) {
  const reliability = sampleSize / (sampleSize + stabilization);
  const regressed = (observed * reliability) + (leagueMean * (1 - reliability));
  return {
    regressed: parseFloat(regressed.toFixed(2)),
    reliability: parseFloat(reliability.toFixed(3)),
  };
}

/**
 * Get pitcher quality score for game prediction.
 * Blends FIP with recent performance, regressed by innings.
 *
 * @param {Object} seasonStats - Full season { homeRuns, walks, hitByPitch, strikeouts, inningsPitched, era }
 * @param {Object|null} recentStats - Last 5 starts (same fields, optional)
 * @param {number} leagueAvgFIP - League average FIP (~4.00)
 * @returns {{ fip, regressedFIP, blendedScore, runsPerGame, quality }}
 */
function getPitcherScore(seasonStats, recentStats = null, leagueAvgFIP = 4.00) {
  const fip = calculateFIP(seasonStats);
  if (fip === null) return null;

  // Regress FIP based on innings
  const { regressed: regressedFIP, reliability } = regressToMean(
    fip, seasonStats.inningsPitched, leagueAvgFIP, 50
  );

  // Blend with recent (60% regressed season, 40% recent if available)
  let blendedScore = regressedFIP;
  if (recentStats && recentStats.inningsPitched >= 15) {
    const recentFIP = calculateFIP(recentStats);
    if (recentFIP !== null) {
      blendedScore = (regressedFIP * 0.6) + (recentFIP * 0.4);
    }
  }

  // Convert to expected runs allowed per game (9 innings)
  const runsPerGame = blendedScore * 0.95; // FIP slightly overstates runs due to sequencing

  // Quality tier
  let quality;
  if (blendedScore <= 2.75) quality = 'elite';
  else if (blendedScore <= 3.50) quality = 'above_average';
  else if (blendedScore <= 4.25) quality = 'average';
  else if (blendedScore <= 5.00) quality = 'below_average';
  else quality = 'poor';

  return {
    fip: parseFloat(fip.toFixed(2)),
    era: seasonStats.era || null,
    regressedFIP: parseFloat(regressedFIP.toFixed(2)),
    blendedScore: parseFloat(blendedScore.toFixed(2)),
    runsPerGame: parseFloat(runsPerGame.toFixed(2)),
    reliability: reliability,
    inningsPitched: seasonStats.inningsPitched,
    quality,
  };
}

/**
 * Calculate run expectation adjustment for a game based on two starters.
 * Returns runs above/below average expected for each team.
 *
 * @param {Object} homePitcherScore - From getPitcherScore()
 * @param {Object} awayPitcherScore - From getPitcherScore()
 * @param {number} leagueAvgRPG - League average runs per game (~4.5)
 * @returns {{ homeRunsExpected, awayRunsExpected, totalAdjustment }}
 */
function getRunExpectation(homePitcherScore, awayPitcherScore, leagueAvgRPG = 4.50) {
  // Away team faces home pitcher; home team faces away pitcher
  const awayRunsExpected = homePitcherScore
    ? homePitcherScore.runsPerGame
    : leagueAvgRPG;
  const homeRunsExpected = awayPitcherScore
    ? awayPitcherScore.runsPerGame
    : leagueAvgRPG;

  const totalAdjustment = (homeRunsExpected + awayRunsExpected) - (2 * leagueAvgRPG);

  return {
    homeRunsExpected: parseFloat(homeRunsExpected.toFixed(2)),
    awayRunsExpected: parseFloat(awayRunsExpected.toFixed(2)),
    totalAdjustment: parseFloat(totalAdjustment.toFixed(2)),
  };
}

module.exports = {
  calculateFIP,
  calculateXFIP,
  calculateSIERA,
  regressToMean,
  getPitcherScore,
  getRunExpectation,
  FIP_CONSTANT,
  LEAGUE_AVG_HR_PER_FB,
};
