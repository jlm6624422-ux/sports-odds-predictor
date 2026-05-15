const { OddsApiService, getMockOdds, SPORT_KEYS, MARKETS } = require('./oddsApi');
const { EspnService, ESPN_SPORTS } = require('./espnApi');
const { BallDontLieService } = require('./ballDontLie');
const { MlbStatsService } = require('./mlbStats');
const { CollegeFootballDataService } = require('./sportsReference');
const { NflDataService } = require('./nflData');
const { WeatherService, STADIUMS } = require('./weatherApi');

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
};
