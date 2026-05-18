/**
 * Enhanced Prediction Model
 *
 * Improvements over base model:
 * 1. Pythagorean expectation (run differential > raw W-L)
 * 2. Starting pitcher ERA/FIP adjustment
 * 3. Market consensus disagreement as a signal
 * 4. Park factor adjustments
 * 5. Vig-removed true probabilities
 */

const { MlbStatsService } = require('./mlbStats');
const { calculateConsensus, americanToImpliedProb } = require('./marketConsensus');
const { removeVig } = require('./oddsCalculator');

const mlb = new MlbStatsService();

// MLB park factors (runs relative to neutral, 1.0 = average)
const PARK_FACTORS = {
  'Coors Field': 1.35,
  'Globe Life Field': 1.08,
  'Great American Ball Park': 1.12,
  'Fenway Park': 1.05,
  'Yankee Stadium': 1.10,
  'Citizens Bank Park': 1.06,
  'Wrigley Field': 1.04,
  'Guaranteed Rate Field': 1.03,
  'Tropicana Field': 0.90,
  'Oracle Park': 0.88,
  'Petco Park': 0.92,
  'T-Mobile Park': 0.93,
  'Dodger Stadium': 0.97,
  'Angel Stadium': 0.98,
  'Kauffman Stadium': 0.96,
  'Target Field': 1.01,
  'Progressive Field': 0.98,
  'Comerica Park': 0.95,
  'Rogers Centre': 1.02,
  'Minute Maid Park': 1.04,
  'Busch Stadium': 0.96,
  'PNC Park': 0.94,
  'Nationals Park': 1.01,
  'Truist Park': 1.02,
  'loanDepot park': 1.00,
  'Citi Field': 0.95,
  'Oakland Coliseum': 0.93,
  'Chase Field': 1.06,
  'American Family Field': 1.03,
  'Camden Yards': 1.05,
};

const MLB_HOME_ADV = 0.040;
const PYTHAGOREAN_EXPONENT = 1.83; // MLB standard

/**
 * Calculate Pythagorean win% from runs scored/allowed.
 * Better predictor of future performance than actual W-L.
 */
function pythagoreanWinPct(runsScored, runsAllowed, exponent = PYTHAGOREAN_EXPONENT) {
  if (runsScored + runsAllowed === 0) return 0.5;
  return Math.pow(runsScored, exponent) /
    (Math.pow(runsScored, exponent) + Math.pow(runsAllowed, exponent));
}

/**
 * Adjust win probability based on starting pitcher quality.
 * Uses ERA relative to league average (4.25 ERA = neutral).
 *
 * @param {number} baseProb - Base win probability
 * @param {number} pitcherERA - Starter's ERA
 * @param {number} oppPitcherERA - Opponent starter's ERA
 * @returns {number} Adjusted probability
 */
function adjustForPitchers(baseProb, pitcherERA, oppPitcherERA) {
  const leagueAvgERA = 4.25;

  // Convert ERA to quality score (lower ERA = higher quality)
  // Each 1.0 ERA below league avg = ~3% win probability boost
  const pitcherAdj = (leagueAvgERA - pitcherERA) * 0.03;
  const oppPitcherAdj = (leagueAvgERA - oppPitcherERA) * 0.03;

  // Net adjustment: your pitcher's edge minus opponent's edge
  const netAdj = pitcherAdj - oppPitcherAdj;

  return Math.min(0.85, Math.max(0.15, baseProb + netAdj));
}

/**
 * Apply park factor to expected runs.
 *
 * @param {number} expectedRuns - Base expected runs for both teams
 * @param {string} venueName - Stadium name
 * @returns {number} Park-adjusted expected runs
 */
function applyParkFactor(expectedRuns, venueName) {
  const factor = PARK_FACTORS[venueName] || 1.0;
  return expectedRuns * factor;
}

/**
 * Full enhanced MLB prediction.
 *
 * @param {Object} params
 * @param {Object} params.homeTeam - { name, wins, losses, runsScored, runsAllowed }
 * @param {Object} params.awayTeam - { name, wins, losses, runsScored, runsAllowed }
 * @param {Object|null} params.homePitcher - { name, era, fip, innings } or null
 * @param {Object|null} params.awayPitcher - { name, era, fip, innings } or null
 * @param {Array|null} params.bookmakers - Odds API bookmaker array
 * @param {string|null} params.venue - Stadium name
 * @returns {Object} Full prediction with multiple model outputs
 */
