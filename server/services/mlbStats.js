// MLB Stats API - completely free, no key needed
// https://statsapi.mlb.com
// Provides: schedules, game data, standings, rosters, player stats, pitch data
const MLB_BASE = 'https://statsapi.mlb.com/api/v1';

class MlbStatsService {
  async request(endpoint, params = {}) {
    const url = new URL(`${MLB_BASE}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, v);
    });

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`MLB Stats API error: ${res.status}`);
    return res.json();
  }

  async getSchedule(date, sportId = 1) {
    // date format: YYYY-MM-DD
    return this.request('/schedule', { date, sportId });
  }

  async getScheduleRange(startDate, endDate, sportId = 1) {
    return this.request('/schedule', { startDate, endDate, sportId });
  }

  async getStandings(leagueId = '103,104', season) {
    const params = { leagueId };
    if (season) params.season = season;
    return this.request('/standings', params);
  }

  async getTeams(sportId = 1) {
    return this.request('/teams', { sportId });
  }

  async getTeamRoster(teamId, rosterType = 'active') {
    return this.request(`/teams/${teamId}/roster`, { rosterType });
  }

  async getTeamStats(teamId, season, group = 'hitting,pitching,fielding') {
    return this.request(`/teams/${teamId}/stats`, {
      stats: 'season',
      group,
      season,
    });
  }

  async getPlayerStats(playerId, stats = 'season', group = 'hitting') {
    return this.request(`/people/${playerId}/stats`, { stats, group });
  }

  async getGameFeed(gamePk) {
    const url = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MLB game feed error: ${res.status}`);
    return res.json();
  }

  async getGameBoxscore(gamePk) {
    return this.request(`/game/${gamePk}/boxscore`);
  }

  async getGameLinescore(gamePk) {
    return this.request(`/game/${gamePk}/linescore`);
  }

  async getProbablePitchers(date) {
    // Returns schedule with probable pitchers populated
    return this.request('/schedule', {
      date,
      sportId: 1,
      hydrate: 'probablePitcher(note)',
    });
  }

  async getPlayerInfo(playerId) {
    return this.request(`/people/${playerId}`, {
      hydrate: 'stats(group=[hitting,pitching],type=[season,career])',
    });
  }

  async getVenueInfo(venueId) {
    return this.request(`/venues/${venueId}`);
  }
}

module.exports = { MlbStatsService };
