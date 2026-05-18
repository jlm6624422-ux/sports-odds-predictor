/**
 * NBA Four Factors Model
 *
 * Dean Oliver's "Four Factors of Basketball Success" (2004).
 * Foundation of modern NBA analytics (KenPom, BPI, etc.)
 *
 * Four Factors (offense + defense):
 * 1. eFG% (Effective FG%) — weight 40%
 * 2. TOV% (Turnover Rate) — weight 25%
 * 3. ORB% (Offensive Rebound Rate) — weight 20%
 * 4. FT Rate (Free Throw Rate) — weight 15%
 *
 * Pace-adjusted efficiency (points per 100 possessions) is more predictive
 * than raw points per game.
 */

// League averages (2025-2026 NBA season estimates)
const LEAGUE_AVG = {
  pace: 99.5,        // Possessions per game
  ortg: 113.5,       // Points per 100 possessions (offense)
  drtg: 113.5,       // Points per 100 possessions (defense)
  efg: 0.545,        // Effective FG%
  tov: 0.130,        // Turnover rate
  orb: 0.260,        // Offensive rebound rate
  ftRate: 0.270,     // FTA/FGA
};

// Factor weights from Oliver's research
const FACTOR_WEIGHTS = {
  efg: 0.40,
  tov: 0.25,
  orb: 0.20,
  ftRate: 0.15,
};

/**
 * Calculate offensive and defensive ratings from team stats.
 *
 * @param {Object} stats - { pointsFor, pointsAgainst, pace, fgm, fga, fg3m, ftm, fta, tov, orb, drb, gamesPlayed }
 * @returns {{ ortg, drtg, netRtg, pace }}
 */
function calculateRatings(stats) {
  const { pointsFor, pointsAgainst, pace, gamesPlayed } = stats;
  if (!gamesPlayed || gamesPlayed === 0) {
    return { ortg: LEAGUE_AVG.ortg, drtg: LEAGUE_AVG.drtg, netRtg: 0, pace: LEAGUE_AVG.pace };
  }

  const teamPace = pace || LEAGUE_AVG.pace;
  const possessions = teamPace * gamesPlayed;

  const ortg = possessions > 0 ? (pointsFor / possessions) * 100 : LEAGUE_AVG.ortg;
  const drtg = possessions > 0 ? (pointsAgainst / possessions) * 100 : LEAGUE_AVG.drtg;

  return {
    ortg: parseFloat(ortg.toFixed(1)),
    drtg: parseFloat(drtg.toFixed(1)),
    netRtg: parseFloat((ortg - drtg).toFixed(1)),
    pace: parseFloat(teamPace.toFixed(1)),
  };
}

/**
 * Calculate Four Factors score for a team.
 *
 * @param {Object} factors - { efg, tov, orb, ftRate } (rates, not percentages)
 * @returns {{ score, factors, grade }}
 */
function calculateFourFactorsScore(factors) {
  const { efg = LEAGUE_AVG.efg, tov = LEAGUE_AVG.tov, orb = LEAGUE_AVG.orb, ftRate = LEAGUE_AVG.ftRate } = factors;

  // Normalize each factor relative to league average (1.0 = average)
  const efgNorm = efg / LEAGUE_AVG.efg;
  const tovNorm = LEAGUE_AVG.tov / tov; // Inverted: lower TOV = better
  const orbNorm = orb / LEAGUE_AVG.orb;
  const ftNorm = ftRate / LEAGUE_AVG.ftRate;

  // Weighted composite score
  const score = (efgNorm * FACTOR_WEIGHTS.efg) +
    (tovNorm * FACTOR_WEIGHTS.tov) +
    (orbNorm * FACTOR_WEIGHTS.orb) +
    (ftNorm * FACTOR_WEIGHTS.ftRate);

  let grade;
  if (score >= 1.08) grade = 'elite';
  else if (score >= 1.03) grade = 'above_average';
  else if (score >= 0.97) grade = 'average';
  else if (score >= 0.92) grade = 'below_average';
  else grade = 'poor';

  return {
    score: parseFloat(score.toFixed(4)),
    factors: {
      efg: parseFloat(efg.toFixed(3)),
      tov: parseFloat(tov.toFixed(3)),
      orb: parseFloat(orb.toFixed(3)),
      ftRate: parseFloat(ftRate.toFixed(3)),
    },
    normalized: { efgNorm: parseFloat(efgNorm.toFixed(3)), tovNorm: parseFloat(tovNorm.toFixed(3)), orbNorm: parseFloat(orbNorm.toFixed(3)), ftNorm: parseFloat(ftNorm.toFixed(3)) },
    grade,
  };
}

/**
 * Project game outcome using pace-adjusted efficiency.
 *
 * Formula: Team A expected points = (A_ORtg vs B_DRtg) * projected_pace / 100
 * Matchup-adjusted: A_offense = (A_ORtg + league_avg_DRtg - B_DRtg) -- adjusts for opponent quality
 *
 * @param {Object} homeTeam - { ortg, drtg, pace, fourFactors }
 * @param {Object} awayTeam - { ortg, drtg, pace, fourFactors }
 * @param {Object} options - { homeCourtAdv, restAdj }
 * @returns {{ homePoints, awayPoints, total, spread, homeWinProb }}
 */
