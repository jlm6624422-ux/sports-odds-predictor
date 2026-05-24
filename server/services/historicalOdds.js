/**
 * Historical Odds Service — the-odds-api.com paid tier
 *
 * Provides: CLV tracking, prop backtesting, line movement detection
 * Used across MLB and NBA for model calibration and sharp money signals.
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const BASE_URL = 'https://api.the-odds-api.com/v4';

const SPORTS = {
  MLB: 'baseball_mlb',
  NBA: 'basketball_nba',
  NFL: 'americanfootball_nfl',
  NHL: 'icehockey_nhl',
};

const PROP_MARKETS = ['player_points', 'player_rebounds', 'player_assists', 'player_points_rebounds_assists'];
const GAME_MARKETS = ['h2h', 'spreads', 'totals'];

async function fetchHistoricalOdds(sport, date, markets = GAME_MARKETS) {
  if (!ODDS_API_KEY) return null;
  const dateStr = date instanceof Date ? date.toISOString() : date;
  const url = `${BASE_URL}/historical/sports/${sport}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets.join(',')}&date=${dateStr}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    console.log(`[odds-hist] Fetch failed for ${sport} ${dateStr}:`, e.message);
    return null;
  }
}

async function fetchHistoricalEvents(sport, date) {
  if (!ODDS_API_KEY) return [];
  const dateStr = date instanceof Date ? date.toISOString() : date;
  const url = `${BASE_URL}/historical/sports/${sport}/events?apiKey=${ODDS_API_KEY}&date=${dateStr}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    return [];
  }
}

async function fetchHistoricalProps(sport, eventId, date) {
  if (!ODDS_API_KEY) return null;
  const dateStr = date instanceof Date ? date.toISOString() : date;
  const url = `${BASE_URL}/historical/sports/${sport}/events/${eventId}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${PROP_MARKETS.join(',')}&date=${dateStr}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    return null;
  }
}

/**
 * CLV (Closing Line Value) — Compare opening vs closing odds
 * Returns the CLV for a pick: positive = beat the market
 */
async function calculateCLV(sport, date, homeTeam, pickTeam, pickOddsAtTime) {
  const closingTime = new Date(date + 'T23:00:00Z');
  const closingData = await fetchHistoricalOdds(SPORTS[sport], closingTime.toISOString());
  if (!closingData?.data) return null;

  const event = closingData.data.find(e =>
    e.home_team === homeTeam || e.away_team === homeTeam
  );
  if (!event) return null;

  let closingOdds = null;
  for (const bk of event.bookmakers) {
    const h2h = bk.markets.find(m => m.key === 'h2h');
    if (h2h) {
      const outcome = h2h.outcomes.find(o => o.name === pickTeam);
      if (outcome) {
        closingOdds = outcome.price;
        break;
      }
    }
  }

  if (!closingOdds || !pickOddsAtTime) return null;

  const impliedOpen = 1 / pickOddsAtTime;
  const impliedClose = 1 / closingOdds;
  const clv = (impliedClose - impliedOpen) * 100;

  return {
    openOdds: pickOddsAtTime,
    closeOdds: closingOdds,
    clv: parseFloat(clv.toFixed(2)),
    beatMarket: clv > 0,
  };
}

/**
 * Line Movement Detection — Find sharp money moves
 * Compares odds at two time points (e.g., morning vs closing)
 */
async function detectLineMovement(sport, date, homeTeam) {
  const morning = new Date(date + 'T14:00:00Z');
  const closing = new Date(date + 'T23:00:00Z');

  const [morningData, closingData] = await Promise.all([
    fetchHistoricalOdds(SPORTS[sport], morning.toISOString()),
    fetchHistoricalOdds(SPORTS[sport], closing.toISOString()),
  ]);

  if (!morningData?.data || !closingData?.data) return null;

  const morningEvent = morningData.data.find(e => e.home_team === homeTeam);
  const closingEvent = closingData.data.find(e => e.home_team === homeTeam);
  if (!morningEvent || !closingEvent) return null;

  const getConsensus = (event, market, team) => {
    const lines = [];
    for (const bk of event.bookmakers) {
      const m = bk.markets.find(mk => mk.key === market);
      if (m) {
        const o = m.outcomes.find(oc => oc.name === team);
        if (o) lines.push({ price: o.price, point: o.point });
      }
    }
    if (lines.length === 0) return null;
    return {
      avgPrice: lines.reduce((s, l) => s + l.price, 0) / lines.length,
      avgPoint: lines[0].point !== undefined ? lines.reduce((s, l) => s + (l.point || 0), 0) / lines.length : null,
      books: lines.length,
    };
  };

  const result = { homeTeam, movements: [] };

  // Check ML movement
  const morningML = getConsensus(morningEvent, 'h2h', homeTeam);
  const closingML = getConsensus(closingEvent, 'h2h', homeTeam);
  if (morningML && closingML) {
    const mlMove = closingML.avgPrice - morningML.avgPrice;
    if (Math.abs(mlMove) >= 0.05) {
      result.movements.push({
        market: 'h2h',
        team: homeTeam,
        openPrice: parseFloat(morningML.avgPrice.toFixed(3)),
        closePrice: parseFloat(closingML.avgPrice.toFixed(3)),
        move: parseFloat(mlMove.toFixed(3)),
        direction: mlMove > 0 ? 'drifting' : 'steaming',
        sharp: Math.abs(mlMove) >= 0.15,
      });
    }
  }

  // Check spread movement
  const morningSpread = getConsensus(morningEvent, 'spreads', homeTeam);
  const closingSpread = getConsensus(closingEvent, 'spreads', homeTeam);
  if (morningSpread?.avgPoint != null && closingSpread?.avgPoint != null) {
    const spreadMove = closingSpread.avgPoint - morningSpread.avgPoint;
    if (Math.abs(spreadMove) >= 0.5) {
      result.movements.push({
        market: 'spreads',
        team: homeTeam,
        openLine: parseFloat(morningSpread.avgPoint.toFixed(1)),
        closeLine: parseFloat(closingSpread.avgPoint.toFixed(1)),
        move: parseFloat(spreadMove.toFixed(1)),
        direction: spreadMove < 0 ? 'sharps on home' : 'sharps on away',
        sharp: Math.abs(spreadMove) >= 1.5,
      });
    }
  }

  // Check total movement
  const morningTotal = getConsensus(morningEvent, 'totals', 'Over');
  const closingTotal = getConsensus(closingEvent, 'totals', 'Over');
  if (morningTotal?.avgPoint != null && closingTotal?.avgPoint != null) {
    const totalMove = closingTotal.avgPoint - morningTotal.avgPoint;
    if (Math.abs(totalMove) >= 0.5) {
      result.movements.push({
        market: 'totals',
        openLine: parseFloat(morningTotal.avgPoint.toFixed(1)),
        closeLine: parseFloat(closingTotal.avgPoint.toFixed(1)),
        move: parseFloat(totalMove.toFixed(1)),
        direction: totalMove > 0 ? 'sharps on over' : 'sharps on under',
        sharp: Math.abs(totalMove) >= 1.0,
      });
    }
  }

  return result;
}

