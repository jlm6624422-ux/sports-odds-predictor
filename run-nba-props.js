#!/usr/bin/env node
/**
 * NBA Player Props Projections
 *
 * Usage: node run-nba-props.js [date]
 *   date: YYYYMMDD format (defaults to today)
 *
 * Example: node run-nba-props.js 20260518
 */

const PLAYOFF_PACE_ADJ = 0.98;
const STAR_USAGE_BOOST = 1.05;
const GAME1_CONSERVATIVE = 0.97;
const AVG_NBA_TOTAL = 225;

// Known player season averages (update as season progresses)
const PLAYER_DB = {
  // OKC Thunder
  'Shai Gilgeous-Alexander': { team: 'OKC', pos: 'G', pts: 31.1, reb: 5.4, ast: 6.6, min: 35.2 },
  'Chet Holmgren': { team: 'OKC', pos: 'C', pts: 17.8, reb: 8.9, ast: 2.5, min: 32.1 },
  'Jalen Williams': { team: 'OKC', pos: 'F', pts: 21.5, reb: 5.8, ast: 5.2, min: 33.8 },
  'Lu Dort': { team: 'OKC', pos: 'G', pts: 10.2, reb: 3.8, ast: 1.5, min: 28.5 },
  'Isaiah Hartenstein': { team: 'OKC', pos: 'C', pts: 11.5, reb: 9.2, ast: 3.1, min: 28.0 },
  'Alex Caruso': { team: 'OKC', pos: 'G', pts: 7.0, reb: 3.5, ast: 3.0, min: 25.0 },
  'Jared McCain': { team: 'OKC', pos: 'G', pts: 15.5, reb: 3.0, ast: 2.5, min: 26.0 },

  // San Antonio Spurs
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
};

