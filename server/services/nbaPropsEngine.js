/**
 * NBA Props Engine — Player projections and prop bet evaluation
 * Extracted from run-nba-props.js for use in the cron pipeline.
 */

const PLAYOFF_PACE_ADJ = 0.96;
const STAR_USAGE_BOOST = 1.0;
const GAME1_CONSERVATIVE = 0.97;
const AVG_NBA_TOTAL = 225;
const PLAYOFF_MINUTES_BOOST = 1.0;
const PLAYOFF_AST_DISCOUNT = 0.90;

// Teams that run heavy iso in playoffs (assists will drop more)
const ISO_HEAVY_TEAMS = ['CLE', 'DAL', 'BOS', 'DEN', 'MIL'];

const PLAYER_DB = {
  // OKC Thunder (2026 playoff averages - calibrated to market lines)
  'Shai Gilgeous-Alexander': { team: 'OKC', pos: 'G', pts: 30.5, reb: 5.2, ast: 6.2, min: 37.0 },
  'Chet Holmgren': { team: 'OKC', pos: 'C', pts: 15.5, reb: 8.5, ast: 2.2, min: 32.0 },
  'Jalen Williams': { team: 'OKC', pos: 'F', pts: 14.5, reb: 4.8, ast: 3.5, min: 33.0 },
  'Lu Dort': { team: 'OKC', pos: 'G', pts: 9.0, reb: 3.5, ast: 1.2, min: 28.0 },
  'Isaiah Hartenstein': { team: 'OKC', pos: 'C', pts: 7.5, reb: 8.0, ast: 2.5, min: 26.0 },
  'Alex Caruso': { team: 'OKC', pos: 'G', pts: 7.0, reb: 3.5, ast: 3.0, min: 25.0 },
  'Jared McCain': { team: 'OKC', pos: 'G', pts: 15.5, reb: 3.0, ast: 2.5, min: 26.0 },

  // San Antonio Spurs (2026 playoff averages - calibrated to market lines)
  'Victor Wembanyama': { team: 'SA', pos: 'C', pts: 28.5, reb: 12.0, ast: 3.5, min: 36.0 },
  'Stephon Castle': { team: 'SA', pos: 'G', pts: 18.5, reb: 4.5, ast: 8.0, min: 34.0 },
  "De'Aaron Fox": { team: 'SA', pos: 'G', pts: 17.0, reb: 4.0, ast: 7.5, min: 33.0 },
  'Devin Vassell': { team: 'SA', pos: 'G', pts: 16.0, reb: 3.5, ast: 3.2, min: 30.0 },
  'Julian Champagnie': { team: 'SA', pos: 'F', pts: 12.5, reb: 5.5, ast: 1.5, min: 28.0 },
  'Harrison Barnes': { team: 'SA', pos: 'F', pts: 10.5, reb: 4.0, ast: 1.5, min: 24.0 },
  'Keldon Johnson': { team: 'SA', pos: 'F', pts: 9.0, reb: 3.5, ast: 1.5, min: 24.0 },
  'Dylan Harper': { team: 'SA', pos: 'G', pts: 8.0, reb: 3.5, ast: 2.5, min: 20.0 },

  // Minnesota Timberwolves
  'Anthony Edwards': { team: 'MIN', pos: 'G', pts: 27.5, reb: 5.8, ast: 5.2, min: 35.5 },
  'Julius Randle': { team: 'MIN', pos: 'F', pts: 20.2, reb: 8.5, ast: 4.1, min: 33.0 },
  'Rudy Gobert': { team: 'MIN', pos: 'C', pts: 11.8, reb: 11.2, ast: 1.5, min: 30.5 },
  'Jaden McDaniels': { team: 'MIN', pos: 'F', pts: 13.5, reb: 4.2, ast: 2.1, min: 32.0 },
  'Mike Conley': { team: 'MIN', pos: 'G', pts: 9.5, reb: 2.8, ast: 5.8, min: 25.5 },

  // Cleveland Cavaliers
  'Donovan Mitchell': { team: 'CLE', pos: 'G', pts: 26.8, reb: 4.5, ast: 5.5, min: 34.0 },
  'Evan Mobley': { team: 'CLE', pos: 'C', pts: 18.5, reb: 9.2, ast: 3.2, min: 33.5 },
  'James Harden': { team: 'CLE', pos: 'G', pts: 19.5, reb: 5.2, ast: 8.5, min: 33.0 },
  'Jarrett Allen': { team: 'CLE', pos: 'C', pts: 13.5, reb: 10.5, ast: 1.8, min: 30.0 },

  // Detroit Pistons
  'Cade Cunningham': { team: 'DET', pos: 'G', pts: 24.5, reb: 6.2, ast: 9.1, min: 35.5 },
  'Jaden Ivey': { team: 'DET', pos: 'G', pts: 18.5, reb: 4.0, ast: 4.5, min: 31.0 },
  'Ausar Thompson': { team: 'DET', pos: 'F', pts: 14.2, reb: 7.5, ast: 2.8, min: 32.5 },

  // Boston Celtics
  'Jayson Tatum': { team: 'BOS', pos: 'F', pts: 27.8, reb: 8.5, ast: 5.2, min: 35.5 },
  'Jaylen Brown': { team: 'BOS', pos: 'G', pts: 23.5, reb: 5.8, ast: 3.8, min: 34.0 },
  'Derrick White': { team: 'BOS', pos: 'G', pts: 15.5, reb: 4.2, ast: 4.5, min: 30.0 },
  'Payton Pritchard': { team: 'BOS', pos: 'G', pts: 14.5, reb: 3.2, ast: 3.8, min: 28.0 },

  // New York Knicks
  'Jalen Brunson': { team: 'NYK', pos: 'G', pts: 26.5, reb: 3.5, ast: 7.2, min: 35.0 },
  'Karl-Anthony Towns': { team: 'NYK', pos: 'C', pts: 22.5, reb: 10.8, ast: 3.2, min: 34.0 },
  'Mikal Bridges': { team: 'NYK', pos: 'F', pts: 17.5, reb: 4.2, ast: 3.5, min: 33.5 },
  'OG Anunoby': { team: 'NYK', pos: 'F', pts: 14.8, reb: 4.5, ast: 2.0, min: 30.0 },

  // Indiana Pacers
  'Tyrese Haliburton': { team: 'IND', pos: 'G', pts: 20.5, reb: 3.8, ast: 9.5, min: 34.0 },
  'Pascal Siakam': { team: 'IND', pos: 'F', pts: 21.2, reb: 7.5, ast: 3.8, min: 34.5 },
  'Myles Turner': { team: 'IND', pos: 'C', pts: 15.8, reb: 7.2, ast: 1.5, min: 30.0 },

  // Dallas Mavericks
  'Kyrie Irving': { team: 'DAL', pos: 'G', pts: 24.2, reb: 4.5, ast: 5.2, min: 34.5 },
  'Cooper Flagg': { team: 'DAL', pos: 'F', pts: 16.5, reb: 7.2, ast: 3.5, min: 32.0 },
  'Dereck Lively II': { team: 'DAL', pos: 'C', pts: 10.8, reb: 8.5, ast: 1.8, min: 28.0 },

  // Los Angeles Lakers
  'LeBron James': { team: 'LAL', pos: 'F', pts: 23.5, reb: 7.5, ast: 8.2, min: 33.0 },
  'Luka Doncic': { team: 'LAL', pos: 'G', pts: 28.5, reb: 8.2, ast: 8.8, min: 36.0 },
  'Deandre Ayton': { team: 'LAL', pos: 'C', pts: 16.5, reb: 10.2, ast: 2.0, min: 30.5 },
  'Rui Hachimura': { team: 'LAL', pos: 'F', pts: 13.8, reb: 5.5, ast: 1.5, min: 28.0 },

  // Golden State Warriors
  'Stephen Curry': { team: 'GSW', pos: 'G', pts: 26.5, reb: 4.8, ast: 6.2, min: 34.0 },
  'Kristaps Porzingis': { team: 'GSW', pos: 'C', pts: 19.5, reb: 7.2, ast: 2.0, min: 28.5 },
  'Jimmy Butler III': { team: 'GSW', pos: 'F', pts: 18.5, reb: 5.5, ast: 4.8, min: 32.0 },
  'Draymond Green': { team: 'GSW', pos: 'F', pts: 8.5, reb: 6.8, ast: 5.5, min: 28.0 },

  // Denver Nuggets
  'Nikola Jokic': { team: 'DEN', pos: 'C', pts: 29.5, reb: 13.2, ast: 10.5, min: 36.5 },
  'Jamal Murray': { team: 'DEN', pos: 'G', pts: 21.5, reb: 4.2, ast: 6.5, min: 33.5 },
  'Michael Porter Jr.': { team: 'DEN', pos: 'F', pts: 16.5, reb: 7.5, ast: 1.8, min: 30.0 },
  'Aaron Gordon': { team: 'DEN', pos: 'F', pts: 14.2, reb: 6.5, ast: 3.5, min: 31.0 },
};

