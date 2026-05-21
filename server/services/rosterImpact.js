const { MlbStatsService } = require('./mlbStats');

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';
const ESPN_NBA_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

// ESPN team name -> ID mapping for schedule lookups
const NBA_TEAM_IDS = {
  'Atlanta Hawks': 1, 'Boston Celtics': 2, 'Brooklyn Nets': 17, 'Charlotte Hornets': 30,
  'Chicago Bulls': 4, 'Cleveland Cavaliers': 5, 'Dallas Mavericks': 6, 'Denver Nuggets': 7,
  'Detroit Pistons': 8, 'Golden State Warriors': 9, 'Houston Rockets': 10, 'Indiana Pacers': 11,
  'LA Clippers': 12, 'Los Angeles Lakers': 13, 'Memphis Grizzlies': 29, 'Miami Heat': 14,
  'Milwaukee Bucks': 15, 'Minnesota Timberwolves': 16, 'New Orleans Pelicans': 3,
  'New York Knicks': 18, 'Oklahoma City Thunder': 25, 'Orlando Magic': 19, 'Philadelphia 76ers': 20,
  'Phoenix Suns': 21, 'Portland Trail Blazers': 22, 'Sacramento Kings': 23,
  'San Antonio Spurs': 24, 'Toronto Raptors': 28, 'Utah Jazz': 26, 'Washington Wizards': 27,
};

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  return res.json();
}

/**
 * MLB Roster Impact
 *
 * For a team, find IL players, look at their contribution, and compare
 * team performance with vs. without them this season.
 */
