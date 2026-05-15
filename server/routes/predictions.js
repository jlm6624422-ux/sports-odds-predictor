const express = require('express');
const router = express.Router();

const MODEL_SERVICE_URL = process.env.MODEL_SERVICE_URL || 'http://127.0.0.1:8001';

// GET /api/predictions - List all predictions
router.get('/', (req, res) => {
  try {
    const { sport, limit = 50 } = req.query;

    let query = `
      SELECT p.*, g.sport, g.home_team, g.away_team, g.commence_time, g.home_score, g.away_score
      FROM predictions p
      JOIN games g ON p.game_id = g.id
    `;
    const params = [];

    if (sport) {
      query += ' WHERE g.sport = ?';
      params.push(sport.toUpperCase());
    }

    query += ' ORDER BY p.created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const predictions = req.db.prepare(query).all(...params);
    res.json({ predictions });
  } catch (error) {
    console.error('Error fetching predictions:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/predictions/generate/:gameId - Generate prediction for a game
router.post('/generate/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;

    const game = req.db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Get latest odds for the game
    const odds = req.db.prepare(
      'SELECT * FROM odds WHERE game_id = ? ORDER BY fetched_at DESC'
    ).all(gameId);

    // Call model service
    try {
      const response = await fetch(`${MODEL_SERVICE_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_id: game.id,
          sport: game.sport,
          home_team: game.home_team,
          away_team: game.away_team,
          odds: odds.map(o => ({
            bookmaker: o.bookmaker,
            home_price: o.home_price,
            away_price: o.away_price,
            spread_home: o.spread_home,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Model service returned ${response.status}`);
      }

      const prediction = await response.json();

      // Store prediction
      const result = req.db.prepare(
        `INSERT INTO predictions (game_id, model_version, predicted_winner, home_win_prob, away_win_prob, confidence, spread_prediction, total_prediction, features_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        gameId,
        prediction.model_version || 'v1.0',
        prediction.predicted_winner,
        prediction.home_win_prob,
        prediction.away_win_prob,
        prediction.confidence,
        prediction.spread_prediction,
        prediction.total_prediction,
        JSON.stringify(prediction.features_used || [])
      );

      res.json({
        id: result.lastInsertRowid,
        ...prediction,
        game,
      });
    } catch (modelError) {
      // Fallback: generate basic prediction from odds consensus
      const avgHomeOdds = odds.length > 0
        ? odds.reduce((sum, o) => sum + (o.home_price || 0), 0) / odds.length
        : -110;

      const impliedProb = avgHomeOdds < 0
        ? Math.abs(avgHomeOdds) / (Math.abs(avgHomeOdds) + 100)
        : 100 / (avgHomeOdds + 100);

      const prediction = {
        predicted_winner: impliedProb > 0.5 ? game.home_team : game.away_team,
        home_win_prob: parseFloat(impliedProb.toFixed(4)),
        away_win_prob: parseFloat((1 - impliedProb).toFixed(4)),
        confidence: parseFloat(Math.abs(impliedProb - 0.5).toFixed(4)) * 2,
        model_version: 'odds-consensus-v1',
      };

      const result = req.db.prepare(
        `INSERT INTO predictions (game_id, model_version, predicted_winner, home_win_prob, away_win_prob, confidence)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(gameId, prediction.model_version, prediction.predicted_winner, prediction.home_win_prob, prediction.away_win_prob, prediction.confidence);

      res.json({
        id: result.lastInsertRowid,
        ...prediction,
        game,
        note: 'Model service unavailable - using odds consensus fallback',
      });
    }
  } catch (error) {
    console.error('Error generating prediction:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