function projectPlayer(name, projectedTotal, isPlayoffs = true, isGame1 = false, customDB = null, restContext = null) {
  const player = (customDB || PLAYER_DB)[name];
  if (!player) return null;

  const paceMultiplier = projectedTotal / AVG_NBA_TOTAL;
  const g1Adj = isGame1 ? GAME1_CONSERVATIVE : 1.0;

  // Back-to-back / rest day adjustments (research: B2B = -8%, 2+ rest = +3%)
  let restMultiplier = 1.0;
  if (restContext) {
    const isStar = player.pts >= 20 || player.min >= 32;
    if (restContext.isB2B) {
      restMultiplier = isStar ? 0.88 : 0.92; // Veterans/stars hit harder on B2B
    } else if (restContext.daysRest >= 2) {
      restMultiplier = 1.03;
    }
  }

  // Playoff assists discount: teams go iso-heavy in postseason
  const isIsoTeam = ISO_HEAVY_TEAMS.includes(player.team);
  const astAdj = isPlayoffs ? (isIsoTeam ? PLAYOFF_AST_DISCOUNT * 0.85 : PLAYOFF_AST_DISCOUNT) : 1.0;

  // Conservative projections with pace + rest adjustments
  const projPts = player.pts * paceMultiplier * PLAYOFF_PACE_ADJ * g1Adj * restMultiplier;
  const projReb = player.reb * paceMultiplier * PLAYOFF_PACE_ADJ * g1Adj * restMultiplier;
  const projAst = player.ast * paceMultiplier * PLAYOFF_PACE_ADJ * g1Adj * astAdj * restMultiplier;
  const pra = projPts + projReb + projAst;

  return { ...player, name, projPts, projReb, projAst, pra, restMultiplier };
}

