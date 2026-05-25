/**
 * Reverse Line Movement (RLM) Detector
 *
 * RLM = when line moves OPPOSITE to expected public money direction.
 * Heavy favorite gets longer odds = sharps on the underdog.
 * Historically highest ROI: RLM on underdogs +120 to +160.
 *
 * Uses historical odds comparison (opening vs current).
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const BASE_URL = 'https://api.the-odds-api.com/v4';

/**
 * Detect reverse line movement for a game.
 *
 * @param {string} homeTeam - Home team name
 * @param {number} openingHomePrice - Opening decimal odds for home team
 * @param {number} currentHomePrice - Current decimal odds for home team
 * @returns {Object} { hasRLM, side, strength, signal, details }
 */
function analyzeRLM(homeTeam, awayTeam, openingHomePrice, currentHomePrice, openingAwayPrice, currentAwayPrice) {
  if (!openingHomePrice || !currentHomePrice || !openingAwayPrice || !currentAwayPrice) {
    return { hasRLM: false, side: null, strength: 0, signal: 'NO DATA' };
  }

  const homeDrift = currentHomePrice - openingHomePrice;
  const awayDrift = currentAwayPrice - openingAwayPrice;

  // RLM on underdog: favorite was expected to attract public money, but line moved TOWARD the dog
  // If home is favorite (lower price) but home price went UP (drifted), sharps are on away
  const homeIsFavorite = openingHomePrice < openingAwayPrice;
  let hasRLM = false, side = null, strength = 0, signal = 'NEUTRAL';

  if (homeIsFavorite && homeDrift > 0.06) {
    // Home was favorite, price drifted up = sharps on AWAY (the dog)
    hasRLM = true;
    side = 'away';
    strength = parseFloat(homeDrift.toFixed(3));
    signal = 'SHARP ON DOG';
  } else if (!homeIsFavorite && awayDrift > 0.06) {
    // Away was favorite, price drifted up = sharps on HOME (the dog)
    hasRLM = true;
    side = 'home';
    strength = parseFloat(awayDrift.toFixed(3));
    signal = 'SHARP ON DOG';
  } else if (homeIsFavorite && homeDrift < -0.06) {
    // Home favorite getting shorter = sharps confirming favorite (steam)
    hasRLM = false;
    side = 'home';
    strength = parseFloat(Math.abs(homeDrift).toFixed(3));
    signal = 'STEAM FAVORITE';
  } else if (!homeIsFavorite && awayDrift < -0.06) {
    hasRLM = false;
    side = 'away';
    strength = parseFloat(Math.abs(awayDrift).toFixed(3));
    signal = 'STEAM FAVORITE';
  }

  // Extra signal: RLM on dogs in sweet spot (+120 to +160 American)
  const isSweetSpot = (side === 'away' && currentAwayPrice >= 2.20 && currentAwayPrice <= 2.60) ||
                      (side === 'home' && currentHomePrice >= 2.20 && currentHomePrice <= 2.60);

  return {
    hasRLM,
    side,
    sideTeam: side === 'home' ? homeTeam : side === 'away' ? awayTeam : null,
    strength,
    signal,
    sweetSpot: isSweetSpot,
    details: {
      homeOpen: openingHomePrice,
      homeCurrent: currentHomePrice,
      awayOpen: openingAwayPrice,
      awayCurrent: currentAwayPrice,
      homeDrift: parseFloat(homeDrift.toFixed(3)),
      awayDrift: parseFloat(awayDrift.toFixed(3)),
    },
  };
}

/**
 * Fetch opening and current odds for RLM detection.
 * Uses the-odds-api historical endpoint for opening, live for current.
 */
async function detectRLMForGame(homeTeam, awayTeam, date) {
  if (!ODDS_API_KEY) return { hasRLM: false, signal: 'NO API KEY' };

  try {
    // Get morning odds (opening)
    const morningUrl = `${BASE_URL}/historical/sports/baseball_mlb/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&date=${date}T14:00:00Z`;
    const morningRes = await fetch(morningUrl);
    if (!morningRes.ok) return { hasRLM: false, signal: 'API ERROR' };
    const morningData = await morningRes.json();

    const morningEvent = (morningData.data || []).find(e => e.home_team === homeTeam);
    if (!morningEvent) return { hasRLM: false, signal: 'GAME NOT FOUND' };

    // Get current/closing odds
    const now = new Date().toISOString();
    const currentUrl = `${BASE_URL}/historical/sports/baseball_mlb/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&date=${now}`;
    const currentRes = await fetch(currentUrl);
    if (!currentRes.ok) return { hasRLM: false, signal: 'API ERROR' };
    const currentData = await currentRes.json();

    const currentEvent = (currentData.data || []).find(e => e.home_team === homeTeam);
    if (!currentEvent) return { hasRLM: false, signal: 'GAME NOT FOUND' };

    // Average across books for consensus
    const avgPrice = (event, team) => {
      const prices = [];
      for (const bk of event.bookmakers) {
        const h2h = bk.markets.find(m => m.key === 'h2h');
        if (h2h) {
          const o = h2h.outcomes.find(oc => oc.name === team);
          if (o) prices.push(o.price);
        }
      }
      return prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : null;
    };

    const openHome = avgPrice(morningEvent, homeTeam);
    const openAway = avgPrice(morningEvent, awayTeam);
    const currHome = avgPrice(currentEvent, homeTeam);
    const currAway = avgPrice(currentEvent, awayTeam);

    return analyzeRLM(homeTeam, awayTeam, openHome, currHome, openAway, currAway);
  } catch (e) {
    return { hasRLM: false, signal: 'ERROR: ' + e.message };
  }
}

module.exports = { analyzeRLM, detectRLMForGame };
