/**
 * NBA Rest & Travel Module
 *
 * Back-to-back = -3.0 pts. 3+ rest days = +1.5 pts. >1500mi travel = -1.0 pts.
 * Based on Haberstroh (ESPN, 2013), Pelton (ESPN, 2016), and Pinnacle research.
 * Single largest non-talent variable in NBA prediction.
 */

// NBA arena coordinates (lat, lng)
const ARENA_COORDS = {
  'Atlanta Hawks': { lat: 33.757, lng: -84.396, city: 'Atlanta', altitude: 320 },
  'Boston Celtics': { lat: 42.366, lng: -71.062, city: 'Boston', altitude: 20 },
  'Brooklyn Nets': { lat: 40.683, lng: -73.975, city: 'Brooklyn', altitude: 10 },
  'Charlotte Hornets': { lat: 35.225, lng: -80.839, city: 'Charlotte', altitude: 230 },
  'Chicago Bulls': { lat: 41.881, lng: -87.674, city: 'Chicago', altitude: 180 },
  'Cleveland Cavaliers': { lat: 41.497, lng: -81.688, city: 'Cleveland', altitude: 200 },
  'Dallas Mavericks': { lat: 32.790, lng: -96.810, city: 'Dallas', altitude: 130 },
  'Denver Nuggets': { lat: 39.749, lng: -105.008, city: 'Denver', altitude: 5280 },
  'Detroit Pistons': { lat: 42.341, lng: -83.055, city: 'Detroit', altitude: 185 },
  'Golden State Warriors': { lat: 37.768, lng: -122.388, city: 'San Francisco', altitude: 5 },
  'Houston Rockets': { lat: 29.751, lng: -95.362, city: 'Houston', altitude: 50 },
  'Indiana Pacers': { lat: 39.764, lng: -86.156, city: 'Indianapolis', altitude: 220 },
  'LA Clippers': { lat: 33.426, lng: -118.261, city: 'Inglewood', altitude: 30 },
  'Los Angeles Lakers': { lat: 34.043, lng: -118.267, city: 'Los Angeles', altitude: 90 },
  'Memphis Grizzlies': { lat: 35.138, lng: -90.051, city: 'Memphis', altitude: 100 },
  'Miami Heat': { lat: 25.781, lng: -80.187, city: 'Miami', altitude: 5 },
  'Milwaukee Bucks': { lat: 43.045, lng: -87.917, city: 'Milwaukee', altitude: 190 },
  'Minnesota Timberwolves': { lat: 44.980, lng: -93.276, city: 'Minneapolis', altitude: 260 },
  'New Orleans Pelicans': { lat: 29.949, lng: -90.082, city: 'New Orleans', altitude: 3 },
  'New York Knicks': { lat: 40.751, lng: -73.994, city: 'New York', altitude: 10 },
  'Oklahoma City Thunder': { lat: 35.463, lng: -97.515, city: 'Oklahoma City', altitude: 390 },
  'Orlando Magic': { lat: 28.539, lng: -81.384, city: 'Orlando', altitude: 30 },
  'Philadelphia 76ers': { lat: 39.901, lng: -75.172, city: 'Philadelphia', altitude: 12 },
  'Phoenix Suns': { lat: 33.446, lng: -112.071, city: 'Phoenix', altitude: 340 },
  'Portland Trail Blazers': { lat: 45.532, lng: -122.667, city: 'Portland', altitude: 50 },
  'Sacramento Kings': { lat: 38.580, lng: -121.500, city: 'Sacramento', altitude: 30 },
  'San Antonio Spurs': { lat: 29.427, lng: -98.438, city: 'San Antonio', altitude: 200 },
  'Toronto Raptors': { lat: 43.643, lng: -79.379, city: 'Toronto', altitude: 77 },
  'Utah Jazz': { lat: 40.768, lng: -111.901, city: 'Salt Lake City', altitude: 4226 },
  'Washington Wizards': { lat: 38.898, lng: -77.021, city: 'Washington', altitude: 15 },
};

