const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Sport keys for The Odds API (baseball, basketball, football only)
const SPORT_KEYS = {
  NFL: 'americanfootball_nfl',
  NCAAF: 'americanfootball_ncaaf',
  NBA: 'basketball_nba',
  NCAAB: 'basketball_ncaab',
  MLB: 'baseball_mlb',
};

const MARKETS = ['h2h', 'spreads', 'totals'];

class OddsApiService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.remainingRequests = null;
  }

  async fetchOdds(sport, markets = ['h2h'], regions = 'us') {
    const sportKey = SPORT_KEYS[sport] || sport;
    const url = new URL(`${ODDS_API_BASE}/sports/${sportKey}/odds`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('regions', regions);
    url.searchParams.set('markets', markets.join(','));
    url.searchParams.set('oddsFormat', 'american');

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
    }

    // Track remaining requests
    this.remainingRequests = response.headers.get('x-requests-remaining');

    return response.json();
  }

  async fetchScores(sport, daysFrom = 3) {
    const sportKey = SPORT_KEYS[sport] || sport;
    const url = new URL(`${ODDS_API_BASE}/sports/${sportKey}/scores`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('daysFrom', daysFrom);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async fetchSports() {
    const url = new URL(`${ODDS_API_BASE}/sports`);
    url.searchParams.set('apiKey', this.apiKey);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  getRemainingRequests() {
    return this.remainingRequests;
  }
}

// Mock data for development when no API key is set
function getMockOdds(sport) {
  const teams = {
    NFL: [
      { home: 'Kansas City Chiefs', away: 'Buffalo Bills' },
      { home: 'Philadelphia Eagles', away: 'Dallas Cowboys' },
      { home: 'San Francisco 49ers', away: 'Detroit Lions' },
    ],
    NBA: [
      { home: 'Boston Celtics', away: 'Denver Nuggets' },
      { home: 'Milwaukee Bucks', away: 'Phoenix Suns' },
      { home: 'Golden State Warriors', away: 'LA Lakers' },
    ],
    MLB: [
      { home: 'NY Yankees', away: 'Houston Astros' },
      { home: 'LA Dodgers', away: 'Atlanta Braves' },
      { home: 'Philadelphia Phillies', away: 'Texas Rangers' },
    ],
    NCAAF: [
      { home: 'Ohio State Buckeyes', away: 'Michigan Wolverines' },
      { home: 'Alabama Crimson Tide', away: 'Georgia Bulldogs' },
      { home: 'Texas Longhorns', away: 'Oklahoma Sooners' },
    ],
    NCAAB: [
      { home: 'Duke Blue Devils', away: 'North Carolina Tar Heels' },
      { home: 'Kansas Jayhawks', away: 'Kentucky Wildcats' },
      { home: 'UConn Huskies', away: 'Purdue Boilermakers' },
    ],
  };

  const bookmakers = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'PointsBet'];
  const sportTeams = teams[sport] || teams.NFL;

  return sportTeams.map((matchup, idx) => {
    const commence = new Date();
    commence.setDate(commence.getDate() + idx + 1);
    commence.setHours(13 + idx * 3, 0, 0, 0);

    return {
      id: `mock_${sport}_${idx}`,
      sport_key: sport.toLowerCase(),
      sport_title: sport,
      commence_time: commence.toISOString(),
      home_team: matchup.home,
      away_team: matchup.away,
      bookmakers: bookmakers.map((name) => {
        const homeOdds = Math.floor(Math.random() * 300) - 150;
        const awayOdds = homeOdds > 0 ? -(homeOdds + 20) : -(homeOdds - 20);
        const spread = (Math.random() * 10 - 5).toFixed(1);
        const total = (40 + Math.random() * 20).toFixed(1);

        return {
          key: name.toLowerCase().replace(/\s/g, ''),
          title: name,
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: matchup.home, price: homeOdds },
                { name: matchup.away, price: awayOdds },
              ],
            },
            {
              key: 'spreads',
              outcomes: [
                { name: matchup.home, price: -110, point: parseFloat(spread) },
                { name: matchup.away, price: -110, point: -parseFloat(spread) },
              ],
            },
            {
              key: 'totals',
              outcomes: [
                { name: 'Over', price: -110, point: parseFloat(total) },
                { name: 'Under', price: -110, point: parseFloat(total) },
              ],
            },
          ],
        };
      }),
    };
  });
}

module.exports = { OddsApiService, getMockOdds, SPORT_KEYS, MARKETS };
