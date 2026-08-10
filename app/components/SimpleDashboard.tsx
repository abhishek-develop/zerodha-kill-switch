'use client'

import { User, DailyStats, Position, Alert, KillSwitchStatus } from '@/types'

interface SimpleDashboardProps {
  user: User
  dailyStats: DailyStats
  positions: Position[]
  alerts: Alert[]
  killSwitchStatus: KillSwitchStatus
  onAlertAcknowledge?: (alertId: string) => void
}

export function SimpleDashboard({ user, dailyStats, positions, alerts, killSwitchStatus, onAlertAcknowledge }: SimpleDashboardProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(value)
  }

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  }

  return (
    <div className="space-y-6">
      {/* Kill Switch Status */}
      {!killSwitchStatus.active && (
        <div className="kite-card bg-green-50 border-green-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <div>
                <h3 className="text-green-800 font-medium">Trading Active</h3>
                <p className="text-green-600 text-sm">All systems operational - Risk protections active</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-green-800 text-sm font-medium">Daily Loss: {formatCurrency(killSwitchStatus.currentLoss)}/{formatCurrency(killSwitchStatus.dailyLossLimit)}</p>
              <p className="text-green-600 text-xs">Auto-trigger: {killSwitchStatus.autoTriggerEnabled ? 'Enabled' : 'Disabled'}</p>
            </div>
          </div>
        </div>
      )}

      {killSwitchStatus.active && (
        <div className="kite-card bg-red-50 border-red-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
              <div>
                <h3 className="text-red-800 font-medium">Trading Halted</h3>
                <p className="text-red-600 text-sm">{killSwitchStatus.reason}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-red-800 text-sm font-medium">Triggered: {killSwitchStatus.triggeredAt?.toLocaleTimeString()}</p>
              <p className="text-red-600 text-xs">Contact support if needed</p>
            </div>
          </div>
        </div>
      )}

      {/* Core Risk Management Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="kite-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground text-sm">Daily Loss Limit</span>
            <span className={`text-lg font-bold ${killSwitchStatus.currentLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(killSwitchStatus.currentLoss)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mb-2">
            of {formatCurrency(killSwitchStatus.dailyLossLimit)} limit
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${killSwitchStatus.currentLoss > killSwitchStatus.dailyLossLimit * 0.8 ? 'bg-red-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min((killSwitchStatus.currentLoss / killSwitchStatus.dailyLossLimit) * 100, 100)}%` }}
            ></div>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {((killSwitchStatus.currentLoss / killSwitchStatus.dailyLossLimit) * 100).toFixed(1)}% used
          </div>
        </div>

        <div className="kite-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground text-sm">Trades Today</span>
            <span className="text-lg font-bold text-blue-600">{dailyStats.totalTrades}</span>
          </div>
          <div className="text-xs text-muted-foreground mb-2">
            Max allowed: 20 trades
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${dailyStats.totalTrades > 15 ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${(dailyStats.totalTrades / 20) * 100}%` }}
            ></div>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {20 - dailyStats.totalTrades} trades remaining
          </div>
        </div>

        <div className="kite-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground text-sm">Max Drawdown</span>
            <span className={`text-lg font-bold ${dailyStats.maxDrawdown >= -5000 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(dailyStats.maxDrawdown)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mb-2">
            Protection: {formatCurrency(5000)}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${dailyStats.maxDrawdown < -4000 ? 'bg-red-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min((Math.abs(dailyStats.maxDrawdown) / 5000) * 100, 100)}%` }}
            ></div>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {dailyStats.maxDrawdown >= -5000 ? 'Safe' : 'Near Limit'}
          </div>
        </div>
      </div>

      {/* Today's Performance Summary */}
      <div className="kite-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Today's Performance</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className={`text-2xl font-bold ${dailyStats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(dailyStats.totalPnL)}
            </div>
            <div className="text-sm text-muted-foreground">Total P&L</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{dailyStats.totalTrades}</div>
            <div className="text-sm text-muted-foreground">Total Trades</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{formatPercent(dailyStats.winRate)}</div>
            <div className="text-sm text-muted-foreground">Win Rate</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{positions.length}</div>
            <div className="text-sm text-muted-foreground">Active Positions</div>
          </div>
        </div>
      </div>

      {/* Active Positions */}
      {positions.length > 0 && (
        <div className="kite-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Active Positions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Symbol</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Type</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium">Qty</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium">Avg Price</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium">Current</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium">P&L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={position.id} className="border-b border-border">
                    <td className="py-3 px-4 text-foreground font-medium">{position.symbol}</td>
                    <td className="py-3 px-4">
                      <span className={`kite-badge ${
                        position.type === 'long' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {position.type.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-foreground">{position.quantity}</td>
                    <td className="py-3 px-4 text-right text-foreground">{formatCurrency(position.avgPrice)}</td>
                    <td className="py-3 px-4 text-right text-foreground">{formatCurrency(position.currentPrice)}</td>
                    <td className="py-3 px-4 text-right">
                      <div className={`font-medium ${position.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(position.pnl)}
                      </div>
                      <div className={`text-xs ${position.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatPercent(position.pnlPercentage)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Risk Alerts */}
      {alerts.length > 0 && (
        <div className="kite-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Risk Alerts</h2>
          <div className="space-y-3">
            {alerts.slice(0, 3).map((alert) => (
              <div key={alert.id} className="p-3 rounded-lg border border-yellow-200 bg-yellow-50">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <span className="text-lg">⚠️</span>
                    <div>
                      <h4 className="font-medium text-yellow-800 mb-1">{alert.title}</h4>
                      <p className="text-sm text-yellow-700">{alert.message}</p>
                      <p className="text-xs text-yellow-600 mt-1">
                        {alert.timestamp.toLocaleTimeString()} • {alert.timestamp.toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {!alert.read && (
                    <button
                      onClick={() => onAlertAcknowledge?.(alert.id)}
                      className="text-xs px-2 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded transition-colors"
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
