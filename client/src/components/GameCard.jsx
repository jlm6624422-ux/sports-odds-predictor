import { formatDate, formatOdds, impliedProbability } from '../utils/formatting';

function GameCard({ game, showPrediction = false }) {
  const bestHomeOdds = game.bookmakers?.reduce((best, bm) => {
    const h2h = bm.markets?.find(m => m.key === 'h2h');
    const homeOdds = h2h?.outcomes?.find(o => o.name === game.home_team)?.price;
    if (homeOdds && (!best || homeOdds > best)) return homeOdds;
    return best;
  }, null);

  const bestAwayOdds = game.bookmakers?.reduce((best, bm) => {
    const h2h = bm.markets?.find(m => m.key === 'h2h');
    const awayOdds = h2h?.outcomes?.find(o => o.name === game.away_team)?.price;
    if (awayOdds && (!best || awayOdds > best)) return awayOdds;
    return best;
  }, null);

  return (
    <div className="card hover:border-primary-500/40 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="badge-blue">{game.sport_title || game.sport}</span>
        <span className="text-xs text-gray-500">{formatDate(game.commence_time)}</span>
      </div>

      <div className="space-y-3">
        {/* Away Team */}
        <div className="flex items-center justify-between">
          <span className="font-medium text-gray-200">{game.away_team}</span>
          <span className="font-mono text-sm text-gray-300">
            {formatOdds(bestAwayOdds)}
          </span>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-surface-700"></div>
          <span className="text-xs text-gray-600">VS</span>
          <div className="flex-1 h-px bg-surface-700"></div>
        </div>

        {/* Home Team */}
        <div className="flex items-center justify-between">
          <span className="font-medium text-gray-200">{game.home_team}</span>
          <span className="font-mono text-sm text-gray-300">
            {formatOdds(bestHomeOdds)}
          </span>
        </div>
      </div>

      {showPrediction && game.prediction && (
        <div className="mt-4 pt-3 border-t border-surface-700">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Model Pick</span>
            <span className="text-sm font-medium text-primary-400">
              {game.prediction.predicted_winner}
            </span>
          </div>
          <div className="mt-2 w-full bg-surface-900 rounded-full h-2">
            <div
              className="bg-primary-500 h-2 rounded-full transition-all"
              style={{ width: `${(game.prediction.confidence || 0.5) * 100}%` }}
            ></div>
          </div>
          <p className="text-xs text-gray-500 mt-1 text-right">
            {((game.prediction.confidence || 0.5) * 100).toFixed(0)}% confidence
          </p>
        </div>
      )}

      {bestHomeOdds && (
        <div className="mt-4 pt-3 border-t border-surface-700 flex justify-between text-xs text-gray-500">
          <span>Implied: {(impliedProbability(bestHomeOdds) * 100).toFixed(0)}% / {(impliedProbability(bestAwayOdds) * 100).toFixed(0)}%</span>
          <span>{game.bookmakers?.length || 0} books</span>
        </div>
      )}
    </div>
  );
}

export default GameCard;
