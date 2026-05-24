/**
 * Prop Calibrator — Auto-calibrates player projections from real market data
 *
 * Pulls the last 7 days of NBA prop lines from the-odds-api historical endpoint,
 * averages consensus lines per player, and returns calibrated stats that override
 * the hardcoded PLAYER_DB values.
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const BASE_URL = 'https://api.the-odds-api.com/v4';

const STAT_MAP = {
  'player_points': 'pts',
  'player_rebounds': 'reb',
  'player_assists': 'ast',
  'player_points_rebounds_assists': 'pra',
};

async function fetchEventsForDate(date) {
  const url = `${BASE_URL}/historical/sports/basketball_nba/events?apiKey=${ODDS_API_KEY}&date=${date}T18:00:00Z`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    return [];
  }
}

async function fetchPropsForEvent(eventId, date) {
  const markets = 'player_points,player_rebounds,player_assists,player_points_rebounds_assists';
  const url = `${BASE_URL}/historical/sports/basketball_nba/events/${eventId}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets}&date=${date}T18:00:00Z`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.data || null;
  } catch (e) {
    return null;
  }
}

/**
 * Calibrate player stats from last N days of market data.
 * Returns a Map of playerName → { pts, reb, ast, pra, gamesFound }
 */
async function calibratePlayerDB(daysBack = 7) {
  if (!ODDS_API_KEY) {
    console.log('[calibrator] No ODDS_API_KEY — skipping calibration');
    return new Map();
  }

  const playerData = new Map();
  let apiCalls = 0;

  for (let i = 1; i <= daysBack; i++) {
    const date = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    const events = await fetchEventsForDate(date);
    apiCalls++;

    if (events.length === 0) continue;

    for (const event of events) {
      const propsData = await fetchPropsForEvent(event.id, date);
      apiCalls++;
      if (!propsData?.bookmakers) continue;

      for (const bk of propsData.bookmakers) {
        for (const market of (bk.markets || [])) {
          const statKey = STAT_MAP[market.key];
          if (!statKey) continue;

          for (const outcome of (market.outcomes || [])) {
            if (outcome.name !== 'Over') continue;
            const player = outcome.description;
            if (!player) continue;

            if (!playerData.has(player)) {
              playerData.set(player, { pts: [], reb: [], ast: [], pra: [], team: null });
            }
            const pd = playerData.get(player);
            pd[statKey].push(outcome.point);
          }
        }
      }

      // Rate limit — don't hammer the API
      if (apiCalls % 10 === 0) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // Average the lines to get calibrated values
  const calibrated = new Map();
  for (const [player, data] of playerData) {
    const avg = (arr) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    const pts = avg(data.pts);
    const reb = avg(data.reb);
    const ast = avg(data.ast);
    const pra = avg(data.pra);

    if (pts !== null || reb !== null || ast !== null) {
      calibrated.set(player, {
        pts: pts ? parseFloat(pts.toFixed(1)) : null,
        reb: reb ? parseFloat(reb.toFixed(1)) : null,
        ast: ast ? parseFloat(ast.toFixed(1)) : null,
        pra: pra ? parseFloat(pra.toFixed(1)) : null,
        gamesFound: data.pts.length || data.reb.length || data.ast.length,
      });
    }
  }

  console.log(`[calibrator] Calibrated ${calibrated.size} players from ${apiCalls} API calls (${daysBack} days)`);
  return calibrated;
}

/**
 * Merge calibrated data with existing PLAYER_DB.
 * Market lines become the new "season average" for projection.
 */
function mergeWithPlayerDB(playerDB, calibrated) {
  const merged = { ...playerDB };

  for (const [name, cal] of calibrated) {
    if (merged[name]) {
      if (cal.pts !== null) merged[name].pts = cal.pts;
      if (cal.reb !== null) merged[name].reb = cal.reb;
      if (cal.ast !== null) merged[name].ast = cal.ast;
    } else {
      // New player not in DB — add them if we have enough data
      if (cal.pts !== null && cal.gamesFound >= 2) {
        merged[name] = {
          team: 'UNK',
          pos: 'F',
          pts: cal.pts,
          reb: cal.reb || 4.0,
          ast: cal.ast || 2.0,
          min: 28.0,
        };
      }
    }
  }

  return merged;
}

module.exports = { calibratePlayerDB, mergeWithPlayerDB };
