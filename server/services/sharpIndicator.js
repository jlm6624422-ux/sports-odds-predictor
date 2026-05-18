/**
 * Sharp Money Indicator Service
 * Adapted from BetTrack (WFord26/BetTrack)
 *
 * Detects sharp money (steam moves), reverse line movement, and gradual drift.
 * Works with odds snapshots over time to identify where smart money is going.
 */

const { americanToImpliedProb } = require('./marketConsensus');

/**
 * Detect line movement between two odds snapshots for a game.
 *
 * @param {Array} snapshotsBefore - Earlier odds snapshot [{bookmaker, homePrice, awayPrice, homeSpread, totalLine}]
 * @param {Array} snapshotsAfter - Later odds snapshot (same format)
 * @param {string} marketType - 'h2h' | 'spreads' | 'totals'
 * @returns {Object} { movementType, sharpSide, magnitude, bookmakersMoved }
 */
function detectLineMovement(snapshotsBefore, snapshotsAfter, marketType) {
  if (!snapshotsBefore.length || !snapshotsAfter.length) {
    return { movementType: 'no_movement', sharpSide: 'none', magnitude: 0, bookmakersMoved: 0 };
  }

  const beforeMap = new Map(snapshotsBefore.map(s => [s.bookmaker, s]));
  const afterMap = new Map(snapshotsAfter.map(s => [s.bookmaker, s]));

  const commonBooks = [...beforeMap.keys()].filter(k => afterMap.has(k));
  if (commonBooks.length === 0) {
    return { movementType: 'no_movement', sharpSide: 'none', magnitude: 0, bookmakersMoved: 0 };
  }

  let totalMovement = 0;
  let bookmakersMoved = 0;

  for (const bk of commonBooks) {
    const before = beforeMap.get(bk);
    const after = afterMap.get(bk);

    let movement = 0;
    if (marketType === 'h2h') {
      const beforeProb = americanToImpliedProb(before.homePrice);
      const afterProb = americanToImpliedProb(after.homePrice);
      movement = afterProb - beforeProb;
    } else if (marketType === 'spreads') {
      movement = after.homeSpread - before.homeSpread;
    } else {
      movement = after.totalLine - before.totalLine;
    }

    if (Math.abs(movement) > 0.001) {
      totalMovement += movement;
      bookmakersMoved++;
    }
  }

  if (bookmakersMoved === 0) {
    return { movementType: 'no_movement', sharpSide: 'none', magnitude: 0, bookmakersMoved: 0 };
  }

  const avgMovement = totalMovement / commonBooks.length;
  const moveRatio = bookmakersMoved / commonBooks.length;

  // Classify movement type
  let movementType;
  if (moveRatio >= 0.7 && Math.abs(avgMovement) > 0.02) {
    movementType = 'steam'; // Rapid, broad movement
  } else if (moveRatio >= 0.3) {
    movementType = 'gradual';
  } else {
    movementType = 'gradual';
  }

  // Determine which side sharp money is on
  let sharpSide;
  if (marketType === 'h2h') {
    sharpSide = avgMovement > 0 ? 'home' : 'away';
  } else if (marketType === 'spreads') {
    sharpSide = avgMovement < 0 ? 'home' : 'away'; // Line moving toward home = sharp on home
  } else {
    sharpSide = avgMovement > 0 ? 'over' : 'under';
  }

  return {
    movementType,
    sharpSide,
    magnitude: parseFloat(Math.abs(avgMovement).toFixed(4)),
    bookmakersMoved,
    totalBookmakers: commonBooks.length,
  };
}

/**
 * Calculate sharp confidence score (1-10) from movement data.
 *
 * @param {Array} movements - Array of movement results from detectLineMovement
 * @returns {{ score, contraindicators }}
 */
function calculateSharpConfidence(movements) {
  const contraindicators = [];
  let score = 5;

  const steamMoves = movements.filter(m => m.movementType === 'steam');
  const allMoves = movements.filter(m => m.movementType !== 'no_movement');

  if (allMoves.length === 0) {
    return { score: 1, contraindicators: ['no_signal'] };
  }

  // Steam moves boost confidence
  if (steamMoves.length >= 3) score += 3;
  else if (steamMoves.length >= 2) score += 2;
  else if (steamMoves.length >= 1) score += 1;

  // Bookmaker consensus
  const avgBooksMoved = allMoves.reduce((s, m) => s + (m.bookmakersMoved || 0), 0) / allMoves.length;
  if (avgBooksMoved >= 5) score += 1;
  else if (avgBooksMoved < 3) {
    contraindicators.push('low_bookmaker_count');
    score -= 1;
  }

  // Mixed signals (different sides)
  const sides = allMoves.map(m => m.sharpSide).filter(s => s !== 'none');
  const uniqueSides = new Set(sides);
  if (uniqueSides.size > 1) {
    contraindicators.push('mixed_signals');
    score -= 2;
  }

  // Large magnitude boosts
  const maxMagnitude = Math.max(...allMoves.map(m => m.magnitude));
  if (maxMagnitude > 0.05) score += 1;

  return {
    score: Math.min(10, Math.max(1, score)),
    contraindicators,
  };
}

/**
 * Detect reverse line movement.
 * This is when the line moves AGAINST the public but WITH sharps.
 *
 * @param {number} openingHomeOdds - Opening moneyline
 * @param {number} currentHomeOdds - Current moneyline
 * @param {string} publicSide - Which side public is on ('home' or 'away')
 * @returns {Object|null} { isReverse, sharpSide, magnitude }
 */
function detectReverseLineMovement(openingHomeOdds, currentHomeOdds, publicSide) {
  const openingProb = americanToImpliedProb(openingHomeOdds);
  const currentProb = americanToImpliedProb(currentHomeOdds);
  const movement = currentProb - openingProb; // Positive = line moving toward home

  const lineMovedToward = movement > 0.01 ? 'home' : movement < -0.01 ? 'away' : 'none';

  if (lineMovedToward === 'none') return null;

  // Reverse line movement: line moves OPPOSITE to public
  if (lineMovedToward !== publicSide) {
    return {
      isReverse: true,
      sharpSide: lineMovedToward,
      publicSide,
      magnitude: parseFloat(Math.abs(movement * 100).toFixed(1)),
    };
  }

  return null;
}

module.exports = {
  detectLineMovement,
  calculateSharpConfidence,
  detectReverseLineMovement,
};
