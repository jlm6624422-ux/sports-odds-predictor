const express = require('express');
const router = express.Router();
const { OddsApiService, getMockOdds, SPORT_KEYS } = require('../services/oddsApi');

// GET /api/odds/:sport - Fetch odds for a sport
router.get('/:sport', async (req, res) => {
  try {
    const { sport } = req.params;
    const { markets = 'h2h', regions = 'us' } = req.query;

    if (!SPORT_KEYS[sport.toUpperCase()]) {
      return res.status(400).json({ error: `Invalid sport: ${sport}. Valid: NFL, NBA, MLB, NHL` });
    }

    const apiKey = process.env.ODDS_API_KEY;

    // Use mock data if no API key
    if (!apiKey || apiKey === 'your_api_key_here') {
      const mockData = getMockOdds(sport.toUpperCase());
      return res.json({
        data: mockData,
        remaining_requests: 'N/A (mock)',
        source: 'mock',
      });
    }

    const service = new OddsApiService(apiKey);
    const data = await service.fetchOdds(sport.toUpperCase(), markets.split(','), regions);

    // Store games and odds in database
    for (const game of data) {
      const existingGame = req.db.prepare('SELECT id FROM games WHERE external_id = ?').get(game.id);

      let gameId;
      if (!existingGame) {
        const result = req.db.prepare(
          'INSERT INTO games (external_id, sport, home_team, away_team, commence_time) VALUES (?, ?, ?, ?, ?)'
        ).run(game.id, sport.toUpperCase(), game.home_team, game.away_team, game.commence_time);
        gameId = result.lastInsertRowid;
      } else {
        gameId = existingGame.id;
      }

      // Store odds from each bookmaker
      for (const bookmaker of game.bookmakers) {
        for (const market of bookmaker.markets) {
          const oddsData = { game_id: gameId, bookmaker: bookmaker.title, market: market.key };

          if (market.key === 'h2h') {
            const home = market.outcomes.find(o => o.name === game.home_team);
            const away = market.outcomes.find(o => o.name === game.away_team);
            oddsData.home_price = home?.price;
            oddsData.away_price = away?.price;
          } else if (market.key === 'spreads') {
            const home = market.outcomes.find(o => o.name === game.home_team);
            const away = market.outcomes.find(o => o.name === game.away_team);
            oddsData.spread_home = home?.point;
            oddsData.spread_away = away?.point;
          } else if (market.key === 'totals') {
            const over = market.outcomes.find(o => o.name === 'Over');
            const under = market.outcomes.find(o => o.name === 'Under');
            oddsData.total_over = over?.price;
            oddsData.total_under = under?.price;
            oddsData.total_line = over?.point;
          }

          req.db.prepare(
            `INSERT INTO odds (game_id, bookmaker, market, home_price, away_price, spread_home, spread_away, total_over, total_under, total_line)
             VALUES (@game_id, @bookmaker, @market, @home_price, @away_price, @spread_home, @spread_away, @total_over, @total_under, @total_line)`
          ).run(oddsData);
        }
      }
    }

    res.json({
      data,
      remaining_requests: service.getRemainingRequests(),
      source: 'live',
    });
  } catch (error) {
    console.error('Error fetching odds:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/odds - Get all supported sports
router.get('/', (req, res) => {
  res.json({
    sports: Object.keys(SPORT_KEYS).map(key => ({
      key,
      api_key: SPORT_KEYS[key],
      name: key,
    })),
  });
});

module.exports = router;