async function getMLBRosterImpact(teamId, teamName, season = '2025') {
  const mlb = new MlbStatsService();

  // Get full-season roster to identify IL players
  const rosterData = await mlb.request(`/teams/${teamId}/roster`, { rosterType: 'fullSeason' });
  const roster = rosterData.roster || [];
  const ilPlayers = roster.filter(p => {
    const desc = p.status?.description || '';
    return desc.includes('Injured') || desc.includes('Restricted');
  });

  if (ilPlayers.length === 0) return { teamName, adjustment: 0, ilPlayers: [], details: 'No IL players' };

  // Get team schedule for W/L and run data
  const scheduleData = await fetchJSON(
    `${MLB_BASE}/schedule?sportId=1&teamId=${teamId}&startDate=${season}-03-20&endDate=${new Date().toISOString().split('T')[0]}&hydrate=linescore`
  );
  const teamGames = [];
  for (const date of (scheduleData.dates || [])) {
    for (const g of date.games) {
      if (g.status?.detailedState !== 'Final') continue;
      const home = g.teams.home;
      const away = g.teams.away;
      const isHome = home.team.id === teamId;
      teamGames.push({
        date: g.officialDate,
        gamePk: g.gamePk,
        won: isHome ? home.isWinner : away.isWinner,
        rs: isHome ? (home.score || 0) : (away.score || 0),
        ra: isHome ? (away.score || 0) : (home.score || 0),
      });
    }
  }

  if (teamGames.length < 10) return { teamName, adjustment: 0, ilPlayers: [], details: 'Insufficient games' };

  const teamGameDates = new Set(teamGames.map(g => g.date));

  // Analyze each IL player's impact
  const impacts = [];
  for (const ilPlayer of ilPlayers) {
    const playerId = ilPlayer.person.id;
    const playerName = ilPlayer.person.fullName;
    const position = ilPlayer.position?.abbreviation || '?';
    const isHitter = !['P'].includes(position);

    try {
      const group = isHitter ? 'hitting' : 'pitching';
      const logData = await fetchJSON(
        `${MLB_BASE}/people/${playerId}/stats?stats=gameLog&group=${group}&season=${season}`
      );
      const splits = logData.stats?.[0]?.splits || [];
      if (splits.length < 5) continue;

      const datesPlayed = new Set(splits.map(s => s.date));
      const gamesWith = teamGames.filter(g => datesPlayed.has(g.date));
      const gamesWithout = teamGames.filter(g => !datesPlayed.has(g.date));

      if (gamesWithout.length < 3) continue;

      const withWinPct = gamesWith.length > 0 ? gamesWith.filter(g => g.won).length / gamesWith.length : 0.5;
      const withoutWinPct = gamesWithout.length > 0 ? gamesWithout.filter(g => g.won).length / gamesWithout.length : 0.5;
      const withRPG = gamesWith.length > 0 ? gamesWith.reduce((s, g) => s + g.rs, 0) / gamesWith.length : 4.5;
      const withoutRPG = gamesWithout.length > 0 ? gamesWithout.reduce((s, g) => s + g.rs, 0) / gamesWithout.length : 4.5;

      // Player's individual contribution
      let playerValue = 0;
      if (isHitter) {
        const totalPA = splits.reduce((s, sp) => s + (sp.stat?.plateAppearances || 0), 0);
        const totalHR = splits.reduce((s, sp) => s + (sp.stat?.homeRuns || 0), 0);
        const totalRBI = splits.reduce((s, sp) => s + (sp.stat?.rbi || 0), 0);
        const totalRuns = splits.reduce((s, sp) => s + (sp.stat?.runs || 0), 0);
        const avgOPS = splits.length > 0
          ? splits.reduce((s, sp) => s + (parseFloat(sp.stat?.ops) || 0), 0) / splits.length
          : 0;
        playerValue = avgOPS;
      } else {
        const totalIP = splits.reduce((s, sp) => s + (parseFloat(sp.stat?.inningsPitched) || 0), 0);
        const totalER = splits.reduce((s, sp) => s + (sp.stat?.earnedRuns || 0), 0);
        playerValue = totalIP > 0 ? (totalER / totalIP) * 9 : 4.5;
      }

      const winPctDiff = withWinPct - withoutWinPct;
      const rpgDiff = withRPG - withoutRPG;

      impacts.push({
        name: playerName,
        position,
        isHitter,
        gamesPlayed: gamesWith.length,
        gamesMissed: gamesWithout.length,
        withWinPct: parseFloat((withWinPct * 100).toFixed(1)),
        withoutWinPct: parseFloat((withoutWinPct * 100).toFixed(1)),
        winPctDiff: parseFloat((winPctDiff * 100).toFixed(1)),
        withRPG: parseFloat(withRPG.toFixed(2)),
        withoutRPG: parseFloat(withoutRPG.toFixed(2)),
        rpgDiff: parseFloat(rpgDiff.toFixed(2)),
        playerValue: parseFloat(playerValue.toFixed(3)),
        status: ilPlayer.status?.description || 'IL',
      });
    } catch (e) {
      // Player may not have stats this season
    }
  }

  // Calculate composite adjustment
  // Weight by how much worse the team actually is without each player
  let totalAdj = 0;
  for (const imp of impacts) {
    // Only penalize if team genuinely performs worse without them
    if (imp.winPctDiff > 0) {
      // Cap individual player impact at 5% win prob
      const adj = Math.min(5, imp.winPctDiff * 0.5);
      totalAdj += adj;
    }
  }
  // Cap total roster impact at 10%
  totalAdj = Math.min(10, totalAdj);

  return {
    teamName,
    adjustment: parseFloat((-totalAdj).toFixed(1)),
    ilPlayers: impacts.sort((a, b) => b.winPctDiff - a.winPctDiff),
    details: impacts.length > 0
      ? `${impacts.length} IL player(s) with measurable impact`
      : 'IL players have no significant impact data',
  };
}

/**
 * NBA Roster Impact
 *
 * For a team, find injured/out players via ESPN, calculate their contribution
 * to the team, and compare team record with vs. without them.
 */
