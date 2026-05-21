/**
 * Ensemble Model — Combines all sub-models into final prediction.
 *
 * Architecture: Run 3-4 sub-models independently, blend outputs.
 * Research shows ensembles reduce variance significantly.
 *
 * Sub-models:
 * 1. Pythagorean + Park (season-level team quality)
 * 2. Elo (recency-weighted momentum)
 * 3. Pitcher matchup (FIP-based starter + bullpen state)
 * 4. Market consensus (vig-free implied probability)
 *
 * Dynamic blend: edge >5% = weight model 60/40 vs market.
 * Separate totals from sides (different features drive each).
 */

const { predictMLB, pythagoreanWinPct, PARK_FACTORS } = require('./enhancedModel');
const { predictFromElo } = require('./eloRatings');
const { getPitcherScore, getRunExpectation } = require('./fipCalculator');
const { calculateConsensus, americanToImpliedProb } = require('./marketConsensus');
const { getBullpenRunAdjustment } = require('./bullpenTracker');
const { calculateWeatherImpact } = require('./weatherImpact');
const { getPlatoonRunAdjustment } = require('./platoonSplits');
const { calculateBetSize } = require('./kellyCriterion');

/**
 * Full ensemble MLB prediction.
 *
 * @param {Object} params
 * @param {Object} params.homeTeam - { name, wins, losses, runsScored, runsAllowed, wOBA, leftPct }
 * @param {Object} params.awayTeam - { name, wins, losses, runsScored, runsAllowed, wOBA, leftPct }
 * @param {Object|null} params.homePitcher - { name, hand, seasonStats, recentStats, splits }
 * @param {Object|null} params.awayPitcher - { name, hand, seasonStats, recentStats, splits }
 * @param {number|null} params.homeElo - Team Elo rating
 * @param {number|null} params.awayElo - Team Elo rating
 * @param {Array|null} params.bookmakers - Odds API bookmaker array
 * @param {string|null} params.venue - Park name
 * @param {Object|null} params.weather - { temperature, windSpeed, windDirection }
 * @param {Object|null} params.homeBullpen - assessBullpenState() output
 * @param {Object|null} params.awayBullpen - assessBullpenState() output
 * @param {number} params.bankroll - For Kelly sizing (optional)
 * @returns {Object} Complete ensemble prediction
 */
