// Open-Meteo Weather API - completely free, no key needed
// Important for outdoor sports (NFL, MLB) - wind, temp, precipitation affect scoring
const METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

// Stadium coordinates for weather lookups
const STADIUMS = {
  // NFL outdoor stadiums (dome stadiums excluded - weather irrelevant)
  'Buffalo Bills': { lat: 42.7738, lon: -78.7870 },
  'Miami Dolphins': { lat: 25.958, lon: -80.2389 },
  'New England Patriots': { lat: 42.0909, lon: -71.2643 },
  'New York Jets': { lat: 40.8135, lon: -74.0745 },
  'New York Giants': { lat: 40.8135, lon: -74.0745 },
  'Pittsburgh Steelers': { lat: 40.4468, lon: -80.0158 },
  'Cleveland Browns': { lat: 41.5061, lon: -81.6995 },
  'Cincinnati Bengals': { lat: 39.0955, lon: -84.516 },
  'Baltimore Ravens': { lat: 39.278, lon: -76.6227 },
  'Tennessee Titans': { lat: 36.1664, lon: -86.7713 },
  'Jacksonville Jaguars': { lat: 30.3239, lon: -81.6373 },
  'Kansas City Chiefs': { lat: 39.0489, lon: -94.484 },
  'Denver Broncos': { lat: 39.7439, lon: -105.02 },
  'Las Vegas Raiders': { lat: 36.0909, lon: -115.1833 }, // dome but retractable
  'Los Angeles Chargers': { lat: 33.9534, lon: -118.339 },
  'Los Angeles Rams': { lat: 33.9534, lon: -118.339 },
  'San Francisco 49ers': { lat: 37.4033, lon: -121.9694 },
  'Seattle Seahawks': { lat: 47.5952, lon: -122.3316 },
  'Green Bay Packers': { lat: 44.5013, lon: -88.0622 },
  'Chicago Bears': { lat: 41.8623, lon: -87.6167 },
  'Philadelphia Eagles': { lat: 39.9008, lon: -75.1675 },
  'Washington Commanders': { lat: 38.9076, lon: -76.8645 },
  'Carolina Panthers': { lat: 35.2258, lon: -80.8528 },
  'Tampa Bay Buccaneers': { lat: 27.9759, lon: -82.5033 },
  'New Orleans Saints': { lat: 29.951, lon: -90.081 }, // dome
  // MLB stadiums (all outdoor except few domes)
  'NY Yankees': { lat: 40.8296, lon: -73.9262 },
  'NY Mets': { lat: 40.7571, lon: -73.8458 },
  'Boston Red Sox': { lat: 42.3467, lon: -71.0972 },
  'LA Dodgers': { lat: 34.0739, lon: -118.24 },
  'Chicago Cubs': { lat: 41.9484, lon: -87.6553 },
  'Chicago White Sox': { lat: 41.83, lon: -87.6339 },
  'Philadelphia Phillies': { lat: 39.9061, lon: -75.1665 },
  'Atlanta Braves': { lat: 33.8911, lon: -84.4684 },
  'Houston Astros': { lat: 29.7572, lon: -95.3555 }, // retractable
  'San Francisco Giants': { lat: 37.7786, lon: -122.3893 },
  'Texas Rangers': { lat: 32.7512, lon: -97.0832 }, // retractable
  'St. Louis Cardinals': { lat: 38.6226, lon: -90.1928 },
  'San Diego Padres': { lat: 32.7076, lon: -117.157 },
  'Cleveland Guardians': { lat: 41.496, lon: -81.6852 },
  'Detroit Tigers': { lat: 42.339, lon: -83.0485 },
  'Minnesota Twins': { lat: 44.9817, lon: -93.2776 },
  'Seattle Mariners': { lat: 47.5914, lon: -122.3325 }, // retractable
  'Colorado Rockies': { lat: 39.7559, lon: -104.9942 },
  'Pittsburgh Pirates': { lat: 40.4469, lon: -80.0057 },
  'Cincinnati Reds': { lat: 39.0974, lon: -84.5082 },
  'Baltimore Orioles': { lat: 39.2838, lon: -76.6216 },
  'Kansas City Royals': { lat: 39.0517, lon: -94.4803 },
  'Oakland Athletics': { lat: 37.7516, lon: -122.2005 },
  'Washington Nationals': { lat: 38.873, lon: -77.0074 },
  'Los Angeles Angels': { lat: 33.8003, lon: -117.8827 },
};