async function fetchGameData(date) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`);
  const data = await res.json();
  return data.events || [];
}

function projectPlayer(name, projectedTotal, isPlayoffs = true, isGame1 = false) {
  const player = PLAYER_DB[name];
  if (!player) return null;

  const paceMultiplier = projectedTotal / AVG_NBA_TOTAL;
  const isStar = player.pts >= 20;
  const ptsAdj = isStar ? STAR_USAGE_BOOST : 1.0;
  const g1Adj = isGame1 ? GAME1_CONSERVATIVE : 1.0;

  const projPts = player.pts * paceMultiplier * ptsAdj * g1Adj;
  const projReb = player.reb * paceMultiplier * g1Adj;
  const projAst = player.ast * paceMultiplier * g1Adj;
  const pra = projPts + projReb + projAst;

  return { ...player, name, projPts, projReb, projAst, pra };
}

function evaluateProp(playerProj, stat, line) {
  if (!playerProj) return null;

  let projected;
  let seasonAvg;
  if (stat === 'PTS') { projected = playerProj.projPts; seasonAvg = playerProj.pts; }
  else if (stat === 'REB') { projected = playerProj.projReb; seasonAvg = playerProj.reb; }
  else if (stat === 'AST') { projected = playerProj.projAst; seasonAvg = playerProj.ast; }
  else if (stat === 'PRA') { projected = playerProj.pra; seasonAvg = playerProj.pts + playerProj.reb + playerProj.ast; }
  else return null;

  const edge = projected - line;
  const direction = edge > 0 ? 'OVER' : 'UNDER';
  const absEdge = Math.abs(edge);
  const conf = absEdge >= 3 ? 'HIGH' : absEdge >= 1.5 ? 'MED' : absEdge >= 0.5 ? 'LOW' : 'SKIP';

  return { name: playerProj.name, team: playerProj.team, stat, line, projected, seasonAvg, edge, direction, conf, absEdge };
}

async function run() {
  const dateArg = process.argv[2] || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const displayDate = dateArg.slice(0, 4) + '-' + dateArg.slice(4, 6) + '-' + dateArg.slice(6, 8);

  console.log('='.repeat(90));
  console.log(`NBA PLAYER PROPS PROJECTIONS — ${displayDate}`);
  console.log('='.repeat(90));
  console.log('');

  const events = await fetchGameData(dateArg);
  if (events.length === 0) {
    console.log('No NBA games scheduled for ' + displayDate);
    return;
  }

  for (const event of events) {
    const comp = event.competitions[0];
    const home = comp.competitors.find(c => c.homeAway === 'home');
    const away = comp.competitors.find(c => c.homeAway === 'away');
    const homeName = home.team.displayName;
    const awayName = away.team.displayName;
    const homeAbbrev = home.team.abbreviation;
    const awayAbbrev = away.team.abbreviation;
    const homeRecord = (home.records || [{}])[0]?.summary || '?';
    const awayRecord = (away.records || [{}])[0]?.summary || '?';
    const odds = (comp.odds || [])[0] || {};
    const spread = odds.details || 'N/A';
    const ou = odds.overUnder || 220;
    const series = comp.series?.summary || '';
    const status = comp.status?.type?.shortDetail || '';

    // Determine if Game 1
    const isGame1 = series.toLowerCase().includes('start') || series.includes('0-0');

    // Project game total
    const projTotal = ou ? parseFloat(ou) - 2 : 218; // Slight under lean for playoffs

    console.log(`${awayName} (${awayRecord}) @ ${homeName} (${homeRecord})`);
    console.log(`  ${status} | Line: ${spread} | O/U: ${ou} | ${series}`);
    console.log('');

    // Find players on these teams
    const gamePlayers = Object.entries(PLAYER_DB)
      .filter(([_, p]) => p.team === homeAbbrev || p.team === awayAbbrev)
      .map(([name, _]) => name);

    if (gamePlayers.length === 0) {
      console.log('  No player data available for these teams.');
      console.log('  Add players to PLAYER_DB in run-nba-props.js');
      console.log('');
      continue;
    }

    // Project all players
    const projections = gamePlayers
      .map(name => projectPlayer(name, projTotal, true, isGame1))
      .filter(Boolean)
      .sort((a, b) => b.projPts - a.projPts);

    // Print projections table
    console.log('  ' + 'Player'.padEnd(26) + 'Team'.padEnd(5) + 'Proj PTS'.padEnd(10) + 'Proj REB'.padEnd(10) + 'Proj AST'.padEnd(10) + 'PRA');
    console.log('  ' + '-'.repeat(75));
    for (const p of projections) {
      console.log('  ' +
        p.name.padEnd(26) +
        p.team.padEnd(5) +
        p.projPts.toFixed(1).padEnd(10) +
        p.projReb.toFixed(1).padEnd(10) +
        p.projAst.toFixed(1).padEnd(10) +
        p.pra.toFixed(1)
      );
    }

    // Evaluate common prop lines
    console.log('');
    console.log('  PROP PICKS:');
    console.log('');

    const propLines = [];
    for (const p of projections) {
      // Generate typical prop lines (0.5 below season avg for stars, at avg for role players)
      const isStar = p.pts >= 20;
      const ptsLine = Math.round(p.pts * 2 - 1) / 2 - (isStar ? 1 : 0.5);
      const rebLine = Math.round(p.reb * 2 - 1) / 2;
      const astLine = Math.round(p.ast * 2 - 1) / 2;
      const praLine = Math.round((p.pts + p.reb + p.ast) * 2 - 1) / 2;

      propLines.push({ name: p.name, stat: 'PTS', line: ptsLine });
      if (p.reb >= 7) propLines.push({ name: p.name, stat: 'REB', line: rebLine });
      if (p.ast >= 5) propLines.push({ name: p.name, stat: 'AST', line: astLine });
      if (isStar) propLines.push({ name: p.name, stat: 'PRA', line: praLine });
    }

    const evaluated = propLines
      .map(prop => {
        const playerProj = projections.find(p => p.name === prop.name);
        return evaluateProp(playerProj, prop.stat, prop.line);
      })
      .filter(e => e && e.conf !== 'SKIP')
      .sort((a, b) => b.absEdge - a.absEdge);

    if (evaluated.length === 0) {
      console.log('  No strong prop edges found.');
    } else {
      for (const e of evaluated.slice(0, 10)) {
        const stars = e.absEdge >= 4 ? '★★★★' : e.absEdge >= 2.5 ? '★★★' : e.absEdge >= 1.5 ? '★★' : '★';
        console.log(`  [${e.conf.padEnd(4)}] ${e.name.padEnd(24)} ${e.stat.padEnd(4)} ${e.direction} ${e.line}`);
        console.log(`         Avg: ${e.seasonAvg.toFixed(1)} → Proj: ${e.projected.toFixed(1)} | Edge: ${e.edge > 0 ? '+' : ''}${e.edge.toFixed(1)} ${stars}`);
      }
    }

    console.log('');
    console.log('-'.repeat(90));
    console.log('');
  }

  console.log('Adjustments: pace×' + (1 - (1 - PLAYOFF_PACE_ADJ)).toFixed(2) + ' | star usage×' + STAR_USAGE_BOOST + ' | G1 conservative×' + GAME1_CONSERVATIVE);
  console.log('');
  console.log('To update player averages, edit PLAYER_DB at top of this file.');
  console.log('To set custom prop lines, modify the propLines generation or pass them as args.');
}

run().catch(console.error);
