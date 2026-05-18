/**
 * Elo Builder — Constructs Elo ratings from 2026 season game history.
 * Fetches all completed games and processes them chronologically.
 */

const { MlbStatsService } = require('./mlbStats');
const { buildEloFromHistory, predictFromElo, seasonRevert } = require('./eloRatings');

const mlb = new MlbStatsService();

/**
 * Fetch all completed MLB games for the current season and build Elo ratings.
 * @param {string} sport - 'MLB' (NBA support later)
 * @returns {Map<string, number>} Team name -> current Elo rating
 */
async function buildCurrentElo(sport = 'MLB') {
  if (sport === 'MLB') {
    return buildMLBElo();
  }
  throw new Error('Only MLB supported currently');
}

async function buildMLBElo() {
  // Fetch full season schedule (Opening Day ~March 27 through today)
  const startDate = '2026-03-27';
  const endDate = new Date().toISOString().split('T')[0];

  const scheduleData = await mlb.getScheduleRange(startDate, endDate);

  // Also get team name lookup
  const teamsData = await mlb.getTeams();
  const teamNames = new Map();
  for (const team of teamsData.teams || []) {
    teamNames.set(team.id, team.name);
  }

  // Extract completed games chronologically
  const games = [];
  for (const date of scheduleData.dates || []) {
    for (const game of date.games || []) {
      if (game.status?.statusCode !== 'F' && game.status?.codedGameState !== 'F') continue;

      const homeId = game.teams.home.team.id;
      const awayId = game.teams.away.team.id;
      const homeScore = game.teams.home.score;
      const awayScore = game.teams.away.score;

      if (homeScore == null || awayScore == null) continue;

      games.push({
        date: date.date,
        homeTeam: teamNames.get(homeId) || game.teams.home.team.name,
        awayTeam: teamNames.get(awayId) || game.teams.away.team.name,
        homeScore,
        awayScore,
      });
    }
  }

  // Sort by date (should already be but ensure)
  games.sort((a, b) => a.date.localeCompare(b.date));

  // Build Elo from game history
  const ratings = buildEloFromHistory(games, 'MLB');

  return { ratings, gamesProcessed: games.length };
}

/**
 * Fetch NBA season results and build Elo.
 * Uses ESPN scoreboard historical dates.
 */
async function buildNBAElo() {
  const startDate = new Date('2025-10-22'); // NBA season start
  const endDate = new Date();
  const games = [];

  // Fetch day by day (ESPN API)
  let current = new Date(startDate);
  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0].replace(/-/g, '');
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`);
      const data = await res.json();

      for (const event of data.events || []) {
        const comp = event.competitions[0];
        if (comp.status?.type?.state !== 'post') continue;

        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');
        if (!home || !away) continue;

        games.push({
          date: dateStr,
          homeTeam: home.team.displayName,
          awayTeam: away.team.displayName,
          homeScore: parseInt(home.score) || 0,
          awayScore: parseInt(away.score) || 0,
        });
      }
    } catch (e) {
      // Skip dates that fail
    }

    current.setDate(current.getDate() + 1);
  }

  const ratings = buildEloFromHistory(games, 'NBA');
  return { ratings, gamesProcessed: games.length };
}

module.exports = { buildCurrentElo, buildMLBElo, buildNBAElo };
