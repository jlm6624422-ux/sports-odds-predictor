import { useState } from 'react';
import { apiPost } from '../hooks/useApi';

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL'];
const BET_TYPES = ['Moneyline', 'Spread', 'Total', 'Prop', 'Parlay', 'Teaser'];
const BOOKMAKERS = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'PointsBet', 'Other'];

function BetForm({ onBetPlaced, onCancel }) {
  const [form, setForm] = useState({
    sport: 'NFL',
    bet_type: 'Moneyline',
    selection: '',
    bookmaker: 'DraftKings',
    odds_american: '',
    stake: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        ...form,
        odds_american: parseInt(form.odds_american),
        stake: parseFloat(form.stake),
      };

      await apiPost('/bets', payload);
      onBetPlaced?.();
      setForm({
        sport: 'NFL',
        bet_type: 'Moneyline',
        selection: '',
        bookmaker: 'DraftKings',
        odds_american: '',
        stake: '',
        notes: '',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const potentialPayout = form.odds_american && form.stake
    ? (() => {
        const odds = parseInt(form.odds_american);
        const stake = parseFloat(form.stake);
        if (isNaN(odds) || isNaN(stake)) return 0;
        const decimal = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
        return (stake * decimal).toFixed(2);
      })()
    : '0.00';

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <h3 className="text-lg font-semibold text-gray-100">Log New Bet</h3>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Sport</label>
          <select
            className="input w-full"
            value={form.sport}
            onChange={(e) => handleChange('sport', e.target.value)}
          >
            {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Bet Type</label>
          <select
            className="input w-full"
            value={form.bet_type}
            onChange={(e) => handleChange('bet_type', e.target.value)}
          >
            {BET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Selection</label>
        <input
          type="text"
          className="input w-full"
          placeholder="e.g., Kansas City Chiefs -3.5"
          value={form.selection}
          onChange={(e) => handleChange('selection', e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Bookmaker</label>
          <select
            className="input w-full"
            value={form.bookmaker}
            onChange={(e) => handleChange('bookmaker', e.target.value)}
          >
            {BOOKMAKERS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Odds (American)</label>
          <input
            type="number"
            className="input w-full"
            placeholder="-110"
            value={form.odds_american}
            onChange={(e) => handleChange('odds_american', e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Stake ($)</label>
          <input
            type="number"
            step="0.01"
            className="input w-full"
            placeholder="100.00"
            value={form.stake}
            onChange={(e) => handleChange('stake', e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Notes (optional)</label>
        <input
          type="text"
          className="input w-full"
          placeholder="Any additional context..."
          value={form.notes}
          onChange={(e) => handleChange('notes', e.target.value)}
        />
      </div>

      {/* Payout Preview */}
      <div className="bg-surface-900 rounded-lg p-3 flex justify-between items-center">
        <span className="text-sm text-gray-400">Potential Payout</span>
        <span className="text-lg font-bold text-green-400">${potentialPayout}</span>
      </div>

      <div className="flex gap-3 justify-end">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        )}
        <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
          {submitting ? 'Placing...' : 'Place Bet'}
        </button>
      </div>
    </form>
  );
}

export default BetForm;
