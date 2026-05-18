/**
 * Weather Impact on MLB Totals
 *
 * Wind blowing out >10mph = +1.0 runs. Temp above 80F = +0.5 runs.
 * Based on Kraft & Skeete (2007) and Alan Reifman's research.
 * Frequently mispriced, especially for afternoon games.
 */

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

// Park orientations: degrees from home plate to center field (0 = north)
const PARK_CF_BEARING = {
  'Coors Field': 20,
  'Wrigley Field': 0,
  'Fenway Park': 200,
  'Yankee Stadium': 70,
  'Citizens Bank Park': 90,
  'Great American Ball Park': 0,
  'Globe Life Field': null, // Retractable roof
  'Tropicana Field': null, // Dome
  'T-Mobile Park': null, // Retractable roof
  'loanDepot park': null, // Retractable roof
  'Chase Field': null, // Retractable roof
  'American Family Field': null, // Retractable roof
  'Minute Maid Park': null, // Retractable roof
  'Rogers Centre': null, // Retractable roof
  'Oracle Park': 345,
  'Petco Park': 340,
  'Dodger Stadium': 10,
  'Angel Stadium': 25,
  'Kauffman Stadium': 15,
  'Target Field': 345,
  'Progressive Field': 5,
  'Comerica Park': 345,
  'PNC Park': 350,
  'Nationals Park': 340,
  'Truist Park': 355,
  'Citi Field': 45,
  'Oakland Coliseum': 305,
  'Busch Stadium': 0,
  'Camden Yards': 5,
  'Guaranteed Rate Field': 340,
};

// Park coordinates for weather API
const PARK_LOCATIONS = {
  'Coors Field': { lat: 39.756, lng: -104.994 },
  'Wrigley Field': { lat: 41.948, lng: -87.656 },
  'Fenway Park': { lat: 42.346, lng: -71.098 },
  'Yankee Stadium': { lat: 40.829, lng: -73.926 },
  'Citizens Bank Park': { lat: 39.906, lng: -75.166 },
  'Great American Ball Park': { lat: 39.097, lng: -84.508 },
  'Globe Life Field': { lat: 32.747, lng: -97.084 },
  'Tropicana Field': { lat: 27.768, lng: -82.653 },
  'T-Mobile Park': { lat: 47.591, lng: -122.333 },
  'loanDepot park': { lat: 25.778, lng: -80.220 },
  'Chase Field': { lat: 33.445, lng: -112.067 },
  'American Family Field': { lat: 43.028, lng: -87.971 },
  'Minute Maid Park': { lat: 29.757, lng: -95.356 },
  'Rogers Centre': { lat: 43.641, lng: -79.389 },
  'Oracle Park': { lat: 37.778, lng: -122.389 },
  'Petco Park': { lat: 32.707, lng: -117.157 },
  'Dodger Stadium': { lat: 34.074, lng: -118.240 },
  'Angel Stadium': { lat: 33.800, lng: -117.883 },
  'Kauffman Stadium': { lat: 39.052, lng: -94.481 },
  'Target Field': { lat: 44.982, lng: -93.278 },
  'Progressive Field': { lat: 41.496, lng: -81.685 },
  'Comerica Park': { lat: 42.339, lng: -83.049 },
  'PNC Park': { lat: 40.447, lng: -80.006 },
  'Nationals Park': { lat: 38.873, lng: -77.008 },
  'Truist Park': { lat: 33.891, lng: -84.468 },
  'Citi Field': { lat: 40.757, lng: -73.846 },
  'Oakland Coliseum': { lat: 37.752, lng: -122.200 },
  'Busch Stadium': { lat: 38.623, lng: -90.193 },
  'Camden Yards': { lat: 39.284, lng: -76.622 },
  'Guaranteed Rate Field': { lat: 41.830, lng: -87.634 },
};

/**
 * Calculate wind component blowing toward center field.
 * Positive = blowing out (helps hitters). Negative = blowing in.
 *
 * @param {number} windSpeed - Wind speed in mph
 * @param {number} windDirection - Wind coming FROM this direction (degrees, 0=north)
 * @param {number} cfBearing - Degrees from home plate to center field
 * @returns {number} Wind component toward CF (positive = blowing out)
 */
function windTowardCF(windSpeed, windDirection, cfBearing) {
  // Wind "from" 180° with CF bearing 0° means wind blowing north (toward CF) = blowing OUT
  // Wind direction in meteorology = where wind comes FROM
  // So wind blowing toward CF = windDirection is opposite of cfBearing
  const windGoingTo = (windDirection + 180) % 360;
  const angleDiff = ((windGoingTo - cfBearing + 180) % 360) - 180;
  const radians = angleDiff * Math.PI / 180;
  return windSpeed * Math.cos(radians);
}

/**
 * Calculate total run adjustment from weather conditions.
 *
 * @param {Object} weather - { temperature, windSpeed, windDirection, humidity, precipitation }
 * @param {string} venueName - Park name
 * @returns {{ totalAdjustment, factors, isOutdoor }}
 */
