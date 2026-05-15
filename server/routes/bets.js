const express = require('express');
const router = express.Router();

// GET /api/bets - List all bets with optional filters
router.get('/', (req, res) => {
  try {
    const { sport, result, limit = 100 } = req.query;

    let query = 'SELECT * FROM bets WHERE 1=1';
    const params = [];

    if (sport) {
      query += ' AND sport = ?';
      params.push(sport.toUpperCase());
    }

    if (result) {
      query += ' AND result = ?';
      params.push(result);
    }

    query += ' ORDER BY placed_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const bets = req.db.prepare(query).all(...params);
    res.json({ bets });
  } catch (error) {
    console.error('Error fetching bets:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/bets/stats - Get bet statistics
router.get('/stats', (req, res) => {
  try {
    const { sport } = req.query;

    let whereClause = '';
    const params = [];

    if (sport) {
      whereClause = ' WHERE sport = ?';
      params.push(sport.toUpperCase());
    }

    const totalBets = req.db.prepare(`SELECT COUNT(*) as count FROM bets${whereClause}`).get(...params);
    const totalStaked = req.db.prepare(`SELECT COALESCE(SUM(stake), 0) as total FROM bets${whereClause}`).get(...params);
    const totalPL = req.db.prepare(`SELECT COALESCE(SUM(profit_loss), 0) as total FROM bets WHERE result != 'pending'${sport ? ' AND sport = ?' : ''}`).get(...(sport ? [sport.toUpperCase()] : []));

    const wins = req.db.prepare(`SELECT COUNT(*) as count FROM bets WHERE result = 'won'${sport ? ' AND sport = ?' : ''}`).get(...(sport ? [sport.toUpperCase()] : []));
    const losses = req.db.prepare(`SELECT COUNT(*) as count FROM bets WHERE result = 'lost'${sport ? ' AND sport = ?' : ''}`).get(...(sport ? [sport.toUpperCase()] : []));
    const settled = wins.count + losses.count;

    const roi = totalStaked.total > 0 ? (totalPL.total / totalStaked.total) * 100 : 0;

    const bySport = req.db.prepare(
      `SELECT sport, COUNT(*) as count, SUM(stake) as staked, SUM(profit_loss) as pl
       FROM bets GROUP BY sport`
    ).all();

    res.json({
      total_bets: totalBets.count,
      total_staked: totalStaked.total,
      total_profit_loss: totalPL.total,
      roi: parseFloat(roi.toFixed(2)),
      win_rate: settled > 0 ? parseFloat(((wins.count / settled) * 100).toFixed(1)) : 0,
      wins: wins.count,
      losses: losses.count,
      pending: totalBets.count - settled,
      by_sport: bySport,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bets - Create a new bet
router.post('/', (req, res) => {
  try {
    const { game_id, sport, bet_type, selection, bookmaker, odds_american, stake, notes } = req.body;

    if (!sport || !bet_type || !selection || !bookmaker || odds_american === undefined || !stake) {
      return res.status(400).json({ error: 'Missing required fields: sport, bet_type, selection, bookmaker, odds_american, stake' });
    }

    // Convert American odds to decimal
    const oddsDecimal = odds_american > 0
      ? (odds_american / 100) + 1
      : (100 / Math.abs(odds_american)) + 1;

    const potentialPayout = stake * oddsDecimal;

    const result = req.db.prepare(
      `INSERT INTO bets (game_id, sport, bet_type, selection, bookmaker, odds_american, odds_decimal, stake, potential_payout, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(game_id || null, sport.toUpperCase(), bet_type, selection, bookmaker, odds_american, oddsDecimal, stake, potentialPayout, notes || null);

    const bet = req.db.prepare('SELECT * FROM bets WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ bet });
  } catch (error) {
    console.error('Error creating bet:', error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/bets/:id - Update bet result
router.patch('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { result: betResult } = req.body;

    if (!['won', 'lost', 'push', 'pending'].includes(betResult)) {
      return res.status(400).json({ error: 'Invalid result. Must be: won, lost, push, or pending' });
    }

    const bet = req.db.prepare('SELECT * FROM bets WHERE id = ?').get(id);
    if (!bet) {
      return res.status(404).json({ error: 'Bet not found' });
    }

    let profitLoss = 0;
    if (betResult === 'won') {
      profitLoss = bet.potential_payout - bet.stake;
    } else if (betResult === 'lost') {
      profitLoss = -bet.stake;
    }
    // push = 0

    req.db.prepare(
      `UPDATE bets SET result = ?, profit_loss = ?, settled_at = datetime('now') WHERE id = ?`
    ).run(betResult, profitLoss, id);

    const updated = req.db.prepare('SELECT * FROM bets WHERE id = ?').get(id);
    res.json({ bet: updated });
  } catch (error) {
    console.error('Error updating bet:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/bets/:id - Delete a bet
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const bet = req.db.prepare('SELECT * FROM bets WHERE id = ?').get(id);

    if (!bet) {
      return res.status(404).json({ error: 'Bet not found' });
    }

    req.db.prepare('DELETE FROM bets WHERE id = ?').run(id);
    res.json({ message: 'Bet deleted', id });
  } catch (error) {
    console.error('Error deleting bet:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