/**
 * Haversine distance between two lat/lng points in miles.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate time zone difference between two cities.
 */
function getTimezone(team) {
  const eastern = ['Atlanta Hawks', 'Boston Celtics', 'Brooklyn Nets', 'Charlotte Hornets',
    'Cleveland Cavaliers', 'Detroit Pistons', 'Indiana Pacers', 'Miami Heat',
    'New York Knicks', 'Orlando Magic', 'Philadelphia 76ers', 'Toronto Raptors', 'Washington Wizards'];
  const central = ['Chicago Bulls', 'Dallas Mavericks', 'Houston Rockets', 'Memphis Grizzlies',
    'Milwaukee Bucks', 'Minnesota Timberwolves', 'New Orleans Pelicans', 'Oklahoma City Thunder', 'San Antonio Spurs'];
  const mountain = ['Denver Nuggets', 'Phoenix Suns', 'Utah Jazz'];
  // Pacific: everyone else

  if (eastern.includes(team)) return -5;
  if (central.includes(team)) return -6;
  if (mountain.includes(team)) return -7;
  return -8; // Pacific
}

/**
 * Calculate rest and travel adjustments for a team.
 *
 * @param {Object} params
 * @param {string} params.team - Team display name
 * @param {number} params.daysRest - Days since last game (0 = back-to-back)
 * @param {string|null} params.lastGameLocation - Team name of venue for last game (null = home)
 * @param {string} params.currentOpponent - Current game venue team
 * @param {boolean} params.isHome - Whether team is playing at home tonight
 * @returns {Object} { pointAdjustment, factors, fatigueScore }
 */
function calculateRestTravelAdj(params) {
  const { team, daysRest, lastGameLocation, currentOpponent, isHome } = params;
  let pointAdj = 0;
  const factors = [];

  // Rest adjustment
  if (daysRest === 0) {
    pointAdj -= 3.0;
    factors.push('B2B (-3.0 pts)');
  } else if (daysRest === 1) {
    // Normal rest, no adjustment
  } else if (daysRest === 2) {
    pointAdj += 0.5;
    factors.push('Extra rest (+0.5 pts)');
  } else if (daysRest >= 3) {
    pointAdj += 1.5;
    factors.push(`${daysRest} days rest (+1.5 pts)`);
  }

  // Travel distance
  const teamCoords = ARENA_COORDS[team];
  const venueTeam = isHome ? team : currentOpponent;
  const venueCoords = ARENA_COORDS[venueTeam];
  let travelDistance = 0;

  if (lastGameLocation && teamCoords && venueCoords) {
    const lastVenueCoords = ARENA_COORDS[lastGameLocation];
    if (lastVenueCoords) {
      travelDistance = haversineDistance(
        lastVenueCoords.lat, lastVenueCoords.lng,
        venueCoords.lat, venueCoords.lng
      );
    }
  }

  if (travelDistance > 1500) {
    pointAdj -= 1.0;
    factors.push(`Long travel ${Math.round(travelDistance)}mi (-1.0 pts)`);
  } else if (travelDistance > 800) {
    pointAdj -= 0.5;
    factors.push(`Moderate travel ${Math.round(travelDistance)}mi (-0.5 pts)`);
  }

  // Time zone change
  if (lastGameLocation && team) {
    const lastTZ = getTimezone(lastGameLocation);
    const currentTZ = getTimezone(venueTeam);
    const tzDiff = Math.abs(lastTZ - currentTZ);
    if (tzDiff >= 2) {
      pointAdj -= 0.5;
      factors.push(`${tzDiff} timezone change (-0.5 pts)`);
    }
  }

  // Altitude adjustment (Denver/Utah)
  if (!isHome && venueCoords && venueCoords.altitude > 4000) {
    pointAdj -= 1.5;
    factors.push('High altitude venue (-1.5 pts)');
  }

  // Fatigue score (0-10, higher = more fatigued)
  let fatigueScore = 5;
  if (daysRest === 0) fatigueScore += 3;
  if (travelDistance > 1500) fatigueScore += 2;
  else if (travelDistance > 800) fatigueScore += 1;
  if (daysRest >= 3) fatigueScore -= 3;
  fatigueScore = Math.min(10, Math.max(0, fatigueScore));

  return {
    pointAdjustment: parseFloat(pointAdj.toFixed(1)),
    factors,
    fatigueScore,
    travelDistance: Math.round(travelDistance),
    daysRest,
    isBackToBack: daysRest === 0,
  };
}

