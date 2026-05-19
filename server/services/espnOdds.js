/**
 * ESPN Odds Service
 *
 * Fetches odds data from ESPN's scoreboard API (DraftKings lines embedded).
 * Converts to the same format as The Odds API so the ensemble model works unchanged.
 * ESPN's site.api.espn.com resolves through corporate DNS (unlike odds-specific domains).
 */

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports';

const SPORT_PATHS = {
  MLB: 'baseball/mlb',
  NBA: 'basketball/nba',
  NFL: 'football/nfl',
  NHL: 'hockey/nhl',
  NCAAF: 'football/college-football',
  NCAAB: 'basketball/mens-college-basketball',
};

function parseAmericanOdds(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9.+-]/g, '');
  return parseInt(cleaned) || null;
}

function espnOddsToBookmakerFormat(espnOdds, homeTeamName, awayTeamName) {
  if (!espnOdds || espnOdds.length === 0) return null;

  const bookmakers = [];

  for (const o of espnOdds) {
    const providerName = o.provider?.name || 'ESPN BET';
    const closeMarkets = [];
    const openMarkets = [];

    // Moneyline (h2h)
    if (o.moneyline) {
      const homeML = parseAmericanOdds(o.moneyline.home?.close?.odds);
      const awayML = parseAmericanOdds(o.moneyline.away?.close?.odds);
      if (homeML && awayML) {
        closeMarkets.push({
          key: 'h2h',
          outcomes: [
            { name: homeTeamName, price: homeML },
            { name: awayTeamName, price: awayML },
          ],
        });
      }
      const homeMLOpen = parseAmericanOdds(o.moneyline.home?.open?.odds);
      const awayMLOpen = parseAmericanOdds(o.moneyline.away?.open?.odds);
      if (homeMLOpen && awayMLOpen) {
        openMarkets.push({
          key: 'h2h',
          outcomes: [
            { name: homeTeamName, price: homeMLOpen },
            { name: awayTeamName, price: awayMLOpen },
          ],
        });
      }
    }

    // Spreads (runline / point spread)
    if (o.pointSpread) {
      const homeLine = parseFloat(o.pointSpread.home?.close?.line);
      const awayLine = parseFloat(o.pointSpread.away?.close?.line);
      const homePrice = parseAmericanOdds(o.pointSpread.home?.close?.odds);
      const awayPrice = parseAmericanOdds(o.pointSpread.away?.close?.odds);
      if (!isNaN(homeLine) && !isNaN(awayLine)) {
        closeMarkets.push({
          key: 'spreads',
          outcomes: [
            { name: homeTeamName, price: homePrice || -110, point: homeLine },
            { name: awayTeamName, price: awayPrice || -110, point: awayLine },
          ],
        });
      }
      const homeLineOpen = parseFloat(o.pointSpread.home?.open?.line);
      const awayLineOpen = parseFloat(o.pointSpread.away?.open?.line);
      const homePriceOpen = parseAmericanOdds(o.pointSpread.home?.open?.odds);
      const awayPriceOpen = parseAmericanOdds(o.pointSpread.away?.open?.odds);
      if (!isNaN(homeLineOpen) && !isNaN(awayLineOpen)) {
        openMarkets.push({
          key: 'spreads',
          outcomes: [
            { name: homeTeamName, price: homePriceOpen || -110, point: homeLineOpen },
            { name: awayTeamName, price: awayPriceOpen || -110, point: awayLineOpen },
          ],
        });
      }
    }

    // Totals (over/under)
    if (o.total) {
      const overLine = o.total.over?.close?.line;
      const totalLine = parseFloat((overLine || '').replace(/[ou]/gi, ''));
      const overPrice = parseAmericanOdds(o.total.over?.close?.odds);
      const underPrice = parseAmericanOdds(o.total.under?.close?.odds);
      if (!isNaN(totalLine)) {
        closeMarkets.push({
          key: 'totals',
          outcomes: [
            { name: 'Over', price: overPrice || -110, point: totalLine },
            { name: 'Under', price: underPrice || -110, point: totalLine },
          ],
        });
      }
      const overLineOpen = o.total.over?.open?.line;
      const totalLineOpen = parseFloat((overLineOpen || '').replace(/[ou]/gi, ''));
      const overPriceOpen = parseAmericanOdds(o.total.over?.open?.odds);
      const underPriceOpen = parseAmericanOdds(o.total.under?.open?.odds);
      if (!isNaN(totalLineOpen)) {
        openMarkets.push({
          key: 'totals',
          outcomes: [
            { name: 'Over', price: overPriceOpen || -110, point: totalLineOpen },
            { name: 'Under', price: underPriceOpen || -110, point: totalLineOpen },
          ],
        });
      }
    }

    if (closeMarkets.length > 0) {
      bookmakers.push({ title: providerName, markets: closeMarkets });
    }
    if (openMarkets.length > 0) {
      bookmakers.push({ title: providerName + ' (Open)', markets: openMarkets });
    }
  }

  return bookmakers.length > 0 ? bookmakers : null;
}

async function fetchESPNOdds(sport = 'MLB', date) {
  const sportPath = SPORT_PATHS[sport.toUpperCase()];
  if (!sportPath) throw new Error(`Unsupported sport: ${sport}`);

  let url = `${ESPN_SCOREBOARD}/${sportPath}/scoreboard`;
  if (date) url += `?dates=${date.replace(/-/g, '')}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`ESPN returned ${res.status}`);

  const data = await res.json();
  const events = data.events || [];
  const games = [];

  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;

    const homeComp = comp.competitors?.find(c => c.homeAway === 'home');
    const awayComp = comp.competitors?.find(c => c.homeAway === 'away');
    if (!homeComp || !awayComp) continue;

    const homeTeam = homeComp.team.displayName;
    const awayTeam = awayComp.team.displayName;
    const bookmakers = espnOddsToBookmakerFormat(comp.odds, homeTeam, awayTeam);

    games.push({
      id: event.id,
      home_team: homeTeam,
      away_team: awayTeam,
      commence_time: comp.date,
      bookmakers: bookmakers || [],
    });
  }

  return games;
}

module.exports = { fetchESPNOdds, espnOddsToBookmakerFormat, parseAmericanOdds };