function evaluateProp(playerProj, stat, line) {
  if (!playerProj) return null;

  let projected, seasonAvg;
  if (stat === 'PTS') { projected = playerProj.projPts; seasonAvg = playerProj.pts; }
  else if (stat === 'REB') { projected = playerProj.projReb; seasonAvg = playerProj.reb; }
  else if (stat === 'AST') { projected = playerProj.projAst; seasonAvg = playerProj.ast; }
  else if (stat === 'PRA') { projected = playerProj.pra; seasonAvg = playerProj.pts + playerProj.reb + playerProj.ast; }
  else return null;

  const edge = projected - line;
  const direction = edge > 0 ? 'OVER' : 'UNDER';
  const absEdge = Math.abs(edge);
  const conf = absEdge >= 3 ? 'HIGH' : absEdge >= 1.5 ? 'MED' : absEdge >= 0.5 ? 'LOW' : 'SKIP';

  return { name: playerProj.name, team: playerProj.team, stat, line, projected: parseFloat(projected.toFixed(1)), seasonAvg, edge: parseFloat(edge.toFixed(1)), direction, confidence: conf, absEdge: parseFloat(absEdge.toFixed(1)) };
}

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const PROP_MARKETS = ['player_points', 'player_rebounds', 'player_assists', 'player_points_rebounds_assists'];
const STAT_MAP = { 'player_points': 'PTS', 'player_rebounds': 'REB', 'player_assists': 'AST', 'player_points_rebounds_assists': 'PRA' };

async function fetchRealPropLines(eventId) {
  if (!ODDS_API_KEY) return [];
  try {
    const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${PROP_MARKETS.join(',')}&oddsFormat=american`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const lines = [];
    for (const bk of (data.bookmakers || [])) {
      for (const market of (bk.markets || [])) {
        const stat = STAT_MAP[market.key];
        if (!stat) continue;
        for (const outcome of (market.outcomes || [])) {
          if (outcome.name !== 'Over') continue;
          lines.push({
            player: outcome.description,
            stat,
            line: outcome.point,
            odds: outcome.price,
            book: bk.title,
          });
        }
      }
    }
    return lines;
  } catch (e) {
    return [];
  }
}

async function getOddsApiEvents() {
  if (!ODDS_API_KEY) return [];
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${ODDS_API_KEY}`);
    if (!res.ok) return [];
    return res.json();
  } catch (e) {
    return [];
  }
}

function consensusLine(allLines, playerName, stat) {
  const matching = allLines.filter(l => l.player === playerName && l.stat === stat);
  if (matching.length === 0) return null;
  const avg = matching.reduce((s, l) => s + l.line, 0) / matching.length;
  const bestOdds = Math.max(...matching.map(l => l.odds));
  return { line: parseFloat(avg.toFixed(1)), odds: bestOdds, books: matching.length };
}