function projectGame(homeTeam, awayTeam, options = {}) {
  const homeCourtAdv = options.homeCourtAdv || 2.5; // Points (reduced post-2020)
  const restAdj = options.restAdj || 0;

  // Projected pace = average of both teams' pace, adjusted to league avg
  const projPace = ((homeTeam.pace || LEAGUE_AVG.pace) + (awayTeam.pace || LEAGUE_AVG.pace)) / 2;

  // Matchup-adjusted offensive ratings
  // Home offense vs Away defense: Home_ORtg + (LeagueAvg_DRtg - Away_DRtg)
  const homeAdjORtg = (homeTeam.ortg || LEAGUE_AVG.ortg) + (LEAGUE_AVG.drtg - (awayTeam.drtg || LEAGUE_AVG.drtg));
  const awayAdjORtg = (awayTeam.ortg || LEAGUE_AVG.ortg) + (LEAGUE_AVG.drtg - (homeTeam.drtg || LEAGUE_AVG.drtg));

  // Project points
  let homePoints = (homeAdjORtg * projPace / 100) + (homeCourtAdv / 2);
  let awayPoints = (awayAdjORtg * projPace / 100) - (homeCourtAdv / 2);

  // Rest adjustment
  homePoints += restAdj / 2;
  awayPoints -= restAdj / 2;

  const total = homePoints + awayPoints;
  const spread = awayPoints - homePoints; // Negative = home favored

  // Convert margin to win probability (~2.5% per point in NBA)
  const margin = homePoints - awayPoints;
  const homeWinProb = 0.5 + (margin * 0.025);

  return {
    homePoints: parseFloat(homePoints.toFixed(1)),
    awayPoints: parseFloat(awayPoints.toFixed(1)),
    total: parseFloat(total.toFixed(1)),
    spread: parseFloat(spread.toFixed(1)),
    homeWinProb: parseFloat(Math.min(0.95, Math.max(0.05, homeWinProb)).toFixed(3)),
    projPace: parseFloat(projPace.toFixed(1)),
    homeAdjORtg: parseFloat(homeAdjORtg.toFixed(1)),
    awayAdjORtg: parseFloat(awayAdjORtg.toFixed(1)),
  };
}

/**
 * Full NBA game prediction using Four Factors + pace + efficiency.
 *
 * @param {Object} params
 * @param {Object} params.homeTeam - { name, ortg, drtg, pace, fourFactors, record }
 * @param {Object} params.awayTeam - { name, ortg, drtg, pace, fourFactors, record }
 * @param {number} params.restAdj - Net rest adjustment (from nbaRestTravel module)
 * @param {Object|null} params.injuries - { home: [{player, impact}], away: [...] }
 * @returns {Object} Full game projection
 */
function predictNBAGame(params) {
  const { homeTeam, awayTeam, restAdj = 0, injuries = null } = params;

  // Calculate Four Factors scores
  const homeFFS = homeTeam.fourFactors
    ? calculateFourFactorsScore(homeTeam.fourFactors)
    : { score: 1.0, grade: 'average' };
  const awayFFS = awayTeam.fourFactors
    ? calculateFourFactorsScore(awayTeam.fourFactors)
    : { score: 1.0, grade: 'average' };

  // Injury adjustment (each key player out = ~-2 pts)
  let homeInjuryAdj = 0, awayInjuryAdj = 0;
  if (injuries) {
    homeInjuryAdj = -(injuries.home || []).reduce((sum, inj) => sum + (inj.impact || 2), 0);
    awayInjuryAdj = -(injuries.away || []).reduce((sum, inj) => sum + (inj.impact || 2), 0);
  }

  // Project game
  const projection = projectGame(homeTeam, awayTeam, {
    homeCourtAdv: 2.5,
    restAdj: restAdj + homeInjuryAdj - awayInjuryAdj,
  });

  // Confidence based on data quality
  const hasRatings = homeTeam.ortg && awayTeam.ortg;
  const hasFourFactors = homeTeam.fourFactors && awayTeam.fourFactors;
  let confidence = 'medium';
  if (hasRatings && hasFourFactors) confidence = 'high';
  else if (!hasRatings) confidence = 'low';

  return {
    game: { home: homeTeam.name, away: awayTeam.name },
    projection,
    fourFactors: { home: homeFFS, away: awayFFS },
    adjustments: { rest: restAdj, homeInjury: homeInjuryAdj, awayInjury: awayInjuryAdj },
    confidence,
  };
}

module.exports = {
  calculateRatings,
  calculateFourFactorsScore,
  projectGame,
  predictNBAGame,
  LEAGUE_AVG,
  FACTOR_WEIGHTS,
};
