import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import OddsTable from '../components/OddsTable';
import GameCard from '../components/GameCard';
import { formatDate } from '../utils/formatting';

const SPORTS = ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'MLB'];

// Placeholder data that renders before API is connected
const MOCK_GAMES = {
  NFL: [
    {
      id: 'nfl_1', sport_title: 'NFL', home_team: 'Kansas City Chiefs', away_team: 'Buffalo Bills',
      commence_time: new Date(Date.now() + 86400000).toISOString(),
      bookmakers: [
        { key: 'draftkings', title: 'DraftKings', markets: [
          { key: 'h2h', outcomes: [{ name: 'Kansas City Chiefs', price: -145 }, { name: 'Buffalo Bills', price: 125 }] },
          { key: 'spreads', outcomes: [{ name: 'Kansas City Chiefs', price: -110, point: -2.5 }, { name: 'Buffalo Bills', price: -110, point: 2.5 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 49.5 }, { name: 'Under', price: -110, point: 49.5 }] },
        ]},
        { key: 'fanduel', title: 'FanDuel', markets: [
          { key: 'h2h', outcomes: [{ name: 'Kansas City Chiefs', price: -140 }, { name: 'Buffalo Bills', price: 120 }] },
          { key: 'spreads', outcomes: [{ name: 'Kansas City Chiefs', price: -108, point: -2.5 }, { name: 'Buffalo Bills', price: -112, point: 2.5 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -108, point: 49.5 }, { name: 'Under', price: -112, point: 49.5 }] },
        ]},
        { key: 'betmgm', title: 'BetMGM', markets: [
          { key: 'h2h', outcomes: [{ name: 'Kansas City Chiefs', price: -150 }, { name: 'Buffalo Bills', price: 130 }] },
          { key: 'spreads', outcomes: [{ name: 'Kansas City Chiefs', price: -110, point: -3 }, { name: 'Buffalo Bills', price: -110, point: 3 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -105, point: 50 }, { name: 'Under', price: -115, point: 50 }] },
        ]},
        { key: 'caesars', title: 'Caesars', markets: [
          { key: 'h2h', outcomes: [{ name: 'Kansas City Chiefs', price: -142 }, { name: 'Buffalo Bills', price: 122 }] },
          { key: 'spreads', outcomes: [{ name: 'Kansas City Chiefs', price: -110, point: -2.5 }, { name: 'Buffalo Bills', price: -110, point: 2.5 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 49.5 }, { name: 'Under', price: -110, point: 49.5 }] },
        ]},
        { key: 'pointsbet', title: 'PointsBet', markets: [
          { key: 'h2h', outcomes: [{ name: 'Kansas City Chiefs', price: -138 }, { name: 'Buffalo Bills', price: 118 }] },
          { key: 'spreads', outcomes: [{ name: 'Kansas City Chiefs', price: -105, point: -2.5 }, { name: 'Buffalo Bills', price: -115, point: 2.5 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 49 }, { name: 'Under', price: -110, point: 49 }] },
        ]},
      ],
    },
    {
      id: 'nfl_2', sport_title: 'NFL', home_team: 'Philadelphia Eagles', away_team: 'Dallas Cowboys',
      commence_time: new Date(Date.now() + 172800000).toISOString(),
      bookmakers: [
        { key: 'draftkings', title: 'DraftKings', markets: [
          { key: 'h2h', outcomes: [{ name: 'Philadelphia Eagles', price: -200 }, { name: 'Dallas Cowboys', price: 170 }] },
          { key: 'spreads', outcomes: [{ name: 'Philadelphia Eagles', price: -110, point: -4.5 }, { name: 'Dallas Cowboys', price: -110, point: 4.5 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 45.5 }, { name: 'Under', price: -110, point: 45.5 }] },
        ]},
        { key: 'fanduel', title: 'FanDuel', markets: [
          { key: 'h2h', outcomes: [{ name: 'Philadelphia Eagles', price: -195 }, { name: 'Dallas Cowboys', price: 165 }] },
          { key: 'spreads', outcomes: [{ name: 'Philadelphia Eagles', price: -112, point: -4.5 }, { name: 'Dallas Cowboys', price: -108, point: 4.5 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -112, point: 45.5 }, { name: 'Under', price: -108, point: 45.5 }] },
        ]},
        { key: 'betmgm', title: 'BetMGM', markets: [
          { key: 'h2h', outcomes: [{ name: 'Philadelphia Eagles', price: -190 }, { name: 'Dallas Cowboys', price: 160 }] },
          { key: 'spreads', outcomes: [{ name: 'Philadelphia Eagles', price: -110, point: -4 }, { name: 'Dallas Cowboys', price: -110, point: 4 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 46 }, { name: 'Under', price: -110, point: 46 }] },
        ]},
        { key: 'caesars', title: 'Caesars', markets: [
          { key: 'h2h', outcomes: [{ name: 'Philadelphia Eagles', price: -205 }, { name: 'Dallas Cowboys', price: 175 }] },
          { key: 'spreads', outcomes: [{ name: 'Philadelphia Eagles', price: -110, point: -4.5 }, { name: 'Dallas Cowboys', price: -110, point: 4.5 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -108, point: 45.5 }, { name: 'Under', price: -112, point: 45.5 }] },
        ]},
      ],
    },
  ],
};