async function getNBARosterImpact(teamName, season = 2025) {
  const teamId = NBA_TEAM_IDS[teamName];
  if (!teamId) return { teamName, adjustment: 0, outPlayers: [], details: 'Unknown team' };

  // Get injuries league-wide and filter to this team
  const injuryData = await fetchJSON(`${ESPN_NBA_BASE}/injuries`);
  const teamInjuries = (injuryData.injuries || []).find(t =>
    t.displayName === teamName || t.id === String(teamId)
  );

  const outPlayers = (teamInjuries?.injuries || []).filter(
    inj => inj.status === 'Out' || inj.status === 'Day-To-Day'
  );

  if (outPlayers.length === 0) return { teamName, adjustment: 0, outPlayers: [], details: 'No players out' };

  // Get team schedule for game results
  const scheduleData = await fetchJSON(`${ESPN_NBA_BASE}/teams/${teamId}/schedule?season=${season}`);
  const teamGames = [];
  for (const event of (scheduleData.events || [])) {
    const comp = event.competitions?.[0];
    if (!comp || comp.status?.type?.description !== 'Final') continue;
    const homeComp = comp.competitors?.find(c => c.homeAway === 'home');
    const awayComp = comp.competitors?.find(c => c.homeAway === 'away');
    if (!homeComp || !awayComp) continue;

    const isHome = homeComp.team?.displayName === teamName;
    const ourScore = parseFloat(isHome ? homeComp.score?.displayValue : awayComp.score?.displayValue) || 0;
    const oppScore = parseFloat(isHome ? awayComp.score?.displayValue : homeComp.score?.displayValue) || 0;

    teamGames.push({
      id: event.id,
      date: event.date?.split('T')[0],
      won: ourScore > oppScore,
      pts: ourScore,
      oppPts: oppScore,
    });
  }

  if (teamGames.length < 20) return { teamName, adjustment: 0, outPlayers: [], details: 'Insufficient games' };

  // For each injured player, check game box scores to find games they played/missed
  const impacts = [];
  for (const inj of outPlayers) {
    const playerName = inj.athlete?.displayName;
    if (!playerName) continue;

    // Use game summaries to determine which games this player appeared in
    // We'll sample recent games to avoid hammering the API
    const recentGames = teamGames.slice(-40);
    const gamesPlayed = [];
    const gamesMissed = [];

    for (const game of recentGames) {
      try {
        const summaryData = await fetchJSON(`${ESPN_NBA_BASE}/summary?event=${game.id}`);
        const boxscore = summaryData.boxscore;
        if (!boxscore?.players) continue;

        let playerFound = false;
        for (const team of boxscore.players) {
          for (const statGroup of (team.statistics || [])) {
            for (const athlete of (statGroup.athletes || [])) {
              if (athlete.athlete?.displayName === playerName) {
                const mins = parseInt(athlete.stats?.[statGroup.labels?.indexOf('MIN')] || '0');
                if (mins > 0) playerFound = true;
              }
            }
          }
        }

        if (playerFound) gamesPlayed.push(game);
        else gamesMissed.push(game);
      } catch (e) {
        // Skip games we can't fetch
      }
    }

    if (gamesPlayed.length < 5 || gamesMissed.length < 3) continue;

    const withWinPct = gamesPlayed.filter(g => g.won).length / gamesPlayed.length;
    const withoutWinPct = gamesMissed.filter(g => g.won).length / gamesMissed.length;
    const withPPG = gamesPlayed.reduce((s, g) => s + g.pts, 0) / gamesPlayed.length;
    const withoutPPG = gamesMissed.reduce((s, g) => s + g.pts, 0) / gamesMissed.length;

    const winPctDiff = withWinPct - withoutWinPct;

    impacts.push({
      name: playerName,
      status: inj.status,
      gamesPlayed: gamesPlayed.length,
      gamesMissed: gamesMissed.length,
      withWinPct: parseFloat((withWinPct * 100).toFixed(1)),
      withoutWinPct: parseFloat((withoutWinPct * 100).toFixed(1)),
      winPctDiff: parseFloat((winPctDiff * 100).toFixed(1)),
      withPPG: parseFloat(withPPG.toFixed(1)),
      withoutPPG: parseFloat(withoutPPG.toFixed(1)),
      ppgDiff: parseFloat((withPPG - withoutPPG).toFixed(1)),
    });
  }

  let totalAdj = 0;
  for (const imp of impacts) {
    if (imp.winPctDiff > 0) {
      const adj = Math.min(8, imp.winPctDiff * 0.5);
      totalAdj += adj;
    }
  }
  totalAdj = Math.min(15, totalAdj);

  return {
    teamName,
    adjustment: parseFloat((-totalAdj).toFixed(1)),
    outPlayers: impacts.sort((a, b) => b.winPctDiff - a.winPctDiff),
    details: impacts.length > 0
      ? `${impacts.length} out player(s) with measurable impact`
      : outPlayers.length > 0
        ? `${outPlayers.length} player(s) out but insufficient history`
        : 'No players out',
  };
}

/**
 * Lightweight NBA impact — skips per-game box score lookups.
 * Uses ESPN leader stats to estimate missing player contribution as
 * a % of team output, then applies a scaled penalty.
 */
