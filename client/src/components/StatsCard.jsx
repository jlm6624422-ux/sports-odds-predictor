import { getValueColor } from '../utils/formatting';

function StatsCard({ title, value, subtitle, trend, icon }) {
  const trendColor = trend > 0 ? 'text-green-400' : trend < 0 ? 'text-red-400' : 'text-gray-500';

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-400 font-medium">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${typeof value === 'number' ? getValueColor(value) : 'text-gray-100'}`}>
            {typeof value === 'number' && value > 0 ? '+' : ''}{value}
          </p>
          {subtitle && (
            <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
          )}
        </div>
        {icon && (
          <span className="text-2xl opacity-60">{icon}</span>
        )}
      </div>
      {trend !== undefined && (
        <div className={`mt-3 text-sm ${trendColor}`}>
          {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} {Math.abs(trend)}% from last week
        </div>
      )}
    </div>
  );
}

export default StatsCard;
