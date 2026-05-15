import { formatOdds } from '../utils/formatting';

function OddsTable({ game }) {
  if (!game || !game.bookmakers) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-700">
            <th className="text-left py-3 px-4 text-gray-400 font-medium">Bookmaker</th>
            <th className="text-center py-3 px-4 text-gray-400 font-medium">{game.home_team}</th>
            <th className="text-center py-3 px-4 text-gray-400 font-medium">{game.away_team}</th>
            <th className="text-center py-3 px-4 text-gray-400 font-medium">Spread</th>
            <th className="text-center py-3 px-4 text-gray-400 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {game.bookmakers.map((bookmaker) => {
            const h2h = bookmaker.markets?.find(m => m.key === 'h2h');
            const spreads = bookmaker.markets?.find(m => m.key === 'spreads');
            const totals = bookmaker.markets?.find(m => m.key === 'totals');

            const homeOdds = h2h?.outcomes?.find(o => o.name === game.home_team)?.price;
            const awayOdds = h2h?.outcomes?.find(o => o.name === game.away_team)?.price;
            const homeSpread = spreads?.outcomes?.find(o => o.name === game.home_team);
            const totalOver = totals?.outcomes?.find(o => o.name === 'Over');

            // Highlight best odds
            const allHomeOdds = game.bookmakers.map(bm => {
              const m = bm.markets?.find(m => m.key === 'h2h');
              return m?.outcomes?.find(o => o.name === game.home_team)?.price;
            }).filter(Boolean);
            const allAwayOdds = game.bookmakers.map(bm => {
              const m = bm.markets?.find(m => m.key === 'h2h');
              return m?.outcomes?.find(o => o.name === game.away_team)?.price;
            }).filter(Boolean);

            const isBestHome = homeOdds === Math.max(...allHomeOdds);
            const isBestAway = awayOdds === Math.max(...allAwayOdds);

            return (
              <tr key={bookmaker.key} className="border-b border-surface-700/50 hover:bg-surface-800/50">
                <td className="py-3 px-4 font-medium text-gray-300">{bookmaker.title}</td>
                <td className={`text-center py-3 px-4 font-mono ${isBestHome ? 'text-green-400 font-bold' : 'text-gray-300'}`}>
                  {formatOdds(homeOdds)}
                </td>
                <td className={`text-center py-3 px-4 font-mono ${isBestAway ? 'text-green-400 font-bold' : 'text-gray-300'}`}>
                  {formatOdds(awayOdds)}
                </td>
                <td className="text-center py-3 px-4 font-mono text-gray-300">
                  {homeSpread ? `${homeSpread.point > 0 ? '+' : ''}${homeSpread.point} (${formatOdds(homeSpread.price)})` : '--'}
                </td>
                <td className="text-center py-3 px-4 font-mono text-gray-300">
                  {totalOver ? `O ${totalOver.point} (${formatOdds(totalOver.price)})` : '--'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default OddsTable;
