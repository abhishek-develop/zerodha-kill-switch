'use client'

import { useState } from 'react'

export function SimpleRiskSettings() {
  const [settings, setSettings] = useState({
    dailyLossLimit: 5000,
    maxTradesPerDay: 20,
    maxDrawdownAfterProfit: 5000,
    enableDailyLossLimit: true,
    enableMaxTradesLimit: true,
    enableDrawdownProtection: true,
    killSwitchAutoTrigger: true,
    notificationsEnabled: true
  })

  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const handleSave = async () => {
    setIsSaving(true)
    setSaveStatus('idle')

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500))

    try {
      // Here you would save to your backend
      console.log('Saving settings:', settings)
      setSaveStatus('success')
    } catch (error) {
      setSaveStatus('error')
    } finally {
      setIsSaving(false)
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(value)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="kite-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Risk Management Settings</h2>
        <p className="text-muted-foreground text-sm">
          Configure your core risk protection parameters to prevent account blowouts
        </p>
      </div>

      {/* Daily Loss Limit */}
      <div className="kite-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-foreground">Daily Loss Limit</h3>
            <p className="text-muted-foreground text-sm mt-1">
              Automatically halt trading when daily losses exceed this amount
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enableDailyLossLimit}
              onChange={(e) => setSettings(prev => ({ ...prev, enableDailyLossLimit: e.target.checked }))}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {settings.enableDailyLossLimit && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Maximum Daily Loss
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">₹</span>
                <input
                  type="number"
                  value={settings.dailyLossLimit}
                  onChange={(e) => setSettings(prev => ({ ...prev, dailyLossLimit: parseInt(e.target.value) || 0 }))}
                  className="kite-input pl-8"
                  min="1000"
                  step="1000"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Current setting: {formatCurrency(settings.dailyLossLimit)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Maximum Trades Per Day */}
      <div className="kite-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-foreground">Maximum Trades Per Day</h3>
            <p className="text-muted-foreground text-sm mt-1">
              Limit the number of trades you can execute in a single day
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enableMaxTradesLimit}
              onChange={(e) => setSettings(prev => ({ ...prev, enableMaxTradesLimit: e.target.checked }))}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {settings.enableMaxTradesLimit && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Maximum Trades
              </label>
              <input
                type="number"
                value={settings.maxTradesPerDay}
                onChange={(e) => setSettings(prev => ({ ...prev, maxTradesPerDay: parseInt(e.target.value) || 0 }))}
                className="kite-input"
                min="1"
                max="100"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Current setting: {settings.maxTradesPerDay} trades per day
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Max Drawdown After Profit */}
      <div className="kite-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-foreground">Max Drawdown After Profit</h3>
            <p className="text-muted-foreground text-sm mt-1">
              Protect profits by limiting drawdown once you're in profit for the day
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enableDrawdownProtection}
              onChange={(e) => setSettings(prev => ({ ...prev, enableDrawdownProtection: e.target.checked }))}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {settings.enableDrawdownProtection && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Maximum Drawdown from Peak
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">₹</span>
                <input
                  type="number"
                  value={settings.maxDrawdownAfterProfit}
                  onChange={(e) => setSettings(prev => ({ ...prev, maxDrawdownAfterProfit: parseInt(e.target.value) || 0 }))}
                  className="kite-input pl-8"
                  min="1000"
                  step="1000"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Current setting: {formatCurrency(settings.maxDrawdownAfterProfit)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Kill Switch Settings */}
      <div className="kite-card p-6">
        <h3 className="text-lg font-medium text-foreground mb-4">Kill Switch Settings</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">Auto-trigger Kill Switch</p>
              <p className="text-muted-foreground text-sm">Automatically halt trading when limits are breached</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.killSwitchAutoTrigger}
                onChange={(e) => setSettings(prev => ({ ...prev, killSwitchAutoTrigger: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">Email Notifications</p>
              <p className="text-muted-foreground text-sm">Get notified when risk limits are triggered</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.notificationsEnabled}
                onChange={(e) => setSettings(prev => ({ ...prev, notificationsEnabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-between">
        <div>
          {saveStatus === 'success' && (
            <p className="text-sm text-green-600">✓ Settings saved successfully</p>
          )}
          {saveStatus === 'error' && (
            <p className="text-sm text-red-600">✗ Failed to save settings</p>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="kite-button kite-button-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* Risk Summary */}
      <div className="kite-card bg-blue-50 border-blue-200 p-6">
        <h3 className="text-blue-800 font-medium mb-3">Risk Protection Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="font-medium text-blue-800">Daily Loss Protection</p>
            <p className="text-blue-600">
              {settings.enableDailyLossLimit ? `Active at ${formatCurrency(settings.dailyLossLimit)}` : 'Disabled'}
            </p>
          </div>
          <div>
            <p className="font-medium text-blue-800">Trade Count Limit</p>
            <p className="text-blue-600">
              {settings.enableMaxTradesLimit ? `${settings.maxTradesPerDay} trades/day` : 'Disabled'}
            </p>
          </div>
          <div>
            <p className="font-medium text-blue-800">Drawdown Protection</p>
            <p className="text-blue-600">
              {settings.enableDrawdownProtection ? `Active at ${formatCurrency(settings.maxDrawdownAfterProfit)}` : 'Disabled'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
