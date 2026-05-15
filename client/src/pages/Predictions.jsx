import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { formatDate } from '../utils/formatting';

const MOCK_PREDICTIONS = [
  {
    id: 1, sport: 'NFL', home_team: 'Kansas City Chiefs', away_team: 'Buffalo Bills',
    commence_time: new Date(Date.now() + 86400000).toISOString(),
    predicted_winner: 'Kansas City Chiefs', home_win_prob: 0.62, away_win_prob: 0.38,
    confidence: 0.62, spread_prediction: -2.8, total_prediction: 49.2, model_version: 'v1.0',
  },
  {
    id: 2, sport: 'NBA', home_team: 'Boston Celtics', away_team: 'Denver Nuggets',
    commence_time: new Date(Date.now() + 172800000).toISOString(),
    predicted_winner: 'Boston Celtics', home_win_prob: 0.71, away_win_prob: 0.29,
    confidence: 0.71, spread_prediction: -5.5, total_prediction: 218.5, model_version: 'v1.0',
  },
  {
    id: 3, sport: 'MLB', home_team: 'LA Dodgers', away_team: 'Atlanta Braves',
    commence_time: new Date(Date.now() + 259200000).toISOString(),
    predicted_winner: 'LA Dodgers', home_win_prob: 0.58, away_win_prob: 0.42,
    confidence: 0.58, spread_prediction: -1.2, total_prediction: 8.5, model_version: 'v1.0',
  },
  {
    id: 4, sport: 'NCAAF', home_team: 'Ohio State Buckeyes', away_team: 'Michigan Wolverines',
    commence_time: new Date(Date.now() + 345600000).toISOString(),
    predicted_winner: 'Ohio State Buckeyes', home_win_prob: 0.55, away_win_prob: 0.45,
    confidence: 0.55, spread_prediction: -0.5, total_prediction: 5.5, model_version: 'v1.0',
  },
  {
    id: 5, sport: 'NFL', home_team: 'San Francisco 49ers', away_team: 'Detroit Lions',
    commence_time: new Date(Date.now() + 432000000).toISOString(),
    predicted_winner: 'San Francisco 49ers', home_win_prob: 0.64, away_win_prob: 0.36,
    confidence: 0.64, spread_prediction: -3.5, total_prediction: 51.0, model_version: 'v1.0',
  },
];

function getConfidenceColor(confidence) {
  if (confidence >= 0.7) return 'text-green-400';
  if (confidence >= 0.6) return 'text-yellow-400';
  return 'text-orange-400';
}

function getConfidenceBg(confidence) {
  if (confidence >= 0.7) return 'bg-green-500';
  if (confidence >= 0.6) return 'bg-yellow-500';
  return 'bg-orange-500';
}

function Predictions() {
  const [sportFilter, setSportFilter] = useState('ALL');
  const { data } = useApi('/predictions');

  const predictions = data?.predictions?.length > 0
    ? data.predictions
    : MOCK_PREDICTIONS;

  const filtered = sportFilter === 'ALL'
    ? predictions
    : predictions.filter(p => p.sport === sportFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Model Predictions</h1>
        <p className="text-gray-500 mt-1">Statistical regression predictions with confidence levels</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex gap-2">
          {['ALL', 'NFL', 'NCAAF', 'NBA', 'NCAAB', 'MLB'].map((sport) => (
            <button
              key={sport}
              onClick={() => setSportFilter(sport)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                sportFilter === sport
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {sport}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500">{filtered.length} predictions</span>
      </div>

      {/* Model Info */}
      <div className="card bg-primary-600/5 border-primary-500/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-600/20 rounded-lg flex items-center justify-center">
            <span className="text-xl">🧠</span>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-200">Logistic Regression Model v1.0</p>
            <p className="text-xs text-gray-500">
              Features: historical win rates, home/away splits, odds consensus, recent form (L10)
            </p>
          </div>
        </div>
      </div>

      {/* Predictions Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-700 bg-surface-900">
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Game</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Date</th>
              <th className="text-center py-3 px-4 text-gray-400 font-medium">Prediction</th>
              <th className="text-center py-3 px-4 text-gray-400 font-medium">Win Prob</th>
              <th className="text-center py-3 px-4 text-gray-400 font-medium">Confidence</th>
              <th className="text-center py-3 px-4 text-gray-400 font-medium">Spread</th>
              <th className="text-center py-3 px-4 text-gray-400 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((pred) => (
              <tr key={pred.id} className="border-b border-surface-700/50 hover:bg-surface-800/50">
                <td className="py-4 px-4">
                  <div className="flex items-center gap-2">
                    <span className="badge-blue text-xs">{pred.sport}</span>
                    <div>
                      <p className="font-medium text-gray-200">{pred.away_team}</p>
                      <p className="text-xs text-gray-500">@ {pred.home_team}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-4 text-gray-400 text-xs">
                  {formatDate(pred.commence_time)}
                </td>
                <td className="py-4 px-4 text-center">
                  <span className="font-medium text-primary-400">{pred.predicted_winner}</span>
                </td>
                <td className="py-4 px-4 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex gap-1 text-xs">
                      <span className="text-gray-400">H: {(pred.home_win_prob * 100).toFixed(0)}%</span>
                      <span className="text-gray-600">|</span>
                      <span className="text-gray-400">A: {(pred.away_win_prob * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-4 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <span className={`font-mono font-medium ${getConfidenceColor(pred.confidence)}`}>
                      {(pred.confidence * 100).toFixed(0)}%
                    </span>
                    <div className="w-16 bg-surface-900 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${getConfidenceBg(pred.confidence)}`}
                        style={{ width: `${pred.confidence * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-4 text-center font-mono text-gray-300">
                  {pred.spread_prediction > 0 ? '+' : ''}{pred.spread_prediction?.toFixed(1) || '--'}
                </td>
                <td className="py-4 px-4 text-center font-mono text-gray-300">
                  {pred.total_prediction?.toFixed(1) || '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span>High confidence (70%+)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
          <span>Medium confidence (60-70%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-orange-500"></div>
          <span>Low confidence (&lt;60%)</span>
        </div>
      </div>
    </div>
  );
}

export default Predictions;
