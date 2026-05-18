/**
 * Elo Rating System
 *
 * Recency-weighted power ratings that capture momentum and schedule strength.
 * Based on FiveThirtyEight methodology with sport-specific adjustments.
 *
 * MLB: K=4, MOV adjustment, season-start mean reversion (1/3 toward 1500)
 * NBA: K=20, MOV adjustment, home court +100 Elo, rest-day adjustments
 */

const DEFAULT_ELO = 1500;

const SPORT_CONFIG = {
  MLB: {
    k: 4,
    homeAdvantage: 24, // ~54% implied
    seasonReversion: 0.33, // Regress 1/3 toward mean at season start
    movMultiplier: 0.8, // Margin of victory dampening
  },
  NBA: {
    k: 20,
    homeAdvantage: 100, // ~64% implied (pre-2020 was higher)
    seasonReversion: 0.25,
    movMultiplier: 0.6,
  },
};

/**
 * Convert Elo difference to win probability.
 * @param {number} eloDiff - Elo(team A) - Elo(team B)
 * @returns {number} Probability team A wins (0-1)
 */
function eloToWinProb(eloDiff) {
  return 1 / (1 + Math.pow(10, -eloDiff / 400));
}

/**
 * Convert win probability to Elo difference.
 * @param {number} prob - Win probability (0-1)
 * @returns {number} Elo difference needed
 */
function winProbToElo(prob) {
  if (prob <= 0 || prob >= 1) return 0;
  return -400 * Math.log10((1 / prob) - 1);
}

/**
 * Calculate margin-of-victory multiplier.
 * Logarithmic dampening prevents blowouts from over-adjusting.
 * @param {number} marginOfVictory - Absolute point/run differential
 * @param {number} eloDiff - Pre-game Elo difference (winner - loser)
 * @param {string} sport - 'MLB' or 'NBA'
 * @returns {number} Multiplier (typically 1.0 - 2.5)
 */
function movMultiplier(marginOfVictory, eloDiff, sport) {
  const config = SPORT_CONFIG[sport] || SPORT_CONFIG.MLB;
  const base = Math.log(Math.abs(marginOfVictory) + 1) * config.movMultiplier;
  // Autocorrelation adjustment: reduce multiplier when favorite wins big
  const autoCorr = eloDiff > 0 ? 2.2 / ((eloDiff * 0.001) + 2.2) : 1.0;
  return Math.max(1.0, base * autoCorr);
}

/**
 * Update Elo ratings after a game result.
 * @param {number} homeElo - Home team's current Elo
 * @param {number} awayElo - Away team's current Elo
 * @param {number} homeScore - Home team final score
 * @param {number} awayScore - Away team final score
 * @param {string} sport - 'MLB' or 'NBA'
 * @returns {{ homeElo, awayElo, homeExpected, awayExpected, shift }}
 */
function updateElo(homeElo, awayElo, homeScore, awayScore, sport = 'MLB') {
  const config = SPORT_CONFIG[sport] || SPORT_CONFIG.MLB;

  // Home team expected win probability (with home advantage)
  const eloDiff = homeElo - awayElo + config.homeAdvantage;
  const homeExpected = eloToWinProb(eloDiff);
  const awayExpected = 1 - homeExpected;

  // Actual result (1 = win, 0 = loss, 0.5 = tie/draw)
  let homeActual;
  if (homeScore > awayScore) homeActual = 1;
  else if (homeScore < awayScore) homeActual = 0;
  else homeActual = 0.5;

  // Margin of victory multiplier
  const mov = Math.abs(homeScore - awayScore);
  const winnerEloDiff = homeActual === 1 ? eloDiff : -eloDiff;
  const movMult = movMultiplier(mov, winnerEloDiff, sport);

  // Elo shift
  const shift = config.k * movMult * (homeActual - homeExpected);

  return {
    homeElo: Math.round(homeElo + shift),
    awayElo: Math.round(awayElo - shift),
    homeExpected: parseFloat(homeExpected.toFixed(4)),
    awayExpected: parseFloat(awayExpected.toFixed(4)),
    shift: parseFloat(shift.toFixed(1)),
  };
}

/**
 * Apply season-start mean reversion.
 * Call once at the beginning of each season.
 * @param {number} elo - Team's end-of-season Elo
 * @param {string} sport - 'MLB' or 'NBA'
 * @returns {number} Reverted Elo for new season start
 */
function seasonRevert(elo, sport = 'MLB') {
  const config = SPORT_CONFIG[sport] || SPORT_CONFIG.MLB;
  return Math.round(elo * (1 - config.seasonReversion) + DEFAULT_ELO * config.seasonReversion);
}

/**
 * Initialize Elo ratings for all teams from historical results.
 * Processes an array of game results chronologically.
 *
 * @param {Array} games - [{ homeTeam, awayTeam, homeScore, awayScore, date }]
 * @param {string} sport - 'MLB' or 'NBA'
 * @returns {Map<string, number>} Team name -> current Elo
 */
function buildEloFromHistory(games, sport = 'MLB') {
  const ratings = new Map();

  for (const game of games) {
    if (!ratings.has(game.homeTeam)) ratings.set(game.homeTeam, DEFAULT_ELO);
    if (!ratings.has(game.awayTeam)) ratings.set(game.awayTeam, DEFAULT_ELO);

    const result = updateElo(
      ratings.get(game.homeTeam),
      ratings.get(game.awayTeam),
      game.homeScore,
      game.awayScore,
      sport
    );

    ratings.set(game.homeTeam, result.homeElo);
    ratings.set(game.awayTeam, result.awayElo);
  }

  return ratings;
}

/**
 * Predict game outcome using Elo ratings.
 * @param {number} homeElo - Home team Elo
 * @param {number} awayElo - Away team Elo
 * @param {string} sport - 'MLB' or 'NBA'
 * @param {Object} adjustments - { homeRest, awayRest, neutral } optional
 * @returns {{ homeWinProb, awayWinProb, eloDiff, impliedSpread }}
 */
function predictFromElo(homeElo, awayElo, sport = 'MLB', adjustments = {}) {
  const config = SPORT_CONFIG[sport] || SPORT_CONFIG.MLB;
  let homeAdv = adjustments.neutral ? 0 : config.homeAdvantage;

  // NBA rest adjustments
  if (sport === 'NBA') {
    if (adjustments.homeRest === 0) homeAdv -= 60; // B2B home team
    if (adjustments.awayRest === 0) homeAdv += 60; // B2B away team
    if (adjustments.homeRest >= 3) homeAdv += 30;  // Well-rested home
    if (adjustments.awayRest >= 3) homeAdv -= 30;  // Well-rested away
  }

  const eloDiff = homeElo - awayElo + homeAdv;
  const homeWinProb = eloToWinProb(eloDiff);

  // Convert Elo diff to implied spread (NBA: ~25 Elo per point, MLB: ~10 Elo per run)
  const ptsPerElo = sport === 'NBA' ? 25 : 10;
  const impliedSpread = -(eloDiff / ptsPerElo);

  return {
    homeWinProb: parseFloat((homeWinProb * 100).toFixed(1)),
    awayWinProb: parseFloat(((1 - homeWinProb) * 100).toFixed(1)),
    eloDiff: Math.round(eloDiff),
    impliedSpread: parseFloat(impliedSpread.toFixed(1)),
  };
}

module.exports = {
  eloToWinProb,
  winProbToElo,
  updateElo,
  seasonRevert,
  buildEloFromHistory,
  predictFromElo,
  DEFAULT_ELO,
  SPORT_CONFIG,
};
