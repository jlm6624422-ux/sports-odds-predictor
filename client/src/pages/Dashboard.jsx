import { useState } from 'react';
import StatsCard from '../components/StatsCard';
import GameCard from '../components/GameCard';
import { useApi } from '../hooks/useApi';
import { formatCurrency, formatPercent } from '../utils/formatting';

// Placeholder data for initial render
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

const MOCK_UPCOMING = [
  {
    id: 'mock_1',
    sport_title: 'NFL',
    home_team: 'Kansas City Chiefs',
    away_team: 'Buffalo Bills',
    commence_time: new Date(Date.now() + 86400000).toISOString(),
    bookmakers: [
      { key: 'dk', title: 'DraftKings', markets: [{ key: 'h2h', outcomes: [{ name: 'Kansas City Chiefs', price: -145 }, { name: 'Buffalo Bills', price: 125 }] }] },
      { key: 'fd', title: 'FanDuel', markets: [{ key: 'h2h', outcomes: [{ name: 'Kansas City Chiefs', price: -140 }, { name: 'Buffalo Bills', price: 120 }] }] },
    ],
    prediction: { predicted_winner: 'Kansas City Chiefs', confidence: 0.62 },
  },
  {
    id: 'mock_2',
    sport_title: 'NBA',
    home_team: 'Boston Celtics',
    away_team: 'Denver Nuggets',
    commence_time: new Date(Date.now() + 172800000).toISOString(),
    bookmakers: [
      { key: 'dk', title: 'DraftKings', markets: [{ key: 'h2h', outcomes: [{ name: 'Boston Celtics', price: -180 }, { name: 'Denver Nuggets', price: 155 }] }] },
      { key: 'fd', title: 'FanDuel', markets: [{ key: 'h2h', outcomes: [{ name: 'Boston Celtics', price: -175 }, { name: 'Denver Nuggets', price: 150 }] }] },
    ],
    prediction: { predicted_winner: 'Boston Celtics', confidence: 0.71 },
  },
  {
    id: 'mock_3',
    sport_title: 'MLB',
    home_team: 'LA Dodgers',
    away_team: 'Atlanta Braves',
    commence_time: new Date(Date.now() + 259200000).toISOString(),
    bookmakers: [
      { key: 'dk', title: 'DraftKings', markets: [{ key: 'h2h', outcomes: [{ name: 'LA Dodgers', price: -130 }, { name: 'Atlanta Braves', price: 110 }] }] },
      { key: 'mgm', title: 'BetMGM', markets: [{ key: 'h2h', outcomes: [{ name: 'LA Dodgers', price: -125 }, { name: 'Atlanta Braves', price: 105 }] }] },
    ],
    prediction: { predicted_winner: 'LA Dodgers', confidence: 0.55 },
  },
];

const MOCK_RECENT_BETS = [
  { id: 1, sport: 'NFL', selection: 'Chiefs -3.5', odds_american: -110, stake: 100, result: 'won', profit_loss: 90.91 },
  { id: 2, sport: 'NBA', selection: 'Celtics ML', odds_american: -175, stake: 175, result: 'won', profit_loss: 100 },
  { id: 3, sport: 'MLB', selection: 'Yankees +1.5', odds_american: -130, stake: 130, result: 'lost', profit_loss: -130 },
  { id: 4, sport: 'NCAAF', selection: 'Ohio State -7', odds_american: -110, stake: 110, result: 'won', profit_loss: 100 },
  { id: 5, sport: 'NFL', selection: 'Eagles/Cowboys Over 48.5', odds_american: -110, stake: 110, result: 'pending', profit_loss: 0 },
];

function Dashboard() {
  const { data: statsData } = useApi('/bets/stats');
  const stats = statsData || MOCK_STATS;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Dashboard</h1>
        <p className="text-gray-500 mt-1">Your sports betting analytics at a glance</p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total ROI"
          value={`${stats.roi}%`}
          subtitle={`${stats.wins}W - ${stats.losses}L`}
          trend={3.2}
          icon="📈"
        />
        <StatsCard
          title="Net Profit"
          value={formatCurrency(stats.total_profit_loss)}
          subtitle={`From ${formatCurrency(stats.total_staked)} staked`}
          trend={8.5}
          icon="💰"
        />
        <StatsCard
          title="Win Rate"
          value={`${stats.win_rate}%`}
          subtitle={`${stats.total_bets} total bets`}
          trend={1.8}
          icon="🎯"
        />
        <StatsCard
          title="Pending Bets"
          value={stats.pending}
          subtitle="Awaiting results"
          icon="⏳"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Games with Predictions */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-200">Upcoming Games</h2>
            <span className="text-xs text-gray-500">With model predictions</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MOCK_UPCOMING.map((game) => (
              <GameCard key={game.id} game={game} showPrediction={true} />
            ))}
          </div>
        </div>

        {/* Recent Bets */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-200">Recent Bets</h2>
          <div className="card p-0 divide-y divide-surface-700">
            {MOCK_RECENT_BETS.map((bet) => (
              <div key={bet.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-500">{bet.sport}</span>
                    <span className={`text-xs ${
                      bet.result === 'won' ? 'badge-green' :
                      bet.result === 'lost' ? 'badge-red' : 'badge-yellow'
                    }`}>
                      {bet.result}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-200 mt-1">{bet.selection}</p>
                  <p className="text-xs text-gray-500">
                    {bet.odds_american > 0 ? '+' : ''}{bet.odds_american} | ${bet.stake}
                  </p>
                </div>
                <span className={`font-mono text-sm font-medium ${
                  bet.profit_loss > 0 ? 'text-green-400' :
                  bet.profit_loss < 0 ? 'text-red-400' : 'text-gray-500'
                }`}>
                  {bet.profit_loss > 0 ? '+' : ''}{bet.profit_loss === 0 ? '--' : formatCurrency(bet.profit_loss)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sport Breakdown */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Performance by Sport</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { sport: 'NFL', record: '12-8', roi: '+22.4%', color: 'text-green-400' },
            { sport: 'NBA', record: '9-6', roi: '+14.2%', color: 'text-green-400' },
            { sport: 'MLB', record: '4-3', roi: '+8.1%', color: 'text-green-400' },
            { sport: 'NHL', record: '3-2', roi: '-5.3%', color: 'text-red-400' },
          ].map((item) => (
            <div key={item.sport} className="bg-surface-900 rounded-lg p-4 text-center">
              <p className="text-sm text-gray-500">{item.sport}</p>
              <p className="text-lg font-bold text-gray-200 mt-1">{item.record}</p>
              <p className={`text-sm font-medium mt-1 ${item.color}`}>{item.roi}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