function OddsComparison() {
  const [selectedSport, setSelectedSport] = useState('NFL');
  const [selectedGame, setSelectedGame] = useState(null);

  const { data, loading, error } = useApi(`/odds/${selectedSport}`);
  const games = data?.data || MOCK_GAMES[selectedSport] || MOCK_GAMES.NFL;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Odds Comparison</h1>
          <p className="text-gray-500 mt-1">Compare lines across sportsbooks to find the best value</p>
        </div>
        {data?.source === 'mock' && (
          <span className="badge-yellow">Mock Data</span>
        )}
      </div>

      {/* Sport Tabs */}
      <div className="flex gap-2">
        {SPORTS.map((sport) => (
          <button
            key={sport}
            onClick={() => { setSelectedSport(sport); setSelectedGame(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedSport === sport
                ? 'bg-primary-600 text-white'
                : 'bg-surface-800 text-gray-400 hover:text-gray-200 hover:bg-surface-700'
            }`}
          >
            {sport}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
        </div>
      )}

      {error && !games.length && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          Error loading odds: {error}
        </div>
      )}

      {/* Games Grid */}
      {!selectedGame && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {games.map((game) => (
            <div key={game.id} onClick={() => setSelectedGame(game)} className="cursor-pointer">
              <GameCard game={game} />
            </div>
          ))}
        </div>
      )}

      {/* Expanded Odds Table */}
      {selectedGame && (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedGame(null)}
            className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1"
          >
            &larr; Back to all games
          </button>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">
                  {selectedGame.away_team} @ {selectedGame.home_team}
                </h2>
                <p className="text-sm text-gray-500">{formatDate(selectedGame.commence_time)}</p>
              </div>
              <span className="badge-blue">{selectedGame.sport_title || selectedSport}</span>
            </div>

            <OddsTable game={selectedGame} />
          </div>

          {/* Best Line Summary */}
          <div className="card">
            <h3 className="text-sm font-medium text-gray-400 mb-3">Best Available Lines</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-surface-900 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500">Best Moneyline (Home)</p>
                <p className="text-lg font-bold text-green-400 mt-1">
                  {(() => {
                    const best = selectedGame.bookmakers?.reduce((best, bm) => {
                      const h2h = bm.markets?.find(m => m.key === 'h2h');
                      const price = h2h?.outcomes?.find(o => o.name === selectedGame.home_team)?.price;
                      if (price && (!best.price || price > best.price)) return { price, book: bm.title };
                      return best;
                    }, { price: null, book: '' });
                    return best.price ? `${best.price > 0 ? '+' : ''}${best.price}` : '--';
                  })()}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {selectedGame.bookmakers?.reduce((best, bm) => {
                    const h2h = bm.markets?.find(m => m.key === 'h2h');
                    const price = h2h?.outcomes?.find(o => o.name === selectedGame.home_team)?.price;
                    if (price && (!best.price || price > best.price)) return { price, book: bm.title };
                    return best;
                  }, { price: null, book: '' }).book}
                </p>
              </div>
              <div className="bg-surface-900 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500">Best Moneyline (Away)</p>
                <p className="text-lg font-bold text-green-400 mt-1">
                  {(() => {
                    const best = selectedGame.bookmakers?.reduce((best, bm) => {
                      const h2h = bm.markets?.find(m => m.key === 'h2h');
                      const price = h2h?.outcomes?.find(o => o.name === selectedGame.away_team)?.price;
                      if (price && (!best.price || price > best.price)) return { price, book: bm.title };
                      return best;
                    }, { price: null, book: '' });
                    return best.price ? `${best.price > 0 ? '+' : ''}${best.price}` : '--';
                  })()}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {selectedGame.bookmakers?.reduce((best, bm) => {
                    const h2h = bm.markets?.find(m => m.key === 'h2h');
                    const price = h2h?.outcomes?.find(o => o.name === selectedGame.away_team)?.price;
                    if (price && (!best.price || price > best.price)) return { price, book: bm.title };
                    return best;
                  }, { price: null, book: '' }).book}
                </p>
              </div>
              <div className="bg-surface-900 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500">Books Compared</p>
                <p className="text-lg font-bold text-gray-200 mt-1">{selectedGame.bookmakers?.length || 0}</p>
                <p className="text-xs text-gray-600 mt-1">sportsbooks</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OddsComparison;
