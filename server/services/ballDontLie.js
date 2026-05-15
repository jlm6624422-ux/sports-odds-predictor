// Ball Don't Lie API - free NBA/NCAAB stats
// https://www.balldontlie.io/
// Provides: players, teams, games, stats, season averages
const BDL_BASE = 'https://api.balldontlie.io/v1';

class BallDontLieService {
  constructor(apiKey) {
    this.apiKey = apiKey; // Free tier available
    this.headers = apiKey ? { Authorization: apiKey } : {};
  }

  async request(endpoint, params = {}) {
    const url = new URL(`${BDL_BASE}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(val => url.searchParams.append(`${k}[]`, val));
      else if (v !== undefined) url.searchParams.set(k, v);
    });

    const res = await fetch(url.toString(), { headers: this.headers });
    if (!res.ok) throw new Error(`BallDontLie error: ${res.status}`);
    return res.json();
  }

  async getTeams() {
    return this.request('/teams');
  }

  async getPlayers(search, page = 1, perPage = 25) {
    return this.request('/players', { search, page, per_page: perPage });
  }

  async getGames({ dates, seasons, teamIds, page = 1, perPage = 25 } = {}) {
    return this.request('/games', {
      'dates[]': dates,
      'seasons[]': seasons,
      'team_ids[]': teamIds,
      page,
      per_page: perPage,
    });
  }

  async getGameById(gameId) {
    return this.request(`/games/${gameId}`);
  }

  async getStats({ gameIds, playerIds, dates, seasons, page = 1, perPage = 25 } = {}) {
    return this.request('/stats', {
      'game_ids[]': gameIds,
      'player_ids[]': playerIds,
      'dates[]': dates,
      'seasons[]': seasons,
      page,
      per_page: perPage,
    });
  }

  async getSeasonAverages(season, playerIds) {
    return this.request('/season_averages', {
      season,
      'player_ids[]': playerIds,
    });
  }
}

module.exports = { BallDontLieService };
