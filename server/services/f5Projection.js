const { getPitcherScore } = require('./fipCalculator');
const { PARK_FACTORS } = require('./enhancedModel');

const AVG_STARTER_IP = 5.1;
const LEAGUE_AVG_RUNS_PER_9 = 4.30;

function projectF5Total(homePitcher, awayPitcher, venue, bookmakers) {
  let homePitcherFIP = LEAGUE_AVG_RUNS_PER_9;
  let awayPitcherFIP = LEAGUE_AVG_RUNS_PER_9;

  if (homePitcher?.seasonStats) {
    const score = getPitcherScore(homePitcher.seasonStats, homePitcher.recentStats);
    if (score) homePitcherFIP = score.blendedScore;
  }
  if (awayPitcher?.seasonStats) {
    const score = getPitcherScore(awayPitcher.seasonStats, awayPitcher.recentStats);
    if (score) awayPitcherFIP = score.blendedScore;
  }

  // Away runs = home pitcher's FIP applied over ~5 innings
  let awayF5Runs = (homePitcherFIP / 9) * AVG_STARTER_IP;
  // Home runs = away pitcher's FIP applied over ~5 innings
  let homeF5Runs = (awayPitcherFIP / 9) * AVG_STARTER_IP;

  // Park factor at 50% (partially baked into stats already)
  const parkFactor = PARK_FACTORS[venue] || 1.0;
  const parkAdj = 1 + (parkFactor - 1) * 0.5;
  homeF5Runs *= parkAdj;
  awayF5Runs *= parkAdj;

  let f5Total = homeF5Runs + awayF5Runs;

  // Market anchor: if full-game O/U available, use ratio estimate for F5
  // Historical: F5 scoring ≈ 54% of full game
  let marketF5Line = null;
  if (bookmakers && bookmakers.length > 0) {
    for (const bk of bookmakers) {
      const totals = bk.markets?.find(m => m.key === 'totals');
      if (totals) {
        const fullLine = totals.outcomes?.[0]?.point;
        if (fullLine) {
          marketF5Line = parseFloat((fullLine * 0.54).toFixed(1));
          // Blend 60% model, 40% market-derived F5
          f5Total = f5Total * 0.6 + marketF5Line * 0.4;
          homeF5Runs = homeF5Runs * 0.6 + (marketF5Line / 2) * 0.4;
          awayF5Runs = awayF5Runs * 0.6 + (marketF5Line / 2) * 0.4;
          break;
        }
      }
    }
  }

  return {
    f5Total: parseFloat(f5Total.toFixed(1)),
    homeF5Runs: parseFloat(homeF5Runs.toFixed(2)),
    awayF5Runs: parseFloat(awayF5Runs.toFixed(2)),
    marketF5Line,
    f5Edge: marketF5Line ? parseFloat((f5Total - marketF5Line).toFixed(1)) : null,
  };
}

// NBA equivalent: first half projection
function projectNBAFirstHalf(homeTeam, awayTeam, totalLine) {
  if (!totalLine) return null;

  // NBA 1H typically accounts for ~48-49% of total scoring
  const firstHalfRatio = 0.485;
  const marketFirstHalf = totalLine * firstHalfRatio;

  // Adjust for pace: faster teams score more in 1H (less garbage time)
  let adjustment = 0;
  if (homeTeam.pace && awayTeam.pace) {
    const avgPace = (homeTeam.pace + awayTeam.pace) / 2;
    const leagueAvgPace = 100;
    adjustment = (avgPace - leagueAvgPace) * 0.05;
  }

  const projFirstHalf = marketFirstHalf + adjustment;

  return {
    firstHalfTotal: parseFloat(projFirstHalf.toFixed(1)),
    marketEstimate: parseFloat(marketFirstHalf.toFixed(1)),
    edge: parseFloat(adjustment.toFixed(1)),
  };
}

module.exports = { projectF5Total, projectNBAFirstHalf };