function ensembleMLB(params) {
  const { homeTeam, awayTeam, homePitcher, awayPitcher, homeElo, awayElo,
    bookmakers, venue, weather, homeBullpen, awayBullpen, bankroll,
    homeRosterImpact, awayRosterImpact } = params;

  const subModels = {};

  // --- SUB-MODEL 1: Pythagorean ---
  const homeGames = (homeTeam.wins || 0) + (homeTeam.losses || 0);
  const awayGames = (awayTeam.wins || 0) + (awayTeam.losses || 0);
  const homePythag = pythagoreanWinPct(homeTeam.runsScored || 0, homeTeam.runsAllowed || 0);
  const awayPythag = pythagoreanWinPct(awayTeam.runsScored || 0, awayTeam.runsAllowed || 0);
  const pythagHomeProb = (homePythag / (homePythag + awayPythag)) + 0.04; // +HFA

  subModels.pythagorean = {
    homeProb: Math.min(0.85, Math.max(0.15, pythagHomeProb)),
    weight: (homeGames >= 30 && awayGames >= 30) ? 0.30 : 0.20,
    reliability: Math.min(1, (homeGames + awayGames) / 80),
  };

  // --- SUB-MODEL 2: Elo ---
  if (homeElo && awayElo) {
    const eloPred = predictFromElo(homeElo, awayElo, 'MLB');
    subModels.elo = {
      homeProb: eloPred.homeWinProb / 100,
      weight: 0.25,
      reliability: 0.9,
    };
  }

  // --- SUB-MODEL 3: Pitcher Matchup ---
  let pitcherHomeProb = null;
  if (homePitcher?.seasonStats && awayPitcher?.seasonStats) {
    const homeScore = getPitcherScore(homePitcher.seasonStats, homePitcher.recentStats);
    const awayScore = getPitcherScore(awayPitcher.seasonStats, awayPitcher.recentStats);

    if (homeScore && awayScore) {
      // Better pitcher (lower FIP) = higher win prob for their team
      const totalFIP = homeScore.blendedScore + awayScore.blendedScore;
      pitcherHomeProb = (awayScore.blendedScore / totalFIP); // Opponent's FIP helps you
      pitcherHomeProb = Math.min(0.75, Math.max(0.25, pitcherHomeProb + 0.02)); // Small HFA

      subModels.pitcher = {
        homeProb: pitcherHomeProb,
        weight: 0.25,
        reliability: Math.min(homeScore.reliability, awayScore.reliability),
        homeFIP: homeScore.blendedScore,
        awayFIP: awayScore.blendedScore,
      };
    }
  }

  // --- SUB-MODEL 4: Market Consensus ---
  let marketHomeProb = null;
  if (bookmakers && bookmakers.length >= 2) {
    const consensus = calculateConsensus(bookmakers, homeTeam.name, awayTeam.name);
    if (consensus.h2h) {
      marketHomeProb = consensus.h2h.consensusHomeProb / 100;
      subModels.market = {
        homeProb: marketHomeProb,
        weight: 0.30,
        reliability: 0.95,
        disagreement: consensus.h2h.disagreementScore,
      };
    }
  }

  // --- BLEND SUB-MODELS ---
  let totalWeight = 0;
  let weightedProb = 0;
  for (const [name, model] of Object.entries(subModels)) {
    const effectiveWeight = model.weight * model.reliability;
    weightedProb += model.homeProb * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  let finalHomeProb = totalWeight > 0 ? weightedProb / totalWeight : 0.5;
  finalHomeProb = Math.min(0.85, Math.max(0.15, finalHomeProb));

  // Dampen home-field bias in coin-flip territory when market data is missing
  // Without market consensus, the model tends to push ~50% games toward home
  const hasMarket = !!subModels.market;
  if (!hasMarket && Math.abs(finalHomeProb - 0.5) < 0.04) {
    finalHomeProb = 0.5 + (finalHomeProb - 0.5) * 0.5;
  }

  // --- ROSTER IMPACT ADJUSTMENT ---
  let rosterAdj = 0;
  if (homeRosterImpact && homeRosterImpact.adjustment !== 0) {
    finalHomeProb += homeRosterImpact.adjustment / 100;
    rosterAdj += homeRosterImpact.adjustment;
  }
  if (awayRosterImpact && awayRosterImpact.adjustment !== 0) {
    finalHomeProb -= awayRosterImpact.adjustment / 100;
    rosterAdj -= awayRosterImpact.adjustment;
  }
  finalHomeProb = Math.min(0.85, Math.max(0.15, finalHomeProb));

  // --- TOTALS MODEL (separate from sides) ---
  const homeRPG = homeGames > 0 ? (homeTeam.runsScored || 0) / homeGames : 4.5;
  const awayRPG = awayGames > 0 ? (awayTeam.runsScored || 0) / awayGames : 4.5;
  const homeRAPG = homeGames > 0 ? (homeTeam.runsAllowed || 0) / homeGames : 4.5;
  const awayRAPG = awayGames > 0 ? (awayTeam.runsAllowed || 0) / awayGames : 4.5;

  let expectedHomeRuns = (homeRPG + awayRAPG) / 2;
  let expectedAwayRuns = (awayRPG + homeRAPG) / 2;

  // Pitcher adjustment on totals
  if (subModels.pitcher) {
    const leagueAvg = 4.00;
    expectedAwayRuns *= (subModels.pitcher.homeFIP / leagueAvg);
    expectedHomeRuns *= (subModels.pitcher.awayFIP / leagueAvg);

    // Pitcher dominance discount: when both starters are elite/above-avg,
    // apply additional under-lean (model over-projects in ace duels)
    const bothElite = subModels.pitcher.homeFIP <= 3.50 && subModels.pitcher.awayFIP <= 3.50;
    if (bothElite) {
      const dominanceFactor = 0.92; // ~8% reduction for elite matchups
      expectedHomeRuns *= dominanceFactor;
      expectedAwayRuns *= dominanceFactor;
    }
  }

  // Bullpen adjustment
  let bullpenAdj = 0;
  if (homeBullpen) {
    const adj = getBullpenRunAdjustment(homeBullpen);
    expectedAwayRuns += adj.runsAdjustment; // Home bullpen gives up runs to away team
    bullpenAdj += adj.runsAdjustment;
  }
  if (awayBullpen) {
    const adj = getBullpenRunAdjustment(awayBullpen);
    expectedHomeRuns += adj.runsAdjustment;
    bullpenAdj += adj.runsAdjustment;
  }

  // Platoon adjustment
  let platoonAdj = 0;
  if (homePitcher?.hand && awayPitcher?.hand) {
    const platoon = getPlatoonRunAdjustment({
      homePitcherHand: homePitcher.hand,
      awayPitcherHand: awayPitcher.hand,
      homeTeamStats: homeTeam,
      awayTeamStats: awayTeam,
      homePitcherSplits: homePitcher.splits || null,
      awayPitcherSplits: awayPitcher.splits || null,
    });
    expectedHomeRuns += platoon.homeRunAdj;
    expectedAwayRuns += platoon.awayRunAdj;
    platoonAdj = platoon.totalAdj;
  }

  let expectedTotal = expectedHomeRuns + expectedAwayRuns;

  // Park factor
  const parkFactor = PARK_FACTORS[venue] || 1.0;
  expectedTotal *= parkFactor;
  expectedHomeRuns *= parkFactor;
  expectedAwayRuns *= parkFactor;

  // Weather adjustment
  let weatherAdj = 0;
  if (weather && venue) {
    const impact = calculateWeatherImpact(weather, venue);
    expectedTotal += impact.totalAdjustment;
    weatherAdj = impact.totalAdjustment;
  }

  // --- EDGES ---
  let mlEdge = null, totalEdge = null;
  if (marketHomeProb) {
    mlEdge = {
      home: parseFloat(((finalHomeProb - marketHomeProb) * 100).toFixed(1)),
      away: parseFloat((((1 - finalHomeProb) - (1 - marketHomeProb)) * 100).toFixed(1)),
    };
  }

  // --- KELLY SIZING (if bankroll provided) ---
  let kellySizing = null;
  if (bankroll && mlEdge) {
    // Determine which side has edge and size it
    const bestSide = mlEdge.home > mlEdge.away ? 'home' : 'away';
    const bestProb = bestSide === 'home' ? finalHomeProb : 1 - finalHomeProb;
    // Estimate odds from market prob
    const marketProb = bestSide === 'home' ? marketHomeProb : 1 - marketHomeProb;
    const estimatedOdds = marketProb >= 0.5
      ? -Math.round((marketProb / (1 - marketProb)) * 100)
      : Math.round(((1 - marketProb) / marketProb) * 100);

    kellySizing = calculateBetSize(bestProb, estimatedOdds, bankroll);
    kellySizing.side = bestSide;
    kellySizing.team = bestSide === 'home' ? homeTeam.name : awayTeam.name;
  }

  // --- CONFIDENCE ---
  const modelsUsed = Object.keys(subModels).length;
  const probEdge = Math.abs(finalHomeProb - 0.5);
  const isCoinFlip = probEdge < 0.03;

  // Check model agreement: do most sub-models agree on the same side?
  const modelSides = Object.values(subModels).map(m => m.homeProb > 0.5 ? 'home' : 'away');
  const homeVotes = modelSides.filter(s => s === 'home').length;
  const modelAgreement = Math.max(homeVotes, modelSides.length - homeVotes) / modelSides.length;

  let confidence;
  if (isCoinFlip) confidence = 'coin-flip';
  else if (modelsUsed >= 4 && probEdge >= 0.10 && modelAgreement >= 0.75) confidence = 'high';
  else if (modelsUsed >= 3 && probEdge >= 0.06 && modelAgreement >= 0.67) confidence = 'medium';
  else if (probEdge >= 0.03) confidence = 'low';
  else confidence = 'coin-flip';

  return {
    game: { home: homeTeam.name, away: awayTeam.name, venue },

    subModels: Object.fromEntries(
      Object.entries(subModels).map(([k, v]) => [k, { homeProb: parseFloat((v.homeProb * 100).toFixed(1)), weight: v.weight }])
    ),

    prediction: {
      homeWinProb: parseFloat((finalHomeProb * 100).toFixed(1)),
      awayWinProb: parseFloat(((1 - finalHomeProb) * 100).toFixed(1)),
      expectedTotal: parseFloat(expectedTotal.toFixed(1)),
      expectedHomeRuns: parseFloat(expectedHomeRuns.toFixed(1)),
      expectedAwayRuns: parseFloat(expectedAwayRuns.toFixed(1)),
    },

    adjustments: {
      parkFactor,
      weather: weatherAdj,
      bullpen: parseFloat(bullpenAdj.toFixed(2)),
      platoon: parseFloat(platoonAdj.toFixed(2)),
      roster: parseFloat(rosterAdj.toFixed(1)),
    },

    rosterImpact: {
      home: homeRosterImpact || null,
      away: awayRosterImpact || null,
    },

    edge: mlEdge,
    totalEdge: totalEdge,
    kelly: isCoinFlip ? null : kellySizing,
    confidence,
    modelsUsed,
    coinFlip: isCoinFlip,
  };
}

module.exports = { ensembleMLB };