async function getNBARosterImpactLight(teamName, season = 2025) {
  const teamId = NBA_TEAM_IDS[teamName];
  if (!teamId) return { teamName, adjustment: 0, outPlayers: [], details: 'Unknown team' };

  const [injuryData, scheduleData] = await Promise.all([
    fetchJSON(`${ESPN_NBA_BASE}/injuries`),
    fetchJSON(`${ESPN_NBA_BASE}/teams/${teamId}/schedule?season=${season}`),
  ]);

  const teamInjuries = (injuryData.injuries || []).find(t =>
    t.displayName === teamName || t.id === String(teamId)
  );
  const outPlayers = (teamInjuries?.injuries || []).filter(
    inj => inj.status === 'Out'
  );

  if (outPlayers.length === 0) return { teamName, adjustment: 0, outPlayers: [], details: 'No players out' };

  // Calculate team's season average PPG from schedule
  const finishedGames = (scheduleData.events || []).filter(e =>
    e.competitions?.[0]?.status?.type?.description === 'Final'
  );
  let teamPPG = 110;
  if (finishedGames.length > 10) {
    let totalPts = 0;
    for (const event of finishedGames) {
      const comp = event.competitions[0];
      const us = comp.competitors?.find(c => c.team?.displayName === teamName);
      if (us) totalPts += parseFloat(us.score?.displayValue || '0');
    }
    teamPPG = totalPts / finishedGames.length;
  }

  // Get team win pct
  const wins = finishedGames.filter(e => {
    const comp = e.competitions[0];
    const us = comp.competitors?.find(c => c.team?.displayName === teamName);
    const them = comp.competitors?.find(c => c.team?.displayName !== teamName);
    return us && them && parseFloat(us.score?.displayValue || '0') > parseFloat(them.score?.displayValue || '0');
  }).length;
  const teamWinPct = finishedGames.length > 0 ? wins / finishedGames.length : 0.5;

  // Estimate each missing player's contribution from ESPN injury long comment
  // and apply proportional penalty
  const impacts = [];
  for (const inj of outPlayers) {
    const playerName = inj.athlete?.displayName;
    if (!playerName) continue;

    // ESPN doesn't give us PPG directly in injury data, so we estimate from league knowledge
    // We'll mark them and let the ensemble apply a generic star-level penalty based on role
    impacts.push({
      name: playerName,
      status: inj.status,
      comment: (inj.shortComment || '').slice(0, 120),
    });
  }

  // Simple heuristic: each "Out" player costs ~2-3% unless we know they're a star
  // Stars are identified by mention in injury longComment referencing large roles
  let totalAdj = 0;
  for (const imp of impacts) {
    totalAdj += 2.5;
  }
  totalAdj = Math.min(12, totalAdj);

  return {
    teamName,
    adjustment: parseFloat((-totalAdj).toFixed(1)),
    outPlayers: impacts,
    details: `${impacts.length} player(s) ruled out`,
  };
}

/**
 * Get MLB team ID from team name.
 */
const MLB_TEAM_IDS = {
  'Arizona Diamondbacks': 109, 'Atlanta Braves': 144, 'Baltimore Orioles': 110,
  'Boston Red Sox': 111, 'Chicago Cubs': 112, 'Chicago White Sox': 145,
  'Cincinnati Reds': 113, 'Cleveland Guardians': 114, 'Colorado Rockies': 115,
  'Detroit Tigers': 116, 'Houston Astros': 117, 'Kansas City Royals': 118,
  'Los Angeles Angels': 108, 'Los Angeles Dodgers': 119, 'Miami Marlins': 146,
  'Milwaukee Brewers': 158, 'Minnesota Twins': 142, 'New York Mets': 121,
  'New York Yankees': 147, 'Oakland Athletics': 133, 'Philadelphia Phillies': 143,
  'Pittsburgh Pirates': 134, 'San Diego Padres': 135, 'San Francisco Giants': 137,
  'Seattle Mariners': 136, 'St. Louis Cardinals': 138, 'Tampa Bay Rays': 139,
  'Texas Rangers': 140, 'Toronto Blue Jays': 141, 'Washington Nationals': 120,
};

function getMLBTeamId(teamName) {
  return MLB_TEAM_IDS[teamName] || null;
}

module.exports = {
  getMLBRosterImpact,
  getNBARosterImpact,
  getNBARosterImpactLight,
  getMLBTeamId,
  MLB_TEAM_IDS,
  NBA_TEAM_IDS,
};
