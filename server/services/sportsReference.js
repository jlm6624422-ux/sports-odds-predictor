// Sports-Reference / Stathead style data via free endpoints
// Covers NFL, NBA, MLB advanced stats
// Uses Pro Football Reference, Basketball Reference, Baseball Reference style data
// via the free cfbd.com API for college football

const CFBD_BASE = 'https://api.collegefootballdata.com';

class CollegeFootballDataService {
  constructor(apiKey) {
    this.apiKey = apiKey; // Free registration at collegefootballdata.com
    this.headers = apiKey
      ? { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      : { Accept: 'application/json' };
  }

  async request(endpoint, params = {}) {
    const url = new URL(`${CFBD_BASE}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, v);
    });

    const res = await fetch(url.toString(), { headers: this.headers });
    if (!res.ok) throw new Error(`CFBD error: ${res.status}`);
    return res.json();
  }

  async getGames(year, week, seasonType = 'regular', team) {
    return this.request('/games', { year, week, seasonType, team });
  }

  async getGameLines(year, week, seasonType = 'regular') {
    return this.request('/lines', { year, week, seasonType });
  }

  async getTeamRecords(year, team) {
    return this.request('/records', { year, team });
  }

  async getTeamStats(year, team) {
    return this.request('/stats/season', { year, team });
  }

  async getAdvancedTeamStats(year, team) {
    return this.request('/stats/season/advanced', { year, team });
  }

  async getRankings(year, week, seasonType = 'regular') {
    return this.request('/rankings', { year, week, seasonType });
  }

  async getMatchupHistory(team1, team2, minYear) {
    return this.request('/teams/matchup', { team1, team2, minYear });
  }

  async getConferenceStandings(year, conference) {
    return this.request('/records', { year, conference });
  }

  async getPreGameWinProb(year, week, seasonType = 'regular') {
    return this.request('/metrics/wp/pregame', { year, week, seasonType });
  }

  async getSPRatings(year, team) {
    return this.request('/ratings/sp', { year, team });
  }

  async getEloRatings(year, team) {
    return this.request('/ratings/elo', { year, team });
  }

  async getTalent(year) {
    return this.request('/talent', { year });
  }

  async getRecruitingRankings(year, team) {
    return this.request('/recruiting/teams', { year, team });
  }

  async getWeather(year, week) {
    return this.request('/games/weather', { year, week });
  }

  async getVenues() {
    return this.request('/venues');
  }
}

module.exports = { CollegeFootballDataService };
