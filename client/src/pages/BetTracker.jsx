import { useState } from 'react';
import { useApi, apiPatch, apiDelete } from '../hooks/useApi';
import BetForm from '../components/BetForm';
import StatsCard from '../components/StatsCard';
import { formatCurrency, formatOdds, formatDate } from '../utils/formatting';

const MOCK_BETS = [
  { id: 1, sport: 'NFL', bet_type: 'Spread', selection: 'Chiefs -3.5', bookmaker: 'DraftKings', odds_american: -110, odds_decimal: 1.91, stake: 100, potential_payout: 190.91, result: 'won', profit_loss: 90.91, placed_at: '2026-05-10T14:30:00Z', notes: 'Divisional matchup, Chiefs at home' },
  { id: 2, sport: 'NBA', bet_type: 'Moneyline', selection: 'Celtics ML', bookmaker: 'FanDuel', odds_american: -175, odds_decimal: 1.57, stake: 175, potential_payout: 275, result: 'won', profit_loss: 100, placed_at: '2026-05-11T18:00:00Z', notes: '' },
  { id: 3, sport: 'MLB', bet_type: 'Total', selection: 'Yankees/Astros Over 8.5', bookmaker: 'BetMGM', odds_american: -110, odds_decimal: 1.91, stake: 110, potential_payout: 210, result: 'lost', profit_loss: -110, placed_at: '2026-05-12T13:05:00Z', notes: 'Both starters struggling recently' },
  { id: 4, sport: 'NHL', bet_type: 'Moneyline', selection: 'Oilers ML', bookmaker: 'Caesars', odds_american: 140, odds_decimal: 2.40, stake: 50, potential_payout: 120, result: 'won', profit_loss: 70, placed_at: '2026-05-13T19:00:00Z', notes: 'McDavid factor' },
  { id: 5, sport: 'NFL', bet_type: 'Total', selection: 'Eagles/Cowboys Under 45.5', bookmaker: 'DraftKings', odds_american: -110, odds_decimal: 1.91, stake: 110, potential_payout: 210, result: 'pending', profit_loss: 0, placed_at: '2026-05-14T20:15:00Z', notes: '' },
  { id: 6, sport: 'NBA', bet_type: 'Spread', selection: 'Bucks +4.5', bookmaker: 'PointsBet', odds_american: -108, odds_decimal: 1.93, stake: 108, potential_payout: 208.44, result: 'pending', profit_loss: 0, placed_at: '2026-05-15T01:00:00Z', notes: 'Giannis probable' },
];

const MOCK_STATS = {
  total_bets: 47,
  total_staked: 4700,
  total_profit_loss: 823.50,
  roi: 17.5,
  win_rate: 58.3,
  wins: 28,
  losses: 19,
  pending: 3,
};