function predictMLB({ homeTeam, awayTeam, homePitcher, awayPitcher, bookmakers, venue }) {
  // 1. Pythagorean win%
  const homePythag = pythagoreanWinPct(homeTeam.runsScored || 0, homeTeam.runsAllowed || 0);
  const awayPythag = pythagoreanWinPct(awayTeam.runsScored || 0, awayTeam.runsAllowed || 0);

  // 2. Base probability from Pythagorean + home advantage
  let homeBaseProb = (homePythag / (homePythag + awayPythag)) + MLB_HOME_ADV;
  homeBaseProb = Math.min(0.85, Math.max(0.15, homeBaseProb));

  // 3. Pitcher adjustment
  let homePitcherAdj = homeBaseProb;
  if (homePitcher && awayPitcher && homePitcher.era && awayPitcher.era) {
    homePitcherAdj = adjustForPitchers(homeBaseProb, homePitcher.era, awayPitcher.era);
  }

  // 4. Market consensus (if bookmakers provided)
  let marketProb = null;
  let consensus = null;
  let vigFreeProb = null;
  if (bookmakers && bookmakers.length >= 2) {
    consensus = calculateConsensus(bookmakers, homeTeam.name, awayTeam.name);

    // Get vig-free probability from consensus
    if (consensus.h2h) {
      vigFreeProb = consensus.h2h.consensusHomeProb / 100;
    }
  }

  // 5. Blend: 50% model (pythag + pitchers) / 50% market (if available)
  let finalHomeProb;
  if (vigFreeProb !== null) {
    finalHomeProb = (homePitcherAdj * 0.50) + (vigFreeProb * 0.50);
  } else {
    finalHomeProb = homePitcherAdj;
  }
  const finalAwayProb = 1 - finalHomeProb;

  // 6. Expected total runs
  const homeGames = (homeTeam.wins || 0) + (homeTeam.losses || 0);
  const awayGames = (awayTeam.wins || 0) + (awayTeam.losses || 0);
  const homeRPG = homeGames > 0 ? (homeTeam.runsScored || 0) / homeGames : 4.5;
  const awayRPG = awayGames > 0 ? (awayTeam.runsScored || 0) / awayGames : 4.5;
  const homeRAPG = homeGames > 0 ? (homeTeam.runsAllowed || 0) / homeGames : 4.5;
  const awayRAPG = awayGames > 0 ? (awayTeam.runsAllowed || 0) / awayGames : 4.5;

  // Expected runs = (team offense + opponent defense) / 2 for each side
  let expectedHomeRuns = (homeRPG + awayRAPG) / 2;
  let expectedAwayRuns = (awayRPG + homeRAPG) / 2;

  // Pitcher adjustment on runs: better pitcher = fewer runs allowed
  if (homePitcher && homePitcher.era) {
    const leagueAvg = 4.25;
    expectedAwayRuns *= (homePitcher.era / leagueAvg);
  }
  if (awayPitcher && awayPitcher.era) {
    const leagueAvg = 4.25;
    expectedHomeRuns *= (awayPitcher.era / leagueAvg);
  }

  let expectedTotal = expectedHomeRuns + expectedAwayRuns;

  // Park factor
  if (venue) {
    expectedTotal = applyParkFactor(expectedTotal, venue);
  }

  // 7. Edge calculation (vs market)
  let homeEdge = null;
  let awayEdge = null;
  let totalEdge = null;
  if (vigFreeProb !== null) {
    homeEdge = parseFloat(((finalHomeProb - vigFreeProb) * 100).toFixed(1));
    awayEdge = parseFloat(((finalAwayProb - (1 - vigFreeProb)) * 100).toFixed(1));
  }
  if (consensus && consensus.totals) {
    totalEdge = parseFloat((expectedTotal - consensus.totals.consensusTotal).toFixed(1));
  }

  return {
    homeTeam: homeTeam.name,
    awayTeam: awayTeam.name,
    venue,

    // Model components
    pythagorean: {
      home: parseFloat((homePythag * 100).toFixed(1)),
      away: parseFloat((awayPythag * 100).toFixed(1)),
    },
    pitcherAdjusted: {
      homeProb: parseFloat((homePitcherAdj * 100).toFixed(1)),
      homePitcher: homePitcher ? `${homePitcher.name} (${homePitcher.era} ERA)` : 'TBD',
      awayPitcher: awayPitcher ? `${awayPitcher.name} (${awayPitcher.era} ERA)` : 'TBD',
    },
    market: vigFreeProb ? {
      homeProb: parseFloat((vigFreeProb * 100).toFixed(1)),
      disagreement: consensus?.h2h?.disagreementScore || 0,
      bookmakers: consensus?.h2h?.bookmakerCount || 0,
    } : null,

    // Final output
    prediction: {
      homeWinProb: parseFloat((finalHomeProb * 100).toFixed(1)),
      awayWinProb: parseFloat((finalAwayProb * 100).toFixed(1)),
      expectedTotal: parseFloat(expectedTotal.toFixed(1)),
      expectedHomeRuns: parseFloat(expectedHomeRuns.toFixed(1)),
      expectedAwayRuns: parseFloat(expectedAwayRuns.toFixed(1)),
      parkFactor: PARK_FACTORS[venue] || 1.0,
    },

    // Edge vs market
    edge: {
      home: homeEdge,
      away: awayEdge,
      total: totalEdge,
    },

    // Confidence (based on data quality)
    confidence: calculateConfidence({ homePitcher, awayPitcher, bookmakers, homeTeam, awayTeam }),
  };
}