/**
 * Detect back-to-back games from a schedule array.
 *
 * @param {Array} schedule - [{ date: 'YYYY-MM-DD', homeTeam, awayTeam }] sorted by date
 * @param {string} team - Team name to check
 * @param {string} gameDate - Date to check (YYYY-MM-DD)
 * @returns {{ daysRest, lastGameDate, lastGameLocation, lastGameHome }}
 */
function detectBackToBack(schedule, team, gameDate) {
  const targetDate = new Date(gameDate);

  // Find team's games before this date, sorted descending
  const teamGames = schedule
    .filter(g => (g.homeTeam === team || g.awayTeam === team) && new Date(g.date) < targetDate)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (teamGames.length === 0) {
    return { daysRest: 7, lastGameDate: null, lastGameLocation: null, lastGameHome: null };
  }

  const lastGame = teamGames[0];
  const lastDate = new Date(lastGame.date);
  const daysRest = Math.floor((targetDate - lastDate) / (1000 * 60 * 60 * 24)) - 1;
  const lastGameHome = lastGame.homeTeam === team;
  const lastGameLocation = lastGameHome ? team : lastGame.homeTeam;

  return {
    daysRest: Math.max(0, daysRest),
    lastGameDate: lastGame.date,
    lastGameLocation,
    lastGameHome,
  };
}

/**
 * Get combined rest/travel adjustment for both teams in a game.
 *
 * @param {Object} params
 * @param {string} params.homeTeam - Home team name
 * @param {string} params.awayTeam - Away team name
 * @param {number} params.homeRest - Home team days rest
 * @param {number} params.awayRest - Away team days rest
 * @param {string|null} params.awayLastLocation - Away team's last game location
 * @returns {{ netAdjustment, homeAdj, awayAdj, summary }}
 */
function getGameRestAdjustment({ homeTeam, awayTeam, homeRest, awayRest, awayLastLocation }) {
  const homeAdj = calculateRestTravelAdj({
    team: homeTeam,
    daysRest: homeRest,
    lastGameLocation: null, // Home team was at home or doesn't need travel calc
    currentOpponent: awayTeam,
    isHome: true,
  });

  const awayAdj = calculateRestTravelAdj({
    team: awayTeam,
    daysRest: awayRest,
    lastGameLocation: awayLastLocation,
    currentOpponent: homeTeam,
    isHome: false,
  });

  // Net adjustment favoring home team (positive = home benefits more)
  const netAdjustment = homeAdj.pointAdjustment - awayAdj.pointAdjustment;

  let summary;
  if (Math.abs(netAdjustment) < 0.5) summary = 'Even rest/travel';
  else if (netAdjustment > 0) summary = `Home advantage +${netAdjustment.toFixed(1)} pts (rest/travel)`;
  else summary = `Away advantage +${Math.abs(netAdjustment).toFixed(1)} pts (rest/travel)`;

  return {
    netAdjustment: parseFloat(netAdjustment.toFixed(1)),
    homeAdj,
    awayAdj,
    summary,
  };
}

module.exports = {
  calculateRestTravelAdj,
  detectBackToBack,
  getGameRestAdjustment,
  haversineDistance,
  ARENA_COORDS,
};
