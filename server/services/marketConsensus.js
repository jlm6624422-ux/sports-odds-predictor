/**
 * Market Consensus Service
 * Adapted from BetTrack (WFord26/BetTrack)
 *
 * Detects bookmaker disagreement by calculating consensus lines across all
 * bookmakers for a given game/market. High disagreement = potential value.
 */

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function americanToImpliedProb(american) {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function impliedProbToAmerican(prob) {
  if (prob >= 0.5) return -Math.round((prob / (1 - prob)) * 100);
  return Math.round(((1 - prob) / prob) * 100);
}

function computeDisagreementScore(dev, referenceValue) {
  const cv = referenceValue !== 0 ? dev / Math.abs(referenceValue) : 0;
  return Math.min(100, Math.max(1, Math.round(cv * 1000)));
}

function findOutliers(entries, consensus, dev) {
  if (dev === 0) return [];
  return entries
    .map(e => ({
      bookmaker: e.bookmaker,
      line: parseFloat(e.value.toFixed(2)),
      deviation: parseFloat(((e.value - consensus) / dev).toFixed(2)),
    }))
    .filter(e => Math.abs(e.deviation) > 2);
}

/**
 * Calculate market consensus from an array of bookmaker odds for a game.
 *
 * @param {Array} bookmakers - Array of { title, markets: [{ key, outcomes }] }
 * @param {string} homeTeam - Home team name
 * @param {string} awayTeam - Away team name
 * @returns {Object} consensus data with disagreement scores and best value
 */
function calculateConsensus(bookmakers, homeTeam, awayTeam) {
  const result = { h2h: null, spreads: null, totals: null };

  // --- Moneyline (h2h) ---
  const h2hBooks = bookmakers
    .map(bk => {
      const market = bk.markets.find(m => m.key === 'h2h');
      if (!market) return null;
      const home = market.outcomes.find(o => o.name === homeTeam);
      const away = market.outcomes.find(o => o.name === awayTeam);
      if (!home || !away) return null;
      return { bookmaker: bk.title, homePrice: home.price, awayPrice: away.price };
    })
    .filter(Boolean);

  if (h2hBooks.length >= 2) {
    const homeProbs = h2hBooks.map(b => americanToImpliedProb(b.homePrice));
    const awayProbs = h2hBooks.map(b => americanToImpliedProb(b.awayPrice));

    const consensusHomeProb = median(homeProbs);
    const consensusAwayProb = median(awayProbs);
    const homeDev = stdDev(homeProbs);
    const awayDev = stdDev(awayProbs);

    const homeScore = computeDisagreementScore(homeDev, consensusHomeProb);
    const awayScore = computeDisagreementScore(awayDev, consensusAwayProb);
    const disagreementScore = Math.max(homeScore, awayScore);

    const homeOutliers = findOutliers(
      h2hBooks.map(b => ({ bookmaker: b.bookmaker, value: americanToImpliedProb(b.homePrice) })),
      consensusHomeProb, homeDev
    );

    // Best value: highest price on either side
    const bestHome = h2hBooks.sort((a, b) => b.homePrice - a.homePrice)[0];
    const bestAway = h2hBooks.sort((a, b) => b.awayPrice - a.awayPrice)[0];

    result.h2h = {
      consensusHomeProb: parseFloat((consensusHomeProb * 100).toFixed(1)),
      consensusAwayProb: parseFloat((consensusAwayProb * 100).toFixed(1)),
      consensusHomeLine: impliedProbToAmerican(consensusHomeProb),
      consensusAwayLine: impliedProbToAmerican(consensusAwayProb),
      disagreementScore,
      outliers: homeOutliers,
      bookmakerCount: h2hBooks.length,
      bestValue: {
        home: { bookmaker: bestHome.bookmaker, price: bestHome.homePrice },
        away: { bookmaker: bestAway.bookmaker, price: bestAway.awayPrice },
      },
    };
  }

  // --- Spreads ---
  const spreadBooks = bookmakers
    .map(bk => {
      const market = bk.markets.find(m => m.key === 'spreads');
      if (!market) return null;
      const home = market.outcomes.find(o => o.name === homeTeam);
      const away = market.outcomes.find(o => o.name === awayTeam);
      if (!home || !away) return null;
      return { bookmaker: bk.title, homeSpread: home.point, awaySpread: away.point, homePrice: home.price, awayPrice: away.price };
    })
    .filter(Boolean);

  if (spreadBooks.length >= 2) {
    const homeSpreads = spreadBooks.map(b => b.homeSpread);
    const consensusSpread = median(homeSpreads);
    const dev = stdDev(homeSpreads);
    const disagreementScore = computeDisagreementScore(dev, Math.abs(consensusSpread) || 1);

    const outliers = findOutliers(
      spreadBooks.map(b => ({ bookmaker: b.bookmaker, value: b.homeSpread })),
      consensusSpread, dev
    );

    result.spreads = {
      consensusSpread,
      standardDeviation: parseFloat(dev.toFixed(2)),
      disagreementScore,
      outliers,
      bookmakerCount: spreadBooks.length,
    };
  }

  // --- Totals ---
  const totalBooks = bookmakers
    .map(bk => {
      const market = bk.markets.find(m => m.key === 'totals');
      if (!market) return null;
      const over = market.outcomes.find(o => o.name === 'Over');
      const under = market.outcomes.find(o => o.name === 'Under');
      if (!over || !under) return null;
      return { bookmaker: bk.title, totalLine: over.point, overPrice: over.price, underPrice: under.price };
    })
    .filter(Boolean);

  if (totalBooks.length >= 2) {
    const totalLines = totalBooks.map(b => b.totalLine);
    const consensusTotal = median(totalLines);
    const dev = stdDev(totalLines);
    const disagreementScore = computeDisagreementScore(dev, consensusTotal || 1);

    const outliers = findOutliers(
      totalBooks.map(b => ({ bookmaker: b.bookmaker, value: b.totalLine })),
      consensusTotal, dev
    );

    result.totals = {
      consensusTotal,
      standardDeviation: parseFloat(dev.toFixed(2)),
      disagreementScore,
      outliers,
      bookmakerCount: totalBooks.length,
    };
  }

  return result;
}

module.exports = { calculateConsensus, americanToImpliedProb, impliedProbToAmerican, median, stdDev };
