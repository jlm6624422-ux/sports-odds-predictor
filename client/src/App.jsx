import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import OddsComparison from './pages/OddsComparison';
import Predictions from './pages/Predictions';
import BetTracker from './pages/BetTracker';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/odds', label: 'Odds', icon: '📈' },
  { path: '/predictions', label: 'Predictions', icon: '🎯' },
  { path: '/bets', label: 'Bet Tracker', icon: '💰' },
];

function App() {
  return (
    <Router>
      <div className="min-h-screen flex">
        {/* Sidebar */}
        <aside className="w-64 bg-surface-900 border-r border-surface-700 flex flex-col fixed h-full">
          <div className="p-6 border-b border-surface-700">
            <h1 className="text-xl font-bold text-primary-400">
              Sports Odds
            </h1>
            <p className="text-sm text-gray-500 mt-1">Predictor & Tracker</p>
          </div>

          <nav className="flex-1 p-4 space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-surface-800'
                  }`
                }
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="p-4 border-t border-surface-700">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              All services running
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 ml-64 p-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/odds" element={<OddsComparison />} />
            <Route path="/predictions" element={<Predictions />} />
            <Route path="/bets" element={<BetTracker />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
