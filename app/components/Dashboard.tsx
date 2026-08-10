'use client'

import { useState, useEffect } from 'react'
import { User, DailyStats, Position, Alert, KillSwitchStatus, DisciplineMetrics } from '@/types'
import { cn } from '@/lib/utils'

interface DashboardProps {
  user: User
  dailyStats: DailyStats
  positions: Position[]
  alerts: Alert[]
  killSwitchStatus: KillSwitchStatus
  onAlertAcknowledge: (alertId: string) => void
}

export function Dashboard({ user, dailyStats, positions, alerts, killSwitchStatus, onAlertAcknowledge }: DashboardProps) {
  const [disciplineMetrics, setDisciplineMetrics] = useState<DisciplineMetrics>({
    score: dailyStats.disciplineScore,
    riskAdherence: 75,
    consistency: 60,
    emotionalControl: 55,
    overtrading: 80,
    revengeTrading: 70,
    timing: 85
  })

  const [timeUntilReset, setTimeUntilReset] = useState<string>('')

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      const endOfDay = new Date(now)
      endOfDay.setHours(23, 59, 59, 999)

      const diff = endOfDay.getTime() - now.getTime()
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

      setTimeUntilReset(`${hours}h ${minutes}m`)
    }, 60000)

    return () => clearInterval(timer)
  }, [])

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(amount)
  }

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-400'
    if (score >= 60) return 'text-yellow-400'
    return 'text-red-400'
  }

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'CRITICAL': return '🚨'
      case 'WARNING': return '⚠️'
      case 'INFO': return 'ℹ️'
      case 'SUCCESS': return '✅'
      default: return '📢'
    }
  }

  const getAlertColor = (type: string) => {
    switch (type) {
      case 'CRITICAL': return 'bg-red-50 text-red-800 border-red-200'
      case 'WARNING': return 'bg-yellow-50 text-yellow-800 border-yellow-200'
      case 'INFO': return 'bg-blue-50 text-blue-800 border-blue-200'
      case 'SUCCESS': return 'bg-green-50 text-green-800 border-green-200'
      default: return 'bg-gray-50 text-gray-800 border-gray-200'
    }
  }

  const mockDisciplineMetrics: DisciplineMetrics = {
    score: 65,
    riskAdherence: 70,
    consistency: 60,
    emotionalControl: 55,
    lastUpdated: new Date()
  }

  return (
    <div className="space-y-6">
      {/* Kill Switch Banner */}
      {killSwitchStatus.active && (
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
              <div>
                <h3 className="text-red-400 font-semibold">Kill Switch Active</h3>
                <p className="text-red-300 text-sm mt-1">
                  {killSwitchStatus.reason} • Auto-square off: {killSwitchStatus.autoSquareOff ? 'Enabled' : 'Disabled'}
                </p>
                <p className="text-red-200 text-xs mt-1">
                  Resets in: {timeUntilReset}
                </p>
              </div>
            </div>
            <button className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors">
              Emergency Override
            </button>
          </div>
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Daily P&L</p>
              <p className={cn('text-2xl font-bold mt-1', dailyStats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400')}>
                {formatCurrency(dailyStats.totalPnL)}
              </p>
            </div>
            <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center">
              <span className="text-xl">💰</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Trades Today</p>
              <p className="text-2xl font-bold text-white mt-1">{dailyStats.tradesCount}</p>
              <p className="text-slate-400 text-xs mt-1">Win Rate: {dailyStats.winRate}%</p>
            </div>
            <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center">
              <span className="text-xl">📊</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Discipline Score</p>
              <p className={cn('text-2xl font-bold mt-1', getScoreColor(disciplineMetrics.score))}>
                {disciplineMetrics.score}
              </p>
              <p className="text-slate-400 text-xs mt-1">Risk violations: {dailyStats.riskViolations}</p>
            </div>
            <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center">
              <span className="text-xl">🎯</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Max Drawdown</p>
              <p className="text-2xl font-bold text-red-400 mt-1">
                {formatCurrency(dailyStats.maxDrawdown)}
              </p>
              <p className="text-slate-400 text-xs mt-1">Risk level: High</p>
            </div>
            <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center">
              <span className="text-xl">📉</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Positions */}
        <div className="lg:col-span-2">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
            <h2 className="text-lg font-semibold text-white mb-4">Active Positions</h2>
            <div className="space-y-3">
              {positions.map((position) => (
                <div key={position.id} className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">{position.symbol}</p>
                      <p className="text-slate-400 text-sm">
                        {position.quantity} shares @ {formatCurrency(position.avgPrice)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn('font-semibold', position.pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {formatCurrency(position.pnl)}
                      </p>
                      <p className="text-slate-400 text-sm">
                        {formatCurrency(position.currentPrice)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {positions.length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  <p>No active positions</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Alerts */}
        <div className="space-y-4">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
            <h2 className="text-lg font-semibold text-white mb-4">Recent Alerts</h2>
            <div className="space-y-3">
              {alerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className={cn('border rounded-lg p-3', getAlertColor(alert.type))}
                >
                  <div className="flex items-start space-x-2">
                    <span className="text-lg">{getAlertIcon(alert.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm">{alert.message}</p>
                      <p className="text-slate-400 text-xs mt-1">
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                    {!alert.acknowledged && (
                      <button
                        onClick={() => onAlertAcknowledge?.(alert.id)}
                        className="text-slate-400 hover:text-white text-xs"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {alerts.length === 0 && (
                <div className="text-center py-4 text-slate-400">
                  <p className="text-sm">No alerts</p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
            <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
            <div className="space-y-2">
              <button className="w-full px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors">
                Emergency Stop All Trading
              </button>
              <button className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors">
                Square Off All Positions
              </button>
              <button className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors">
                View Trading Rules
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Discipline Metrics */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white mb-4">Discipline Breakdown</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-slate-700 rounded-full flex items-center justify-center mb-2">
              <span className={cn('text-xl font-bold', getScoreColor(disciplineMetrics.score))}>
                {disciplineMetrics.score}
              </span>
            </div>
            <p className="text-slate-400 text-sm">Overall Score</p>
            <p className="text-xs text-muted-foreground mt-1">Last updated: {mockDisciplineMetrics.lastUpdated.toLocaleTimeString()}</p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-slate-700 rounded-full flex items-center justify-center mb-2">
              <span className={cn('text-xl font-bold', getScoreColor(disciplineMetrics.riskAdherence))}>
                {disciplineMetrics.riskAdherence}
              </span>
            </div>
            <p className="text-slate-400 text-sm">Risk Adherence</p>
            <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
              <div className="bg-green-500 h-2 rounded-full" style={{ width: `${disciplineMetrics.riskAdherence}%` }}></div>
            </div>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-slate-700 rounded-full flex items-center justify-center mb-2">
              <span className={cn('text-xl font-bold', getScoreColor(disciplineMetrics.consistency))}>
                {disciplineMetrics.consistency}
              </span>
            </div>
            <p className="text-slate-400 text-sm">Consistency</p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-slate-700 rounded-full flex items-center justify-center mb-2">
              <span className={cn('text-xl font-bold', getScoreColor(disciplineMetrics.emotionalControl))}>
                {disciplineMetrics.emotionalControl}
              </span>
            </div>
            <p className="text-slate-400 text-sm">Emotional Control</p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-slate-700 rounded-full flex items-center justify-center mb-2">
              <span className={cn('text-xl font-bold', getScoreColor(disciplineMetrics.overtrading))}>
                {disciplineMetrics.overtrading}
              </span>
            </div>
            <p className="text-slate-400 text-sm">Overtrading Control</p>
          </div>
        </div>
      </div>
    </div>
  )
}