function calculateWeatherImpact(weather, venueName) {
  const cfBearing = PARK_CF_BEARING[venueName];
  const factors = [];

  // Indoor/dome parks: no weather impact
  if (cfBearing === null) {
    return { totalAdjustment: 0, factors: ['Indoor/dome venue — no weather impact'], isOutdoor: false };
  }

  let totalAdj = 0;

  // Temperature effect: +0.012 runs per degree above 72F
  // Research shows ~1 extra run per 30-degree increase
  if (weather.temperature != null) {
    const tempAdj = (weather.temperature - 72) * 0.012;
    if (Math.abs(tempAdj) >= 0.1) {
      totalAdj += tempAdj;
      factors.push(`Temp ${weather.temperature}°F (${tempAdj > 0 ? '+' : ''}${tempAdj.toFixed(2)} runs)`);
    }
  }

  // Wind effect: blowing out >10mph = significant
  if (weather.windSpeed != null && weather.windDirection != null) {
    const cfWind = windTowardCF(weather.windSpeed, weather.windDirection, cfBearing);

    if (cfWind > 10) {
      const windAdj = (cfWind - 5) * 0.08; // ~+0.8 runs per 10mph blowing out
      totalAdj += windAdj;
      factors.push(`Wind OUT ${cfWind.toFixed(0)}mph (+${windAdj.toFixed(2)} runs)`);
    } else if (cfWind < -10) {
      const windAdj = (cfWind + 5) * 0.06; // ~-0.6 runs per 10mph blowing in
      totalAdj += windAdj;
      factors.push(`Wind IN ${Math.abs(cfWind).toFixed(0)}mph (${windAdj.toFixed(2)} runs)`);
    } else if (Math.abs(cfWind) > 5) {
      factors.push(`Wind ${cfWind > 0 ? 'out' : 'in'} ${Math.abs(cfWind).toFixed(0)}mph (minimal impact)`);
    }
  }

  // Precipitation risk
  if (weather.precipitation != null && weather.precipitation > 40) {
    factors.push(`Rain probability ${weather.precipitation}% — game delay risk`);
  }

  // Altitude boost (already in park factor, but compounds with temp)
  const location = PARK_LOCATIONS[venueName];
  if (location && venueName === 'Coors Field' && weather.temperature && weather.temperature > 80) {
    totalAdj += 0.3;
    factors.push('Coors + heat compound (+0.3 runs)');
  }

  return {
    totalAdjustment: parseFloat(totalAdj.toFixed(2)),
    factors: factors.length > 0 ? factors : ['Normal conditions'],
    isOutdoor: true,
  };
}

/**
 * Fetch weather forecast for a venue at game time.
 *
 * @param {string} venueName - Park name
 * @param {string} gameDateTime - ISO datetime or 'YYYY-MM-DDTHH:MM'
 * @returns {Object|null} { temperature, windSpeed, windDirection, humidity, precipitation }
 */
async function fetchGameWeather(venueName, gameDateTime) {
  const location = PARK_LOCATIONS[venueName];
  if (!location) return null;

  // Don't fetch for dome parks
  if (PARK_CF_BEARING[venueName] === null) return null;

  try {
    const date = gameDateTime.split('T')[0];
    const url = `${OPEN_METEO_BASE}?latitude=${location.lat}&longitude=${location.lng}` +
      `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m,precipitation_probability` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/New_York&start_date=${date}&end_date=${date}`;

    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    // Find the hour closest to game time
    const gameHour = parseInt(gameDateTime.split('T')[1]?.split(':')[0]) || 19; // Default 7pm
    const hourly = data.hourly;
    if (!hourly || !hourly.time) return null;

    const idx = hourly.time.findIndex(t => parseInt(t.split('T')[1].split(':')[0]) === gameHour);
    const i = idx >= 0 ? idx : 19; // Default to 7pm index

    return {
      temperature: hourly.temperature_2m?.[i] || null,
      windSpeed: hourly.wind_speed_10m?.[i] || null,
      windDirection: hourly.wind_direction_10m?.[i] || null,
      humidity: hourly.relative_humidity_2m?.[i] || null,
      precipitation: hourly.precipitation_probability?.[i] || null,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Get weather impact for a game (fetches weather and calculates adjustment).
 *
 * @param {string} venueName - Park name
 * @param {string} gameDateTime - ISO datetime
 * @returns {Object} Weather impact assessment
 */
async function getGameWeatherImpact(venueName, gameDateTime) {
  const weather = await fetchGameWeather(venueName, gameDateTime);
  if (!weather) {
    return { totalAdjustment: 0, factors: ['Weather data unavailable'], weather: null, isOutdoor: PARK_CF_BEARING[venueName] !== null };
  }

  const impact = calculateWeatherImpact(weather, venueName);
  return { ...impact, weather };
}

module.exports = {
  calculateWeatherImpact,
  fetchGameWeather,
  getGameWeatherImpact,
  windTowardCF,
  PARK_CF_BEARING,
  PARK_LOCATIONS,
};
