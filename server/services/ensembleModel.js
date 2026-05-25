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
  // 2026 league environment: ~4.3 R/G average. Raw RPG over-projects by ~10%.
  const LEAGUE_RUN_DEFLATOR = 0.88;
  const MAX_TEAM_RUNS = 6.5;

  const homeRPG = homeGames > 0 ? (homeTeam.runsScored || 0) / homeGames : 4.3;
  const awayRPG = awayGames > 0 ? (awayTeam.runsScored || 0) / awayGames : 4.3;
  const homeRAPG = homeGames > 0 ? (homeTeam.runsAllowed || 0) / homeGames : 4.3;
  const awayRAPG = awayGames > 0 ? (awayTeam.runsAllowed || 0) / awayGames : 4.3;

  let expectedHomeRuns = Math.min(MAX_TEAM_RUNS, ((homeRPG + awayRAPG) / 2) * LEAGUE_RUN_DEFLATOR);
  let expectedAwayRuns = Math.min(MAX_TEAM_RUNS, ((awayRPG + homeRAPG) / 2) * LEAGUE_RUN_DEFLATOR);

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

  // Park factor (apply at 50% since it's already partially in team stats)
  const parkFactor = PARK_FACTORS[venue] || 1.0;
  const parkAdj = 1 + (parkFactor - 1) * 0.5;
  expectedTotal *= parkAdj;
  expectedHomeRuns *= parkAdj;
  expectedAwayRuns *= parkAdj;

  // Weather adjustment (halved — was double-counting with park factors)
  let weatherAdj = 0;
  if (weather && venue) {
    const impact = calculateWeatherImpact(weather, venue);
    expectedTotal += impact.totalAdjustment * 0.5;
    weatherAdj = impact.totalAdjustment * 0.5;
  }

  // Market anchor: blend model total with market line (60% model, 40% market)
  // The market already prices in lineups, weather, and bullpen state
  if (bookmakers && bookmakers.length > 0) {
    let marketTotal = null;
    for (const bk of bookmakers) {
      const totals = bk.markets?.find(m => m.key === 'totals');
      if (totals) { marketTotal = totals.outcomes?.[0]?.point; break; }
    }
    if (marketTotal) {
      const rawModelTotal = expectedTotal;
      expectedTotal = rawModelTotal * 0.6 + marketTotal * 0.4;
      const ratio = expectedTotal / rawModelTotal;
      expectedHomeRuns *= ratio;
      expectedAwayRuns *= ratio;
    }
  }

  // --- MARKET-MODEL BLEND ---
  // The market is the strongest signal. Blend our model probability with market.
  // Research shows winning models use 60-70% market + 30-40% model.
  // We only bet when our model STILL shows edge after blending.
  let effectiveMarketProb = marketHomeProb;
  if (!effectiveMarketProb && bookmakers && bookmakers.length > 0) {
    for (const bk of bookmakers) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (h2h && h2h.outcomes) {
        const homeOdds = h2h.outcomes.find(o => o.name === homeTeam.name);
        if (homeOdds) {
          const price = homeOdds.price;
          effectiveMarketProb = price < 0
            ? Math.abs(price) / (Math.abs(price) + 100)
            : 100 / (price + 100);
          break;
        }
      }
    }
  }

  // Anchor final probability toward market (40% model, 60% market)
  // This prevents betting on phantom edges the market has already priced in
  if (effectiveMarketProb) {
    const rawModelProb = finalHomeProb;
    finalHomeProb = rawModelProb * 0.4 + effectiveMarketProb * 0.6;
    finalHomeProb = Math.min(0.85, Math.max(0.15, finalHomeProb));
  }

  let mlEdge = null, totalEdge = null;
  if (effectiveMarketProb) {
    mlEdge = {
      home: parseFloat(((finalHomeProb - effectiveMarketProb) * 100).toFixed(1)),
      away: parseFloat((((1 - finalHomeProb) - (1 - effectiveMarketProb)) * 100).toFixed(1)),
    };
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

  // --- KELLY SIZING (if bankroll provided) ---
  // Only size bets when model agreement >= 75% (eliminates conflicted signals)
  let kellySizing = null;
  if (bankroll && mlEdge && modelAgreement >= 0.75) {
    const bestSide = mlEdge.home > mlEdge.away ? 'home' : 'away';
    const bestProb = bestSide === 'home' ? finalHomeProb : 1 - finalHomeProb;
    const mktProb = bestSide === 'home' ? effectiveMarketProb : 1 - effectiveMarketProb;
    const estimatedOdds = mktProb >= 0.5
      ? -Math.round((mktProb / (1 - mktProb)) * 100)
      : Math.round(((1 - mktProb) / mktProb) * 100);

    kellySizing = calculateBetSize(bestProb, estimatedOdds, bankroll);
    kellySizing.side = bestSide;
    kellySizing.team = bestSide === 'home' ? homeTeam.name : awayTeam.name;
  } else if (bankroll && mlEdge) {
    // Models disagree — no bet
    const bestSide = mlEdge.home > mlEdge.away ? 'home' : 'away';
    kellySizing = {
      betSize: 0, kellyPct: 0, fractionalKellyPct: 0,
      edge: Math.max(mlEdge.home, mlEdge.away),
      impliedProb: 0, modelProb: 0,
      recommendation: 'NO BET',
      reason: `Model agreement ${(modelAgreement * 100).toFixed(0)}% below 75% threshold`,
      side: bestSide,
      team: bestSide === 'home' ? homeTeam.name : awayTeam.name,
    };
  }
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
