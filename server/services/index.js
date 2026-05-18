const { OddsApiService, getMockOdds, SPORT_KEYS, MARKETS } = require('./oddsApi');
const { EspnService, ESPN_SPORTS } = require('./espnApi');
const { BallDontLieService } = require('./ballDontLie');
const { MlbStatsService } = require('./mlbStats');
const { CollegeFootballDataService } = require('./sportsReference');
const { NflDataService } = require('./nflData');
const { WeatherService, STADIUMS } = require('./weatherApi');
const { calculateConsensus } = require('./marketConsensus');
const oddsCalculator = require('./oddsCalculator');
const sharpIndicator = require('./sharpIndicator');
const clvTracker = require('./clvTracker');
const enhancedModel = require('./enhancedModel');
const eloRatings = require('./eloRatings');
const fipCalculator = require('./fipCalculator');
const kellyCriterion = require('./kellyCriterion');
const nbaRestTravel = require('./nbaRestTravel');
const bullpenTracker = require('./bullpenTracker');
const eloBuilder = require('./eloBuilder');
const weatherImpact = require('./weatherImpact');
const platoonSplits = require('./platoonSplits');
const ensembleModel = require('./ensembleModel');
const nbaFourFactors = require('./nbaFourFactors');

// Supported sports (baseball, basketball, football only)
const SUPPORTED_SPORTS = ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'MLB'];

function createServices(config = {}) {
  return {
    odds: new OddsApiService(config.oddsApiKey),
    espn: new EspnService(),
    basketball: new BallDontLieService(config.ballDontLieKey),
    mlb: new MlbStatsService(),
    cfb: new CollegeFootballDataService(config.cfbdKey),
    nfl: new NflDataService(),
    weather: new WeatherService(),
  };
}

module.exports = {
  createServices,
  SUPPORTED_SPORTS,
  SPORT_KEYS,
  MARKETS,
  ESPN_SPORTS,
  STADIUMS,
  getMockOdds,
  calculateConsensus,
  oddsCalculator,
  sharpIndicator,
  clvTracker,
  enhancedModel,
  eloRatings,
  fipCalculator,
  kellyCriterion,
  nbaRestTravel,
  bullpenTracker,
  eloBuilder,
  weatherImpact,
  platoonSplits,
  ensembleModel,
  nbaFourFactors,
};
