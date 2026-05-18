/**
 * Bullpen State Tracker
 *
 * ~35% of MLB outcomes determined by bullpen performance.
 * Tracks recent usage, availability, fatigue, and composite strength.
 * Based on The Hardball Times and Baseball Prospectus research.
 */

const { MlbStatsService } = require('./mlbStats');
const { calculateFIP, regressToMean } = require('./fipCalculator');

const mlb = new MlbStatsService();

// Pitch count thresholds for availability
const AVAILABILITY_RULES = {
  heavyUsage: 35,      // 35+ pitches = likely unavailable next day
  mediumUsage: 20,     // 20-34 pitches = available but not ideal
  backToBackLimit: 25, // Max pitches in consecutive days before fatigue
  daysOffNeeded: {     // Pitches thrown -> days needed
    45: 2,
    35: 1,
    25: 0,
  },
};

/**
 * Assess bullpen availability and fatigue for a team.
 *
 * @param {Array} recentGames - Last 5 days of game data with pitcher usage
 *   [{ date, pitchers: [{ id, name, pitchCount, inningsPitched, earnedRuns }] }]
 * @param {Array} bullpenRoster - [{ id, name, role, seasonStats: { era, k, bb, hr, ip } }]
 * @returns {Object} Bullpen state assessment
 */
function assessBullpenState(recentGames, bullpenRoster) {
  const pitcherUsage = new Map(); // id -> [{ date, pitchCount, ip }]

  // Build usage history for last 5 days
  for (const game of recentGames) {
    for (const pitcher of game.pitchers || []) {
      if (!pitcherUsage.has(pitcher.id)) pitcherUsage.set(pitcher.id, []);
      pitcherUsage.get(pitcher.id).push({
        date: game.date,
        pitchCount: pitcher.pitchCount || 0,
        ip: pitcher.inningsPitched || 0,
        er: pitcher.earnedRuns || 0,
      });
    }
  }

  const today = new Date();
  const availability = [];
  let totalAvailable = 0;
  let totalFresh = 0;
  let closerAvailable = false;

  for (const reliever of bullpenRoster) {
    const usage = pitcherUsage.get(reliever.id) || [];
    const lastApp = usage.length > 0 ? usage[usage.length - 1] : null;

    // Days since last appearance
    let daysSinceLastApp = 99;
    if (lastApp) {
      daysSinceLastApp = Math.floor((today - new Date(lastApp.date)) / (1000 * 60 * 60 * 24));
    }

    // Recent workload (last 3 days)
    const threeDayCutoff = new Date(today - 3 * 24 * 60 * 60 * 1000);
    const recentApps = usage.filter(u => new Date(u.date) >= threeDayCutoff);
    const recentPitches = recentApps.reduce((sum, u) => sum + u.pitchCount, 0);
    const recentIP = recentApps.reduce((sum, u) => sum + u.ip, 0);
    const consecutiveDays = recentApps.length;

    // Determine availability
    let status;
    let fatigueLevel; // 0-10
    if (daysSinceLastApp === 0 && lastApp && lastApp.pitchCount >= AVAILABILITY_RULES.heavyUsage) {
      status = 'unavailable';
      fatigueLevel = 9;
    } else if (consecutiveDays >= 3) {
      status = 'unavailable';
      fatigueLevel = 10;
    } else if (daysSinceLastApp === 0 && recentPitches >= AVAILABILITY_RULES.backToBackLimit) {
      status = 'limited';
      fatigueLevel = 7;
    } else if (recentPitches >= 50) {
      status = 'limited';
      fatigueLevel = 6;
    } else if (daysSinceLastApp >= 2) {
      status = 'fresh';
      fatigueLevel = 1;
    } else {
      status = 'available';
      fatigueLevel = 3;
    }

    const isAvailable = status === 'available' || status === 'fresh';
    if (isAvailable) totalAvailable++;
    if (status === 'fresh') totalFresh++;
    if (reliever.role === 'closer' && isAvailable) closerAvailable = true;

    availability.push({
      id: reliever.id,
      name: reliever.name,
      role: reliever.role || 'middle',
      status,
      fatigueLevel,
      daysSinceLastApp,
      recentPitches,
      recentIP: parseFloat(recentIP.toFixed(1)),
      consecutiveDays,
    });
  }

  // Calculate composite bullpen strength (available relievers only)
  const availableRelievers = availability.filter(a =>
    a.status === 'available' || a.status === 'fresh'
  );

  let compositeStrength = null;
  if (availableRelievers.length > 0 && bullpenRoster.length > 0) {
    const strengthScores = availableRelievers.map(a => {
      const roster = bullpenRoster.find(r => r.id === a.id);
      if (!roster || !roster.seasonStats) return 4.50; // League avg if no data
      const fip = calculateFIP(roster.seasonStats);
      return fip || 4.50;
    });
    compositeStrength = strengthScores.reduce((sum, s) => sum + s, 0) / strengthScores.length;
  }

  // Overall bullpen fatigue score (0-10)
  const avgFatigue = availability.length > 0
    ? availability.reduce((sum, a) => sum + a.fatigueLevel, 0) / availability.length
    : 5;

  // Bullpen grade
  let grade;
  if (compositeStrength && compositeStrength <= 3.20 && avgFatigue <= 3) grade = 'elite';
  else if (compositeStrength && compositeStrength <= 3.80 && avgFatigue <= 5) grade = 'good';
  else if (avgFatigue >= 7 || totalAvailable <= 3) grade = 'depleted';
  else if (compositeStrength && compositeStrength >= 4.80) grade = 'weak';
  else grade = 'average';

  return {
    availability: availability.sort((a, b) => a.fatigueLevel - b.fatigueLevel),
    summary: {
      totalRelievers: bullpenRoster.length,
      available: totalAvailable,
      fresh: totalFresh,
      closerAvailable,
      compositeStrength: compositeStrength ? parseFloat(compositeStrength.toFixed(2)) : null,
      avgFatigue: parseFloat(avgFatigue.toFixed(1)),
      grade,
    },
  };
}

