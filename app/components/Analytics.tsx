'use client'

import { useState } from 'react'
import { DailyStats, DisciplineMetrics } from '@/types'
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

export function Analytics() {
  const [timeRange, setTimeRange] = useState('7d')
  const [selectedMetric, setSelectedMetric] = useState('pnl')

  // Mock data for charts
  const pnlData = [
    { date: 'Mon', pnl: 1200, trades: 8 },
    { date: 'Tue', pnl: -800, trades: 12 },
    { date: 'Wed', pnl: 2300, trades: 6 },
    { date: 'Thu', pnl: -1500, trades: 15 },
    { date: 'Fri', pnl: 900, trades: 9 },
    { date: 'Sat', pnl: 0, trades: 0 },
    { date: 'Sun', pnl: 0, trades: 0 }
  ]

  const disciplineData = [
    { date: 'Mon', score: 72, riskAdherence: 85, consistency: 65, emotionalControl: 70 },
    { date: 'Tue', score: 58, riskAdherence: 60, consistency: 55, emotionalControl: 50 },
    { date: 'Wed', score: 85, riskAdherence: 90, consistency: 80, emotionalControl: 85 },
    { date: 'Thu', score: 45, riskAdherence: 40, consistency: 35, emotionalControl: 45 },
    { date: 'Fri', score: 68, riskAdherence: 75, consistency: 60, emotionalControl: 65 }
  ]

  const riskDistribution = [
    { name: 'Low Risk', value: 35, color: '#10b981' },
    { name: 'Medium Risk', value: 45, color: '#f59e0b' },
    { name: 'High Risk', value: 20, color: '#ef4444' }
  ]

  const tradingHours = [
    { hour: '9:00', trades: 2, pnl: 500 },
    { hour: '10:00', trades: 3, pnl: 800 },
    { hour: '11:00', trades: 5, pnl: -200 },
    { hour: '12:00', trades: 1, pnl: 300 },
    { hour: '1:00', trades: 4, pnl: -600 },
    { hour: '2:00', trades: 2, pnl: 400 },
    { hour: '3:00', trades: 3, pnl: 200 }
  ]

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(value)
  }

  const timeRanges = [
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
    { value: '1y', label: '1 Year' }
  ]

  const metrics = [
    { value: 'pnl', label: 'P&L' },
    { value: 'trades', label: 'Trades' },
    { value: 'discipline', label: 'Discipline' },
    { value: 'risk', label: 'Risk' }
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">Trading Analytics</h2>
          <div className="flex space-x-4">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {timeRanges.map(range => (
                <option key={range.value} value={range.value}>{range.label}</option>
              ))}
            </select>
            <select
              value={selectedMetric}
              onChange={(e) => setSelectedMetric(e.target.value)}
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {metrics.map(metric => (
                <option key={metric.value} value={metric.value}>{metric.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <p className="text-slate-400 text-sm mb-1">Total P&L</p>
            <p className="text-2xl font-bold text-green-400">₹2,100</p>
            <p className="text-xs text-slate-400 mt-1">+12.5% vs last period</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <p className="text-slate-400 text-sm mb-1">Win Rate</p>
            <p className="text-2xl font-bold text-white">62.5%</p>
            <p className="text-xs text-slate-400 mt-1">40 wins / 64 trades</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <p className="text-slate-400 text-sm mb-1">Avg Discipline Score</p>
            <p className="text-2xl font-bold text-yellow-400">65.6</p>
            <p className="text-xs text-slate-400 mt-1">-2.3 vs last period</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <p className="text-slate-400 text-sm mb-1">Risk Violations</p>
            <p className="text-2xl font-bold text-red-400">8</p>
            <p className="text-xs text-slate-400 mt-1">+3 vs last period</p>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* P&L Chart */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
          <h3 className="text-white font-medium mb-4">Daily P&L Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={pnlData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis dataKey="date" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Area
                type="monotone"
                dataKey="pnl"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Discipline Score Chart */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
          <h3 className="text-white font-medium mb-4">Discipline Metrics</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={disciplineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis dataKey="date" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Legend />
              <Line type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2} />
              <Line type="monotone" dataKey="riskAdherence" stroke="#10b981" strokeWidth={2} />
              <Line type="monotone" dataKey="consistency" stroke="#f59e0b" strokeWidth={2} />
              <Line type="monotone" dataKey="emotionalControl" stroke="#ef4444" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Risk Distribution */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
          <h3 className="text-white font-medium mb-4">Risk Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={riskDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name}: ${value}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {riskDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Trading Hours Analysis */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
          <h3 className="text-white font-medium mb-4">Trading Hours Analysis</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={tradingHours}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis dataKey="hour" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Legend />
              <Bar dataKey="trades" fill="#3b82f6" />
              <Bar dataKey="pnl" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed Analytics Table */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
        <h3 className="text-white font-medium mb-4">Performance Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-600">
                <th className="text-left py-3 px-4 text-slate-400">Metric</th>
                <th className="text-right py-3 px-4 text-slate-400">Current Period</th>
                <th className="text-right py-3 px-4 text-slate-400">Previous Period</th>
                <th className="text-right py-3 px-4 text-slate-400">Change</th>
                <th className="text-right py-3 px-4 text-slate-400">Trend</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-700">
                <td className="py-3 px-4 text-white">Total P&L</td>
                <td className="text-right py-3 px-4 text-green-400">₹2,100</td>
                <td className="text-right py-3 px-4 text-slate-300">₹1,800</td>
                <td className="text-right py-3 px-4 text-green-400">+₹300</td>
                <td className="text-right py-3 px-4">📈</td>
              </tr>
              <tr className="border-b border-slate-700">
                <td className="py-3 px-4 text-white">Win Rate</td>
                <td className="text-right py-3 px-4 text-white">62.5%</td>
                <td className="text-right py-3 px-4 text-slate-300">58.2%</td>
                <td className="text-right py-3 px-4 text-green-400">+4.3%</td>
                <td className="text-right py-3 px-4">📈</td>
              </tr>
              <tr className="border-b border-slate-700">
                <td className="py-3 px-4 text-white">Avg Trade Size</td>
                <td className="text-right py-3 px-4 text-white">₹45,000</td>
                <td className="text-right py-3 px-4 text-slate-300">₹52,000</td>
                <td className="text-right py-3 px-4 text-red-400">-₹7,000</td>
                <td className="text-right py-3 px-4">📉</td>
              </tr>
              <tr className="border-b border-slate-700">
                <td className="py-3 px-4 text-white">Discipline Score</td>
                <td className="text-right py-3 px-4 text-yellow-400">65.6</td>
                <td className="text-right py-3 px-4 text-slate-300">67.9</td>
                <td className="text-right py-3 px-4 text-red-400">-2.3</td>
                <td className="text-right py-3 px-4">📉</td>
              </tr>
              <tr className="border-b border-slate-700">
                <td className="py-3 px-4 text-white">Risk Violations</td>
                <td className="text-right py-3 px-4 text-red-400">8</td>
                <td className="text-right py-3 px-4 text-slate-300">5</td>
                <td className="text-right py-3 px-4 text-red-400">+3</td>
                <td className="text-right py-3 px-4">📉</td>
              </tr>
              <tr>
                <td className="py-3 px-4 text-white">Consecutive Losses</td>
                <td className="text-right py-3 px-4 text-white">3</td>
                <td className="text-right py-3 px-4 text-slate-300">2</td>
                <td className="text-right py-3 px-4 text-red-400">+1</td>
                <td className="text-right py-3 px-4">📉</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Insights */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
        <h3 className="text-white font-medium mb-4 flex items-center">
          <span className="mr-2">🤖</span> AI-Powered Insights
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <h4 className="text-white font-medium mb-2">Pattern Detection</h4>
            <p className="text-slate-300 text-sm mb-2">
              Your trading volume increases by 40% after consecutive losses, indicating potential revenge trading behavior.
            </p>
            <div className="flex items-center text-xs text-yellow-400">
              <span className="mr-1">⚠️</span> High Risk Pattern
            </div>
          </div>
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <h4 className="text-white font-medium mb-2">Recommendation</h4>
            <p className="text-slate-300 text-sm mb-2">
              Consider implementing a cooldown period after 2 consecutive losses to prevent emotional trading.
            </p>
            <div className="flex items-center text-xs text-blue-400">
              <span className="mr-1">💡</span> Action Suggested
            </div>
          </div>
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <h4 className="text-white font-medium mb-2">Performance Analysis</h4>
            <p className="text-slate-300 text-sm mb-2">
              Your best trading hours are 10:00-11:00 AM with a 75% win rate. Consider focusing on this time window.
            </p>
            <div className="flex items-center text-xs text-green-400">
              <span className="mr-1">📊</span> Opportunity Identified
            </div>
          </div>
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <h4 className="text-white font-medium mb-2">Risk Assessment</h4>
            <p className="text-slate-300 text-sm mb-2">
              Current risk level is elevated. Recent position sizes are 2.8x your average, increasing exposure.
            </p>
            <div className="flex items-center text-xs text-red-400">
              <span className="mr-1">🚨</span> Risk Alert
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