/**
 * Prop Backtesting — Pull historical prop lines and compare to actual results
 * Used to calibrate PLAYER_DB averages against real market pricing
 */
async function backtestProps(date) {
  const events = await fetchHistoricalEvents(SPORTS.NBA, date + 'T18:00:00Z');
  const results = [];

  for (const event of events) {
    const propsData = await fetchHistoricalProps(SPORTS.NBA, event.id, date + 'T18:00:00Z');
    if (!propsData?.data) continue;

    const bookmakers = propsData.data.bookmakers || [];
    const playerLines = new Map();

    for (const bk of bookmakers) {
      for (const market of (bk.markets || [])) {
        const stat = market.key.replace('player_', '').toUpperCase()
          .replace('POINTS_REBOUNDS_ASSISTS', 'PRA')
          .replace('POINTS', 'PTS')
          .replace('REBOUNDS', 'REB')
          .replace('ASSISTS', 'AST');

        for (const outcome of (market.outcomes || [])) {
          if (outcome.name !== 'Over') continue;
          const key = `${outcome.description}|${stat}`;
          if (!playerLines.has(key)) playerLines.set(key, []);
          playerLines.get(key).push(outcome.point);
        }
      }
    }

    for (const [key, lines] of playerLines) {
      const [player, stat] = key.split('|');
      const consensusLine = lines.reduce((s, l) => s + l, 0) / lines.length;
      results.push({
        date,
        event: `${event.away_team} @ ${event.home_team}`,
        player,
        stat,
        consensusLine: parseFloat(consensusLine.toFixed(1)),
        books: lines.length,
      });
    }
  }

  return results;
}

/**
 * Get opening lines for today's MLB games — used for CLV at closing time
 */
async function captureOpeningLines(sport = 'MLB') {
  const now = new Date().toISOString();
  const data = await fetchHistoricalOdds(SPORTS[sport], now);
  if (!data?.data) return [];

  return data.data.map(event => {
    const consensus = {};
    for (const bk of event.bookmakers) {
      for (const market of bk.markets) {
        if (!consensus[market.key]) consensus[market.key] = {};
        for (const o of market.outcomes) {
          const key = o.name;
          if (!consensus[market.key][key]) consensus[market.key][key] = [];
          consensus[market.key][key].push({ price: o.price, point: o.point });
        }
      }
    }

    const avgLine = (arr) => {
      if (!arr || arr.length === 0) return null;
      return {
        price: parseFloat((arr.reduce((s, l) => s + l.price, 0) / arr.length).toFixed(3)),
        point: arr[0].point != null ? parseFloat((arr.reduce((s, l) => s + (l.point || 0), 0) / arr.length).toFixed(1)) : null,
        books: arr.length,
      };
    };

    return {
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      commence: event.commence_time,
      capturedAt: now,
      h2h: {
        home: avgLine(consensus.h2h?.[event.home_team]),
        away: avgLine(consensus.h2h?.[event.away_team]),
      },
      spreads: {
        home: avgLine(consensus.spreads?.[event.home_team]),
        away: avgLine(consensus.spreads?.[event.away_team]),
      },
      totals: {
        over: avgLine(consensus.totals?.['Over']),
        under: avgLine(consensus.totals?.['Under']),
      },
    };
  });
}

module.exports = {
  fetchHistoricalOdds,
  fetchHistoricalEvents,
  fetchHistoricalProps,
  calculateCLV,
  detectLineMovement,
  backtestProps,
  captureOpeningLines,
  SPORTS,
};
