const { MlbStatsService } = require('./mlbStats');

const mlb = new MlbStatsService();

async function fetchConfirmedLineups(date) {
  const formattedDate = date.replace(/-/g, '');
  const dateStr = `${formattedDate.slice(0, 4)}-${formattedDate.slice(4, 6)}-${formattedDate.slice(6, 8)}`;

  const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?date=${dateStr}&sportId=1&hydrate=lineups,probablePitcher`);
  const data = await res.json();
  const games = data.dates?.[0]?.games || [];

  const lineups = new Map();

  for (const game of games) {
    const gamePk = game.gamePk;
    const homeTeam = game.teams.home.team.name;
    const awayTeam = game.teams.away.team.name;

    const homeLineup = extractLineup(game.teams.home);
    const awayLineup = extractLineup(game.teams.away);

    lineups.set(homeTeam, {
      gamePk,
      homeTeam,
      awayTeam,
      home: homeLineup,
      away: awayLineup,
    });
  }

  return lineups;
}

function extractLineup(teamData) {
  const batters = teamData.lineup || [];
  if (batters.length === 0) return null;

  const lineup = batters.map((batter, idx) => ({
    id: batter.id,
    name: batter.fullName,
    position: batter.primaryPosition?.abbreviation || 'DH',
    battingOrder: idx + 1,
    bats: batter.batSide?.code || 'R',
  }));

  const leftHanded = lineup.filter(b => b.bats === 'L' || b.bats === 'S').length;
  const leftHandedPct = lineup.length > 0 ? leftHanded / lineup.length : 0.45;

  return {
    batters: lineup,
    confirmed: lineup.length >= 9,
    leftHandedPct: parseFloat(leftHandedPct.toFixed(3)),
    battingOrderStr: lineup.map(b => `${b.battingOrder}. ${b.name} (${b.bats})`).join('\n'),
  };
}

function getLineupAdjustment(lineup, pitcherHand) {
  if (!lineup || !lineup.confirmed) return 0;

  // Platoon advantage: LHB vs RHP or RHB vs LHP
  const advantagePct = pitcherHand === 'L'
    ? (1 - lineup.leftHandedPct)  // RHBs have advantage vs LHP
    : lineup.leftHandedPct;        // LHBs have advantage vs RHP

  // League average platoon advantage is ~0.45 LHB vs RHP
  // If actual lineup deviates, adjust runs expectation
  const baselinePct = 0.45;
  const deviation = advantagePct - baselinePct;

  // Each 10% platoon advantage shift ≈ 0.15 runs
  return parseFloat((deviation * 1.5).toFixed(3));
}

async function fetchNBALineupStatus(date) {
  const dateCompact = date.replace(/-/g, '');
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateCompact}`);
  const data = await res.json();

  const gameStatuses = [];
  for (const event of (data.events || [])) {
    const comp = event.competitions[0];
    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    gameStatuses.push({
      home: home.team.displayName,
      away: away.team.displayName,
      homeRecord: (home.records || [{}])[0]?.summary,
      awayRecord: (away.records || [{}])[0]?.summary,
      spread: (comp.odds || [])[0]?.details,
      overUnder: (comp.odds || [])[0]?.overUnder,
      status: comp.status?.type?.shortDetail,
    });
  }

  return gameStatuses;
}

module.exports = { fetchConfirmedLineups, extractLineup, getLineupAdjustment, fetchNBALineupStatus };
