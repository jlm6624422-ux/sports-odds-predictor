// NFL data from multiple free sources
// ESPN + nfl.com public APIs + Pro Football Reference style stats

const ESPN_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const ESPN_NFL_CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

class NflDataService {
  // --- ESPN NFL Endpoints ---
  async getScoreboard(week, seasonType = 2) {
    const url = `${ESPN_NFL}/scoreboard?week=${week}&seasontype=${seasonType}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN NFL scoreboard error: ${res.status}`);
    return res.json();
  }

  async getTeamStats(teamId) {
    const url = `${ESPN_NFL}/teams/${teamId}/statistics`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN NFL team stats error: ${res.status}`);
    return res.json();
  }

  async getDepthChart(teamId) {
    const url = `${ESPN_NFL}/teams/${teamId}/depthcharts`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN NFL depth chart error: ${res.status}`);
    return res.json();
  }

  async getInjuries(teamId) {
    const url = `${ESPN_NFL}/teams/${teamId}/injuries`;
    const res = await fetch(url);
    if (!res.ok) return { items: [] };
    return res.json();
  }

  async getTeamSchedule(teamId) {
    const url = `${ESPN_NFL}/teams/${teamId}/schedule`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN NFL schedule error: ${res.status}`);
    return res.json();
  }

  async getQBR(season) {
    const url = `https://site.web.api.espn.com/apis/fitt/v3/sports/football/nfl/qbr?season=${season}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  }

  // --- Aggregated Team Power Data ---
  async getTeamPowerData(teamId, season) {
    const [stats, schedule, injuries] = await Promise.allSettled([
      this.getTeamStats(teamId),
      this.getTeamSchedule(teamId),
      this.getInjuries(teamId),
    ]);

    return {
      stats: stats.status === 'fulfilled' ? stats.value : null,
      schedule: schedule.status === 'fulfilled' ? schedule.value : null,
      injuries: injuries.status === 'fulfilled' ? injuries.value : null,
    };
  }

  // --- Parse useful stats for modeling ---
  parseTeamStats(espnStatsResponse) {
    if (!espnStatsResponse?.results?.stats?.categories) return null;

    const stats = {};
    for (const category of espnStatsResponse.results.stats.categories) {
      for (const stat of category.stats || []) {
        stats[`${category.name}_${stat.name}`] = parseFloat(stat.value) || 0;
      }
    }
    return stats;
  }
}

module.exports = { NflDataService };
