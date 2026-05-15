const express = require('express');
const router = express.Router();
const { createServices, SUPPORTED_SPORTS } = require('../services');

const services = createServices({
  oddsApiKey: process.env.ODDS_API_KEY,
  ballDontLieKey: process.env.BALL_DONT_LIE_KEY,
  cfbdKey: process.env.CFBD_API_KEY,
});

// GET /api/data/sources - List all data sources and their status
router.get('/sources', async (req, res) => {
  const sources = [
    {
      name: 'The Odds API',
      key: 'odds',
      sports: ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'MLB'],
      provides: ['live odds', 'historical odds', 'scores'],
      requiresKey: true,
      configured: !!process.env.ODDS_API_KEY,
      url: 'https://the-odds-api.com/',
    },
    {
      name: 'ESPN',
      key: 'espn',
      sports: ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'MLB'],
      provides: ['scores', 'schedules', 'standings', 'team stats', 'injuries', 'depth charts'],
      requiresKey: false,
      configured: true,
      url: 'https://espn.com',
    },
    {
      name: 'MLB Stats API',
      key: 'mlb',
      sports: ['MLB'],
      provides: ['schedules', 'box scores', 'player stats', 'probable pitchers', 'venue data'],
      requiresKey: false,
      configured: true,
      url: 'https://statsapi.mlb.com',
    },
    {
      name: 'Ball Don\'t Lie',
      key: 'basketball',
      sports: ['NBA'],
      provides: ['player stats', 'season averages', 'game results', 'team data'],
      requiresKey: true,
      configured: !!process.env.BALL_DONT_LIE_KEY,
      url: 'https://www.balldontlie.io/',
    },
    {
      name: 'College Football Data',
      key: 'cfb',
      sports: ['NCAAF'],
      provides: ['game lines', 'SP+ ratings', 'ELO ratings', 'recruiting', 'weather', 'advanced stats'],
      requiresKey: true,
      configured: !!process.env.CFBD_API_KEY,
      url: 'https://collegefootballdata.com/',
    },
    {
      name: 'Open-Meteo Weather',
      key: 'weather',
      sports: ['NFL', 'NCAAF', 'MLB'],
      provides: ['game-day weather', 'wind', 'precipitation', 'temperature'],
      requiresKey: false,
      configured: true,
      url: 'https://open-meteo.com/',
    },
  ];

  res.json({ sources, supportedSports: SUPPORTED_SPORTS });
});

// GET /api/data/espn/:sport/scoreboard - Live scores
router.get('/espn/:sport/scoreboard', async (req, res) => {
  try {
    const data = await services.espn.fetchScoreboard(req.params.sport.toUpperCase());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/espn/:sport/standings
router.get('/espn/:sport/standings', async (req, res) => {
  try {
    const data = await services.espn.fetchStandings(req.params.sport.toUpperCase());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/espn/:sport/teams
router.get('/espn/:sport/teams', async (req, res) => {
  try {
    const data = await services.espn.fetchTeams(req.params.sport.toUpperCase());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/mlb/schedule?date=2024-06-15
router.get('/mlb/schedule', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const data = await services.mlb.getSchedule(date);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/mlb/pitchers?date=2024-06-15
router.get('/mlb/pitchers', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const data = await services.mlb.getProbablePitchers(date);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/mlb/standings
router.get('/mlb/standings', async (req, res) => {
  try {
    const data = await services.mlb.getStandings();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/nfl/team/:teamId/stats
router.get('/nfl/team/:teamId/stats', async (req, res) => {
  try {
    const data = await services.nfl.getTeamStats(req.params.teamId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/nfl/team/:teamId/injuries
router.get('/nfl/team/:teamId/injuries', async (req, res) => {
  try {
    const data = await services.nfl.getInjuries(req.params.teamId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/weather?team=Kansas+City+Chiefs&date=2024-12-25T13:00:00Z
router.get('/weather', async (req, res) => {
  try {
    const { team, date } = req.query;
    const weather = await services.weather.getGameWeather(team, date);
    if (!weather) return res.json({ available: false });
    const sport = req.query.sport || 'NFL';
    const impact = services.weather.getWeatherImpact(weather, sport);
    res.json({ available: true, weather, impact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/cfb/ratings?year=2024&team=Alabama
router.get('/cfb/ratings', async (req, res) => {
  try {
    const { year, team } = req.query;
    const [sp, elo] = await Promise.allSettled([
      services.cfb.getSPRatings(year, team),
      services.cfb.getEloRatings(year, team),
    ]);
    res.json({
      sp: sp.status === 'fulfilled' ? sp.value : null,
      elo: elo.status === 'fulfilled' ? elo.value : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