/**
 * Calculate run adjustment based on bullpen state.
 * Returns expected runs above/below average the bullpen will allow.
 *
 * @param {Object} bullpenState - Output from assessBullpenState()
 * @param {number} leagueAvgBullpenFIP - League avg reliever FIP (~4.00)
 * @returns {{ runsAdjustment, confidence, reason }}
 */
function getBullpenRunAdjustment(bullpenState, leagueAvgBullpenFIP = 4.00) {
  const { summary } = bullpenState;

  if (!summary.compositeStrength) {
    return { runsAdjustment: 0, confidence: 'low', reason: 'No bullpen data available' };
  }

  // Base adjustment: how much better/worse than league average
  // Bullpen typically faces ~12 batters per game (~3 IP of relief)
  const ipWeight = 3.0 / 9.0; // Bullpen responsible for ~1/3 of game
  const strengthDiff = summary.compositeStrength - leagueAvgBullpenFIP;
  let runsAdj = strengthDiff * ipWeight;

  // Fatigue penalty
  if (summary.avgFatigue >= 7) {
    runsAdj += 0.5; // Depleted bullpen allows more runs
  } else if (summary.avgFatigue >= 5) {
    runsAdj += 0.2;
  }

  // Closer unavailable penalty
  if (!summary.closerAvailable) {
    runsAdj += 0.3;
  }

  // Low availability penalty
  if (summary.available <= 3) {
    runsAdj += 0.4;
  }

  let confidence;
  if (summary.totalRelievers >= 5 && summary.available >= 4) confidence = 'high';
  else if (summary.totalRelievers >= 3) confidence = 'medium';
  else confidence = 'low';

  let reason;
  if (summary.grade === 'depleted') reason = 'Bullpen depleted — heavy recent usage';
  else if (summary.grade === 'elite') reason = 'Elite bullpen, well-rested';
  else if (runsAdj > 0.3) reason = 'Below-avg bullpen or fatigued arms';
  else if (runsAdj < -0.3) reason = 'Strong bullpen with fresh arms';
  else reason = 'Average bullpen state';

  return {
    runsAdjustment: parseFloat(runsAdj.toFixed(2)),
    confidence,
    reason,
    grade: summary.grade,
  };
}

/**
 * Fetch recent bullpen usage from MLB Stats API for a team.
 *
 * @param {number} teamId - MLB team ID
 * @param {number} daysBack - How many days to look back (default 5)
 * @returns {Array} Recent game pitcher usage data
 */
async function fetchRecentBullpenUsage(teamId, daysBack = 5) {
  try {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const schedule = await mlb.getScheduleRange(startDate, endDate);
    const games = [];

    for (const date of schedule.dates || []) {
      for (const game of date.games || []) {
        const isHome = game.teams.home.team.id === teamId;
        const isAway = game.teams.away.team.id === teamId;
        if (!isHome && !isAway) continue;
        if (game.status?.statusCode !== 'F') continue; // Only completed games

        try {
          const boxscore = await mlb.getGameBoxscore(game.gamePk);
          const teamBox = isHome ? boxscore.teams?.home : boxscore.teams?.away;
          const pitchers = [];

          for (const pitcherId of teamBox?.pitchers || []) {
            const playerStats = teamBox?.players?.[`ID${pitcherId}`];
            if (!playerStats) continue;
            const stats = playerStats.stats?.pitching;
            if (!stats) continue;

            // Skip starter (first pitcher listed or most IP)
            pitchers.push({
              id: pitcherId,
              name: playerStats.person?.fullName,
              pitchCount: parseInt(stats.numberOfPitches) || 0,
              inningsPitched: parseFloat(stats.inningsPitched) || 0,
              earnedRuns: parseInt(stats.earnedRuns) || 0,
            });
          }

          // Remove starter (first pitcher or most IP)
          if (pitchers.length > 0) {
            pitchers.sort((a, b) => b.inningsPitched - a.inningsPitched);
            const starterIP = pitchers[0].inningsPitched;
            const relievers = pitchers.filter(p => p.inningsPitched < starterIP || p !== pitchers[0]);

            games.push({ date: date.date, pitchers: relievers });
          }
        } catch (e) {
          // Skip games where boxscore fails
        }
      }
    }

    return games;
  } catch (e) {
    return [];
  }
}

module.exports = {
  assessBullpenState,
  getBullpenRunAdjustment,
  fetchRecentBullpenUsage,
  AVAILABILITY_RULES,
};
