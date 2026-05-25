/**
 * Bullpen Fatigue Index
 *
 * Tracks reliever workload over rolling 3-day window.
 * Books are slow to adjust when top arms are unavailable.
 * A fatigued bullpen = 2-4% win probability penalty.
 */

async function calculateBullpenFatigue(teamId, teamName) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];

    const schedUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&startDate=${threeDaysAgo}&endDate=${today}&hydrate=pitchers`;
    const schedRes = await fetch(schedUrl);
    if (!schedRes.ok) return defaultResult();
    const schedData = await schedRes.json();

    const games = [];
    for (const date of (schedData.dates || [])) {
      for (const game of (date.games || [])) {
        if (game.status?.detailedState?.includes('Final')) {
          games.push(game);
        }
      }
    }

    if (games.length === 0) return defaultResult();

    // Track pitches per reliever across recent games
    const relieverWorkload = new Map();

    for (const game of games) {
      const isHome = game.teams.home.team.id === teamId;
      const pitchers = isHome ? game.teams.home.pitchers : game.teams.away.pitchers;
      if (!pitchers || pitchers.length === 0) continue;

      // First pitcher is the starter — skip them
      for (let i = 1; i < pitchers.length; i++) {
        const pitcher = pitchers[i];
        if (!pitcher) continue;
        const name = pitcher.fullName || `pitcher-${pitcher.id}`;
        if (!relieverWorkload.has(name)) {
          relieverWorkload.set(name, { appearances: 0, totalPitches: 0, consecutiveDays: 0, lastDate: null });
        }
        const rl = relieverWorkload.get(name);
        rl.appearances++;
        rl.totalPitches += pitcher.stats?.pitching?.numberOfPitches || 20;
        const gameDate = game.gameDate?.split('T')[0];
        if (rl.lastDate && daysDiff(rl.lastDate, gameDate) === 1) {
          rl.consecutiveDays++;
        }
        rl.lastDate = gameDate;
      }
    }

    // Determine unavailable arms
    let unavailableArms = 0;
    let fatigueScore = 0;
    const details = [];

    for (const [name, data] of relieverWorkload) {
      const isUnavailable = data.totalPitches >= 50 || data.appearances >= 3 || data.consecutiveDays >= 2;
      const armFatigue = (data.totalPitches / 30) * (data.appearances / 2);
      fatigueScore += armFatigue;

      if (isUnavailable) {
        unavailableArms++;
        details.push({ name, pitches: data.totalPitches, appearances: data.appearances, status: 'UNAVAILABLE' });
      }
    }

    // Win probability adjustment: -1% per unavailable arm (max -4%)
    const adjustment = Math.min(0, -unavailableArms * 1.0);

    return {
      teamName,
      fatigueScore: parseFloat(fatigueScore.toFixed(1)),
      unavailableArms,
      totalRelieversTracked: relieverWorkload.size,
      adjustment: parseFloat(adjustment.toFixed(1)),
      details: details.slice(0, 5),
      gamesAnalyzed: games.length,
    };
  } catch (e) {
    return defaultResult();
  }
}

function defaultResult() {
  return { fatigueScore: 0, unavailableArms: 0, totalRelieversTracked: 0, adjustment: 0, details: [], gamesAnalyzed: 0 };
}

function daysDiff(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.abs(Math.round((d2 - d1) / 86400000));
}

module.exports = { calculateBullpenFatigue };