class WeatherService {
  async getGameWeather(homeTeam, gameDate) {
    const coords = STADIUMS[homeTeam];
    if (!coords) return null;

    const url = new URL(METEO_BASE);
    url.searchParams.set('latitude', coords.lat);
    url.searchParams.set('longitude', coords.lon);
    url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,windspeed_10m,windgusts_10m,weathercode');
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('windspeed_unit', 'mph');
    url.searchParams.set('timezone', 'America/New_York');

    if (gameDate) {
      const date = new Date(gameDate);
      const dateStr = date.toISOString().split('T')[0];
      url.searchParams.set('start_date', dateStr);
      url.searchParams.set('end_date', dateStr);
    }

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();

    return this.parseWeatherForGame(data, gameDate);
  }

  parseWeatherForGame(data, gameDate) {
    if (!data.hourly) return null;

    const gameHour = gameDate ? new Date(gameDate).getHours() : 13;
    const idx = gameHour;

    return {
      temperature: data.hourly.temperature_2m?.[idx],
      precipitation_probability: data.hourly.precipitation_probability?.[idx],
      wind_speed: data.hourly.windspeed_10m?.[idx],
      wind_gusts: data.hourly.windgusts_10m?.[idx],
      weather_code: data.hourly.weathercode?.[idx],
      conditions: this.weatherCodeToString(data.hourly.weathercode?.[idx]),
    };
  }

  weatherCodeToString(code) {
    const codes = {
      0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
      45: 'Foggy', 48: 'Depositing Fog', 51: 'Light Drizzle', 53: 'Drizzle',
      55: 'Heavy Drizzle', 61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
      66: 'Freezing Rain', 67: 'Heavy Freezing Rain', 71: 'Light Snow',
      73: 'Snow', 75: 'Heavy Snow', 77: 'Snow Grains', 80: 'Light Showers',
      81: 'Showers', 82: 'Heavy Showers', 85: 'Light Snow Showers',
      86: 'Snow Showers', 95: 'Thunderstorm', 96: 'Thunderstorm + Hail',
      99: 'Severe Thunderstorm',
    };
    return codes[code] || 'Unknown';
  }

  // Weather impact scoring for modeling
  getWeatherImpact(weather, sport) {
    if (!weather) return { score: 0, factors: [] };

    const factors = [];
    let score = 0;

    if (sport === 'NFL' || sport === 'NCAAF') {
      if (weather.wind_speed > 20) { score -= 3; factors.push('High wind - reduces passing'); }
      if (weather.wind_speed > 30) { score -= 5; factors.push('Extreme wind - heavy run game likely'); }
      if (weather.temperature < 20) { score -= 2; factors.push('Cold - affects grip/kicking'); }
      if (weather.precipitation_probability > 60) { score -= 2; factors.push('Rain likely - turnovers increase'); }
      if (weather.conditions?.includes('Snow')) { score -= 4; factors.push('Snow - low-scoring game likely'); }
    }

    if (sport === 'MLB') {
      if (weather.wind_speed > 15) { score += 2; factors.push('Wind - affects fly balls'); }
      if (weather.temperature > 85) { score += 1; factors.push('Hot - ball carries further'); }
      if (weather.temperature < 50) { score -= 1; factors.push('Cold - deadens ball'); }
      if (weather.precipitation_probability > 50) { factors.push('Rain risk - potential delay/PPD'); }
    }

    return { score, factors, raw: weather };
  }
}

module.exports = { WeatherService, STADIUMS };
