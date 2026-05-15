// ESPN public API - no key required
// Provides: scores, schedules, standings, team stats, player stats, injuries
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const ESPN_SPORTS = {
  NFL: { sport: 'football', league: 'nfl' },
  NCAAF: { sport: 'football', league: 'college-football' },
  NBA: { sport: 'basketball', league: 'nba' },
  NCAAB: { sport: 'basketball', league: 'mens-college-basketball' },
  MLB: { sport: 'baseball', league: 'mlb' },
};

class EspnService {
  async fetchScoreboard(sport) {
    const { sport: s, league } = ESPN_SPORTS[sport] || ESPN_SPORTS.NFL;
    const url = `${ESPN_BASE}/${s}/${league}/scoreboard`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN scoreboard error: ${res.status}`);
    return res.json();
  }

  async fetchSchedule(sport, week) {
    const { sport: s, league } = ESPN_SPORTS[sport] || ESPN_SPORTS.NFL;
    let url = `${ESPN_BASE}/${s}/${league}/scoreboard`;
    if (week) url += `?week=${week}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN schedule error: ${res.status}`);
    return res.json();
  }

  async fetchStandings(sport) {
    const { sport: s, league } = ESPN_SPORTS[sport] || ESPN_SPORTS.NFL;
    const url = `https://site.api.espn.com/apis/v2/sports/${s}/${league}/standings`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN standings error: ${res.status}`);
    return res.json();
  }

  async fetchTeamStats(sport, teamId) {
    const { sport: s, league } = ESPN_SPORTS[sport] || ESPN_SPORTS.NFL;
    const url = `${ESPN_BASE}/${s}/${league}/teams/${teamId}/statistics`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN team stats error: ${res.status}`);
    return res.json();
  }

  async fetchTeamRoster(sport, teamId) {
    const { sport: s, league } = ESPN_SPORTS[sport] || ESPN_SPORTS.NFL;
    const url = `${ESPN_BASE}/${s}/${league}/teams/${teamId}/roster`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN roster error: ${res.status}`);
    return res.json();
  }

  async fetchInjuries(sport) {
    const { sport: s, league } = ESPN_SPORTS[sport] || ESPN_SPORTS.NFL;
    const url = `https://site.api.espn.com/apis/fantasy/v2/games/${s === 'football' ? 'ffl' : s === 'basketball' ? 'fba' : 'flb'}/news?days=7`;
    const res = await fetch(url);
    if (!res.ok) return { articles: [] };
    return res.json();
  }

  async fetchTeams(sport) {
    const { sport: s, league } = ESPN_SPORTS[sport] || ESPN_SPORTS.NFL;
    const url = `${ESPN_BASE}/${s}/${league}/teams`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN teams error: ${res.status}`);
    return res.json();
  }

  async fetchGameSummary(sport, gameId) {
    const { sport: s, league } = ESPN_SPORTS[sport] || ESPN_SPORTS.NFL;
    const url = `${ESPN_BASE}/${s}/${league}/summary?event=${gameId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN summary error: ${res.status}`);
    return res.json();
  }

  async fetchOdds(sport, gameId) {
    const { sport: s, league } = ESPN_SPORTS[sport] || ESPN_SPORTS.NFL;
    const url = `${ESPN_BASE}/${s}/${league}/summary?event=${gameId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.pickcenter || null;
  }
}

module.exports = { EspnService, ESPN_SPORTS };
