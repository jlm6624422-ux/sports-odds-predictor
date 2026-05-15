/**
 * Convert American odds to decimal odds
 * @param {number} american - American odds (e.g., -110, +150)
 * @returns {number} Decimal odds
 */
export function americanToDecimal(american) {
  if (american > 0) {
    return (american / 100) + 1;
  }
  return (100 / Math.abs(american)) + 1;
}

/**
 * Convert decimal odds to American odds
 * @param {number} decimal - Decimal odds (e.g., 1.91, 2.50)
 * @returns {number} American odds
 */
export function decimalToAmerican(decimal) {
  if (decimal >= 2.0) {
    return Math.round((decimal - 1) * 100);
  }
  return Math.round(-100 / (decimal - 1));
}

/**
 * Convert American odds to fractional string
 * @param {number} american - American odds
 * @returns {string} Fractional odds (e.g., "3/2", "10/11")
 */
export function americanToFractional(american) {
  const decimal = americanToDecimal(american);
  const profit = decimal - 1;

  // Find a reasonable fraction
  const tolerance = 0.01;
  for (let denom = 1; denom <= 100; denom++) {
    const numer = profit * denom;
    if (Math.abs(numer - Math.round(numer)) < tolerance) {
      return `${Math.round(numer)}/${denom}`;
    }
  }
  return `${profit.toFixed(2)}/1`;
}

/**
 * Calculate implied probability from American odds
 * @param {number} american - American odds
 * @returns {number} Implied probability (0-1)
 */
export function impliedProbability(american) {
  if (american < 0) {
    return Math.abs(american) / (Math.abs(american) + 100);
  }
  return 100 / (american + 100);
}

/**
 * Format American odds with +/- prefix
 * @param {number} odds - American odds
 * @returns {string} Formatted string
 */
export function formatOdds(odds) {
  if (odds === null || odds === undefined) return '--';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

/**
 * Format currency
 * @param {number} amount
 * @returns {string}
 */
export function formatCurrency(amount) {
  if (amount === null || amount === undefined) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/**
 * Format percentage
 * @param {number} value - Value between 0-100
 * @returns {string}
 */
export function formatPercent(value) {
  if (value === null || value === undefined) return '0%';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

/**
 * Format a date for display
 * @param {string} dateStr - ISO date string
 * @returns {string}
 */
export function formatDate(dateStr) {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Get color class based on value (positive = green, negative = red)
 * @param {number} value
 * @returns {string} Tailwind color class
 */
export function getValueColor(value) {
  if (value > 0) return 'text-green-400';
  if (value < 0) return 'text-red-400';
  return 'text-gray-400';
}