async function generateNBAProps(espnEvents, calibratedDB = null) {
  const games = [];
  const props = [];
  const activePlayerDB = calibratedDB || PLAYER_DB;

  // Get Odds API event IDs for prop line fetching
  const oddsEvents = await getOddsApiEvents();

  for (const event of espnEvents) {
    const comp = event.competitions[0];
    const home = comp.competitors.find(c => c.homeAway === 'home');
    const away = comp.competitors.find(c => c.homeAway === 'away');
    const odds = (comp.odds || [])[0] || {};
    const series = comp.series?.summary || '';
    const isGame1 = series.toLowerCase().includes('start') || series.includes('0-0');
    const ou = odds.overUnder || 220;
    const projTotal = ou ? parseFloat(ou) - 2 : 218;

    const homeAbbrev = home.team.abbreviation;
    const awayAbbrev = away.team.abbreviation;

    const gameInfo = {
      home: home.team.displayName,
      away: away.team.displayName,
      homeAbbrev,
      awayAbbrev,
      homeRecord: (home.records || [{}])[0]?.summary,
      awayRecord: (away.records || [{}])[0]?.summary,
      spread: odds.pointSpread?.home?.close?.line || odds.spread || odds.details,
      homeML: odds.homeTeamOdds?.moneyLine || null,
      awayML: odds.awayTeamOdds?.moneyLine || null,
      ou,
      series,
      status: comp.status?.type?.shortDetail,
      homeHomeRecord: (home.records || [])[1]?.summary || null,
      awayRoadRecord: (away.records || [])[2]?.summary || null,
    };

    // Find matching Odds API event for real prop lines
    const oddsEvent = oddsEvents.find(e =>
      e.home_team === home.team.displayName && e.away_team === away.team.displayName
    );

    let realLines = [];
    if (oddsEvent) {
      realLines = await fetchRealPropLines(oddsEvent.id);
    }

    // Find players and generate projections
    const gamePlayers = Object.entries(activePlayerDB)
      .filter(([_, p]) => p.team === homeAbbrev || p.team === awayAbbrev)
      .map(([name]) => name);

    const projections = gamePlayers
      .map(name => projectPlayer(name, projTotal, true, isGame1, activePlayerDB))
      .filter(Boolean)
      .sort((a, b) => b.projPts - a.projPts);

    gameInfo.projections = projections.map(p => ({
      name: p.name, team: p.team, pos: p.pos,
      projPts: parseFloat(p.projPts.toFixed(1)),
      projReb: parseFloat(p.projReb.toFixed(1)),
      projAst: parseFloat(p.projAst.toFixed(1)),
      pra: parseFloat(p.pra.toFixed(1)),
    }));

    // Evaluate props against REAL market lines
    const evaluated = [];
    for (const p of projections) {
      const stats = [
        { stat: 'PTS', projected: p.projPts, seasonAvg: p.pts },
        { stat: 'REB', projected: p.projReb, seasonAvg: p.reb },
        { stat: 'AST', projected: p.projAst, seasonAvg: p.ast },
        { stat: 'PRA', projected: p.pra, seasonAvg: p.pts + p.reb + p.ast },
      ];

      for (const s of stats) {
        const market = consensusLine(realLines, p.name, s.stat);
        if (!market) continue;

        const edge = s.projected - market.line;
        const direction = edge > 0 ? 'OVER' : 'UNDER';
        const absEdge = Math.abs(edge);
        const conf = absEdge >= 4 ? 'HIGH' : absEdge >= 2.5 ? 'MED' : absEdge >= 1.5 ? 'LOW' : 'SKIP';
        if (conf === 'SKIP') continue;

        evaluated.push({
          name: p.name, team: p.team, stat: s.stat,
          line: market.line, projected: parseFloat(s.projected.toFixed(1)),
          seasonAvg: s.seasonAvg, edge: parseFloat(edge.toFixed(1)),
          direction, confidence: conf, absEdge: parseFloat(absEdge.toFixed(1)),
          odds: market.odds, books: market.books,
        });
      }
    }

    // If no real lines available, fall back to synthetic
    if (evaluated.length === 0) {
      for (const p of projections) {
        const isStar = p.pts >= 20;
        const propLines = [
          { stat: 'PTS', line: Math.round(p.pts * 2 - 1) / 2 - (isStar ? 1 : 0.5) },
          ...(p.reb >= 7 ? [{ stat: 'REB', line: Math.round(p.reb * 2 - 1) / 2 }] : []),
          ...(p.ast >= 5 ? [{ stat: 'AST', line: Math.round(p.ast * 2 - 1) / 2 }] : []),
          ...(isStar ? [{ stat: 'PRA', line: Math.round((p.pts + p.reb + p.ast) * 2 - 1) / 2 }] : []),
        ];
        for (const prop of propLines) {
          const result = evaluateProp(p, prop.stat, prop.line);
          if (result && result.confidence !== 'SKIP') evaluated.push(result);
        }
      }
    }

    evaluated.sort((a, b) => b.absEdge - a.absEdge);
    gameInfo.propPicks = evaluated.slice(0, 10);
    props.push(...evaluated.slice(0, 10).map(p => ({ ...p, game: `${gameInfo.away} @ ${gameInfo.home}` })));
    games.push(gameInfo);
  }

  return { games, props };
}

module.exports = { generateNBAProps, projectPlayer, evaluateProp, PLAYER_DB, fetchRealPropLines };