function BetTracker() {
  const [showForm, setShowForm] = useState(false);
  const [sportFilter, setSportFilter] = useState('ALL');
  const [resultFilter, setResultFilter] = useState('ALL');

  const { data: betsData, refetch: refetchBets } = useApi('/bets');
  const { data: statsData, refetch: refetchStats } = useApi('/bets/stats');

  const bets = betsData?.bets?.length > 0 ? betsData.bets : MOCK_BETS;
  const stats = statsData || MOCK_STATS;

  const filtered = bets.filter(b => {
    if (sportFilter !== 'ALL' && b.sport !== sportFilter) return false;
    if (resultFilter !== 'ALL' && b.result !== resultFilter) return false;
    return true;
  });

  const handleSettle = async (betId, result) => {
    try {
      await apiPatch(`/bets/${betId}`, { result });
      refetchBets();
      refetchStats();
    } catch (err) {
      console.error('Failed to settle bet:', err);
    }
  };

  const handleDelete = async (betId) => {
    if (!confirm('Delete this bet?')) return;
    try {
      await apiDelete(`/bets/${betId}`);
      refetchBets();
      refetchStats();
    } catch (err) {
      console.error('Failed to delete bet:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Bet Tracker</h1>
          <p className="text-gray-500 mt-1">Track your bets, analyze P/L, and monitor ROI</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary"
        >
          {showForm ? 'Close Form' : '+ New Bet'}
        </button>
      </div>

      {/* Bet Form */}
      {showForm && (
        <BetForm
          onBetPlaced={() => { refetchBets(); refetchStats(); setShowForm(false); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Net P/L" value={formatCurrency(stats.total_profit_loss)} subtitle={`${stats.total_bets} bets placed`} icon="💵" />
        <StatsCard title="ROI" value={`${stats.roi}%`} subtitle={`${formatCurrency(stats.total_staked)} staked`} icon="📊" />
        <StatsCard title="Win Rate" value={`${stats.win_rate}%`} subtitle={`${stats.wins}W - ${stats.losses}L`} icon="🏆" />
        <StatsCard title="Pending" value={stats.pending} subtitle="Bets awaiting result" icon="⏳" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-2">
          {['ALL', 'NFL', 'NBA', 'MLB', 'NHL'].map((sport) => (
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
        <div className="h-4 w-px bg-surface-700"></div>
        <div className="flex gap-2">
          {['ALL', 'pending', 'won', 'lost', 'push'].map((result) => (
            <button
              key={result}
              onClick={() => setResultFilter(result)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                resultFilter === result
                  ? 'bg-surface-700 text-gray-100'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {result}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-gray-500">{filtered.length} bets</span>
      </div>

      {/* Bets Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-700 bg-surface-900">
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Date</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Sport</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Selection</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Book</th>
              <th className="text-center py-3 px-4 text-gray-400 font-medium">Odds</th>
              <th className="text-center py-3 px-4 text-gray-400 font-medium">Stake</th>
              <th className="text-center py-3 px-4 text-gray-400 font-medium">Result</th>
              <th className="text-right py-3 px-4 text-gray-400 font-medium">P/L</th>
              <th className="text-center py-3 px-4 text-gray-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((bet) => (
              <tr key={bet.id} className="border-b border-surface-700/50 hover:bg-surface-800/50">
                <td className="py-3 px-4 text-xs text-gray-500">
                  {formatDate(bet.placed_at)}
                </td>
                <td className="py-3 px-4">
                  <span className="badge-blue text-xs">{bet.sport}</span>
                </td>
                <td className="py-3 px-4">
                  <p className="font-medium text-gray-200">{bet.selection}</p>
                  <p className="text-xs text-gray-500">{bet.bet_type}</p>
                </td>
                <td className="py-3 px-4 text-gray-400 text-xs">{bet.bookmaker}</td>
                <td className="py-3 px-4 text-center font-mono text-gray-300">
                  {formatOdds(bet.odds_american)}
                </td>
                <td className="py-3 px-4 text-center text-gray-300">
                  {formatCurrency(bet.stake)}
                </td>
                <td className="py-3 px-4 text-center">
                  <span className={`text-xs capitalize ${
                    bet.result === 'won' ? 'badge-green' :
                    bet.result === 'lost' ? 'badge-red' :
                    bet.result === 'push' ? 'badge-blue' :
                    'badge-yellow'
                  }`}>
                    {bet.result}
                  </span>
                </td>
                <td className={`py-3 px-4 text-right font-mono font-medium ${
                  bet.profit_loss > 0 ? 'text-green-400' :
                  bet.profit_loss < 0 ? 'text-red-400' : 'text-gray-500'
                }`}>
                  {bet.result === 'pending' ? '--' : formatCurrency(bet.profit_loss)}
                </td>
                <td className="py-3 px-4 text-center">
                  {bet.result === 'pending' ? (
                    <div className="flex gap-1 justify-center">
                      <button
                        onClick={() => handleSettle(bet.id, 'won')}
                        className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30"
                        title="Mark as Won"
                      >
                        W
                      </button>
                      <button
                        onClick={() => handleSettle(bet.id, 'lost')}
                        className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                        title="Mark as Lost"
                      >
                        L
                      </button>
                      <button
                        onClick={() => handleSettle(bet.id, 'push')}
                        className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                        title="Mark as Push"
                      >
                        P
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleDelete(bet.id)}
                      className="text-xs text-gray-600 hover:text-red-400"
                      title="Delete"
                    >
                      x
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default BetTracker;
