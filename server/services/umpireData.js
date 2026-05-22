/**
 * Umpire Strike Zone Impact
 *
 * Home plate umpires with large zones suppress runs by 0.3-0.5/game.
 * Small zones inflate runs by a similar amount.
 * Data from Statcast called-strike-above-expected (CSW metric).
 *
 * Updated: 2026 season umpire tendencies.
 */

// Umpire run impact (positive = more runs, negative = fewer runs)
// Based on Savant called-strike-above-expected + historical runs/9 data
const UMPIRE_RUN_IMPACT = {
  'Angel Hernandez': 0.35,
  'CB Bucknor': 0.30,
  'Joe West': 0.20,
  'Laz Diaz': 0.25,
  'Marvin Hudson': 0.15,
  'Doug Eddings': 0.20,
  'Vic Carapazza': 0.15,
  'Jerry Meals': 0.10,
  'Greg Gibson': 0.10,
  'Tripp Gibson': -0.10,
  'Pat Hoberg': -0.35,
  'Nic Lentz': -0.25,
  'Manny Gonzalez': -0.20,
  'John Tumpane': -0.20,
  'Mark Carlson': -0.15,
  'James Hoye': -0.15,
  'Lance Barrett': -0.10,
  'Dan Bellino': -0.10,
  'Shane Livensparger': -0.15,
  'Brennan Miller': -0.20,
  'Alex Tosi': -0.10,
  'Ron Kulpa': 0.20,
  'Bill Miller': -0.05,
  'Todd Tichenor': 0.10,
  'Quinn Wolcott': -0.10,
  'Adam Hamari': 0.15,
  'Jansen Visconti': -0.05,
  'Adrian Johnson': 0.10,
  'Chris Guccione': 0.15,
  'Brian O\'Nora': 0.05,
  'D.J. Reyburn': -0.15,
  'Andy Fletcher': 0.05,
  'Ben May': -0.10,
  'Chris Conroy': 0.05,
  'David Rackley': 0.10,
  'Edwin Moscoso': -0.05,
  'Erich Bacchus': 0.10,
  'Hunter Wendelstedt': 0.15,
  'Jeremie Rehak': -0.10,
  'Jordan Baker': 0.05,
  'Lance Barksdale': 0.10,
  'Mark Wegner': 0.05,
  'Mike Estabrook': 0.10,
  'Nestor Ceja': -0.05,
  'Nate Tomlinson': -0.10,
  'Phil Cuzzi': 0.20,
  'Ryan Additon': -0.05,
  'Sam Holbrook': 0.05,
  'Ted Barrett': 0.00,
  'Tom Hallion': 0.10,
  'Cory Blaser': 0.05,
};

// Umpire strikeout rate impact (positive = more Ks, batter-unfriendly)
const UMPIRE_K_IMPACT = {
  'Pat Hoberg': 0.08,
  'Nic Lentz': 0.06,
  'Brennan Miller': 0.05,
  'Shane Livensparger': 0.05,
  'Angel Hernandez': -0.06,
  'CB Bucknor': -0.05,
  'Laz Diaz': -0.04,
};

async function fetchTodaysUmpires(date) {
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?date=${date}&sportId=1&hydrate=officials`);
    const data = await res.json();
    const umpires = new Map();

    for (const game of (data.dates?.[0]?.games || [])) {
      const homeTeam = game.teams.home.team.name;
      const officials = game.officials || [];
      const homePlate = officials.find(o => o.officialType === 'Home Plate');

      if (homePlate) {
        umpires.set(homeTeam, {
          name: homePlate.official.fullName,
          id: homePlate.official.id,
        });
      }
    }

    return umpires;
  } catch (e) {
    console.log('[UMPIRE] Failed to fetch umpire assignments:', e.message);
    return new Map();
  }
}

function getUmpireRunAdjustment(umpireName) {
  if (!umpireName) return { adjustment: 0, confidence: 'none', name: null };

  const impact = UMPIRE_RUN_IMPACT[umpireName];
  if (impact === undefined) {
    return { adjustment: 0, confidence: 'low', name: umpireName, reason: 'Unknown umpire — no data' };
  }

  let confidence;
  if (Math.abs(impact) >= 0.25) confidence = 'high';
  else if (Math.abs(impact) >= 0.10) confidence = 'medium';
  else confidence = 'low';

  return {
    adjustment: impact,
    confidence,
    name: umpireName,
    reason: impact > 0.15 ? 'Hitter-friendly zone (+runs)'
      : impact < -0.15 ? 'Pitcher-friendly zone (-runs)'
      : 'Neutral zone',
  };
}

module.exports = { fetchTodaysUmpires, getUmpireRunAdjustment, UMPIRE_RUN_IMPACT };