function calculateConfidence({ homePitcher, awayPitcher, bookmakers, homeTeam, awayTeam }) {
  let score = 3; // Base

  // Pitcher data available
  if (homePitcher && homePitcher.era) score += 2;
  if (awayPitcher && awayPitcher.era) score += 2;

  // Market data available
  if (bookmakers && bookmakers.length >= 4) score += 2;
  else if (bookmakers && bookmakers.length >= 2) score += 1;

  // Sufficient games played (more data = more reliable pythag)
  const homeGames = (homeTeam.wins || 0) + (homeTeam.losses || 0);
  const awayGames = (awayTeam.wins || 0) + (awayTeam.losses || 0);
  if (homeGames >= 30 && awayGames >= 30) score += 1;

  return Math.min(10, score);
}

/**
 * Fetch pitcher stats from MLB Stats API.
 * @param {number} playerId - MLB player ID
 * @returns {Object|null} { name, era, fip, innings, whip }
 */
async function fetchPitcherStats(playerId) {
  try {
    const data = await mlb.getPlayerInfo(playerId);
    const person = data.people?.[0];
    if (!person) return null;

    const pitchingStats = person.stats?.find(s =>
      s.group?.displayName === 'pitching' && s.type?.displayName === 'season'
    );
    const splits = pitchingStats?.splits?.[0]?.stat;

    if (!splits) return null;

    return {
      name: person.fullName,
      era: parseFloat(splits.era) || null,
      whip: parseFloat(splits.whip) || null,
      innings: parseFloat(splits.inningsPitched) || 0,
      strikeouts: parseInt(splits.strikeOuts) || 0,
      walks: parseInt(splits.baseOnBalls) || 0,
      homeRuns: parseInt(splits.homeRuns) || 0,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Fetch team season stats (runs scored/allowed) from MLB Stats API standings.
 * Maps both short names ("Rays") and full names ("Tampa Bay Rays") for lookup flexibility.
 * @returns {Map<string, {runsScored, runsAllowed, wins, losses, gamesPlayed}>}
 */
async function fetchTeamRunDifferentials() {
  try {
    const [standingsData, teamsData] = await Promise.all([
      mlb.getStandings(),
      mlb.getTeams(),
    ]);

    // Build team ID -> full name lookup
    const teamNames = new Map();
    for (const team of teamsData.teams || []) {
      teamNames.set(team.id, team.name); // e.g., 139 -> "Tampa Bay Rays"
    }

    const teams = new Map();

    for (const record of standingsData.records || []) {
      for (const team of record.teamRecords || []) {
        const fullName = teamNames.get(team.team.id) || team.team.name;
        const entry = {
          runsScored: team.runsScored || 0,
          runsAllowed: team.runsAllowed || 0,
          wins: team.wins || 0,
          losses: team.losses || 0,
          gamesPlayed: team.gamesPlayed || 0,
        };
        teams.set(fullName, entry);
        teams.set(team.team.name, entry); // Also store short name
      }
    }
    return teams;
  } catch (e) {
    return new Map();
  }
}

module.exports = {
  predictMLB,
  pythagoreanWinPct,
  adjustForPitchers,
  applyParkFactor,
  fetchPitcherStats,
  fetchTeamRunDifferentials,
  PARK_FACTORS,
};
