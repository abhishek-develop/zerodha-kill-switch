'use client'

import { useState } from 'react'
import { RiskSettings as RiskSettingsType } from '@/types'
import { cn } from '@/lib/utils'

export function RiskSettings() {
  const [settings, setSettings] = useState<RiskSettingsType>({
    dailyLossLimit: 5000,
    maxTradesPerDay: 10,
    consecutiveLossLimit: 3,
    consecutiveLossCooldown: 30,
    maxPositionSize: 100000,
    positionSizeMultiplier: 2.5,
    profitProtectionEnabled: true,
    profitProtectionThreshold: 20000,
    profitProtectionDrawdown: 5000,
    revengeTradingDetection: true,
    revengeTradingCooldown: 60
  })

  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const handleInputChange = (field: keyof RiskSettingsType, value: number | boolean) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveStatus('idle')

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000))

    setIsSaving(false)
    setSaveStatus('success')

    setTimeout(() => setSaveStatus('idle'), 3000)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white mb-6">Risk Management Settings</h2>

        <div className="space-y-6">
          {/* Daily Loss Limit */}
          <div className="border-b border-slate-700 pb-6">
            <h3 className="text-white font-medium mb-4 flex items-center">
              <span className="mr-2">🛡️</span> Daily Loss Limit
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  Maximum Daily Loss
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400">₹</span>
                  <input
                    type="number"
                    value={settings.dailyLossLimit}
                    onChange={(e) => handleInputChange('dailyLossLimit', Number(e.target.value))}
                    className="w-full pl-8 pr-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Trading will be disabled if daily loss exceeds this amount
                </p>
              </div>
            </div>
          </div>

          {/* Trade Count Limits */}
          <div className="border-b border-slate-700 pb-6">
            <h3 className="text-white font-medium mb-4 flex items-center">
              <span className="mr-2">📊</span> Trade Count Limits
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  Maximum Trades per Day
                </label>
                <input
                  type="number"
                  value={settings.maxTradesPerDay}
                  onChange={(e) => handleInputChange('maxTradesPerDay', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Maximum number of trades allowed per trading day
                </p>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  Consecutive Loss Limit
                </label>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    value={settings.consecutiveLossLimit}
                    onChange={(e) => handleInputChange('consecutiveLossLimit', Number(e.target.value))}
                    className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    value={settings.consecutiveLossCooldown}
                    onChange={(e) => handleInputChange('consecutiveLossCooldown', Number(e.target.value))}
                    className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  After X losses, disable trading for Y minutes
                </p>
              </div>
            </div>
          </div>

          {/* Position Size Limits */}
          <div className="border-b border-slate-700 pb-6">
            <h3 className="text-white font-medium mb-4 flex items-center">
              <span className="mr-2">📏</span> Position Size Limits
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  Maximum Position Size
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400">₹</span>
                  <input
                    type="number"
                    value={settings.maxPositionSize}
                    onChange={(e) => handleInputChange('maxPositionSize', Number(e.target.value))}
                    className="w-full pl-8 pr-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Maximum value per position
                </p>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  Position Size Alert Multiplier
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={settings.positionSizeMultiplier}
                  onChange={(e) => handleInputChange('positionSizeMultiplier', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Alert if position size exceeds X times average
                </p>
              </div>
            </div>
          </div>

          {/* Profit Protection */}
          <div className="border-b border-slate-700 pb-6">
            <h3 className="text-white font-medium mb-4 flex items-center">
              <span className="mr-2">💰</span> Profit Protection
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white">Enable Profit Protection</p>
                  <p className="text-xs text-slate-400">
                    Stop trading after losing a certain amount from peak profit
                  </p>
                </div>
                <button
                  onClick={() => handleInputChange('profitProtectionEnabled', !settings.profitProtectionEnabled)}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    settings.profitProtectionEnabled ? "bg-blue-600" : "bg-slate-600"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      settings.profitProtectionEnabled ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>

              {settings.profitProtectionEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">
                      Profit Threshold
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400">₹</span>
                      <input
                        type="number"
                        value={settings.profitProtectionThreshold}
                        onChange={(e) => handleInputChange('profitProtectionThreshold', Number(e.target.value))}
                        className="w-full pl-8 pr-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">
                      Max Drawdown from Peak
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400">₹</span>
                      <input
                        type="number"
                        value={settings.profitProtectionDrawdown}
                        onChange={(e) => handleInputChange('profitProtectionDrawdown', Number(e.target.value))}
                        className="w-full pl-8 pr-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Revenge Trading Detection */}
          <div className="pb-6">
            <h3 className="text-white font-medium mb-4 flex items-center">
              <span className="mr-2">🎭</span> Revenge Trading Detection
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white">Enable Revenge Trading Detection</p>
                  <p className="text-xs text-slate-400">
                    Detect and intervene on emotional trading patterns
                  </p>
                </div>
                <button
                  onClick={() => handleInputChange('revengeTradingDetection', !settings.revengeTradingDetection)}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    settings.revengeTradingDetection ? "bg-blue-600" : "bg-slate-600"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      settings.revengeTradingDetection ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>

              {settings.revengeTradingDetection && (
                <div>
                  <label className="block text-sm text-slate-400 mb-2">
                    Cooldown Period (minutes)
                  </label>
                  <input
                    type="number"
                    value={settings.revengeTradingCooldown}
                    onChange={(e) => handleInputChange('revengeTradingCooldown', Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Disable trading for this duration when revenge trading is detected
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-700">
          <div className="text-sm text-slate-400">
            <p>Changes are saved automatically</p>
          </div>
          <div className="flex items-center space-x-4">
            {saveStatus === 'success' && (
              <span className="text-green-400 text-sm">Settings saved successfully</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-red-400 text-sm">Failed to save settings</span>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white rounded-lg font-medium transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
        <h3 className="text-white font-medium mb-4">Emergency Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button className="px-4 py-3 bg-red-500/20 border border-red-500 hover:bg-red-500/30 text-red-400 rounded-lg font-medium transition-colors">
            🚨 Emergency Stop All Trading
          </button>
          <button className="px-4 py-3 bg-yellow-500/20 border border-yellow-500 hover:bg-yellow-500/30 text-yellow-400 rounded-lg font-medium transition-colors">
            ⚠️ Square Off All Positions
          </button>
          <button className="px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors">
            🔄 Reset to Default Settings
          </button>
        </div>
      </div>
    </div>
  )
}
