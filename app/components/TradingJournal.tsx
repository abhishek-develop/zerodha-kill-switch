'use client'

import { useState } from 'react'
import { JournalEntry } from '@/types'

export function TradingJournal() {
  const [entries, setEntries] = useState<JournalEntry[]>([
    {
      id: '1',
      tradeId: 'TRADE001',
      emotionalState: 'FRUSTRATED',
      notes: 'Took a revenge trade after losing on RELIANCE. Position size was too big.',
      mistakes: ['Increased position size after loss', 'Didn\'t follow stop loss', 'Traded emotionally'],
      lessons: 'Always stick to the plan. Never increase position size after losses.',
      timestamp: new Date(Date.now() - 86400000)
    },
    {
      id: '2',
      tradeId: 'TRADE002',
      emotionalState: 'CALM',
      notes: 'Good disciplined trade. Followed the setup perfectly.',
      mistakes: [],
      lessons: 'Patience pays off. Waited for the right setup.',
      timestamp: new Date(Date.now() - 172800000)
    },
    {
      id: '3',
      emotionalState: 'FEARFUL',
      notes: 'Exited a profitable trade too early due to fear of giving back gains.',
      mistakes: ['Premature exit', 'Let fear override trading plan'],
      lessons: 'Trust the analysis and let winners run.',
      timestamp: new Date(Date.now() - 259200000)
    }
  ])

  const [newEntry, setNewEntry] = useState({
    tradeId: '',
    emotionalState: 'CALM' as const,
    notes: '',
    mistakes: '',
    lessons: ''
  })

  const [isAddingEntry, setIsAddingEntry] = useState(false)

  const emotionalStates = [
    { value: 'CALM', label: '😌 Calm', color: 'text-green-600' },
    { value: 'FRUSTRATED', label: '😤 Frustrated', color: 'text-red-600' },
    { value: 'EXCITED', label: '🤩 Excited', color: 'text-yellow-600' },
    { value: 'FEARFUL', label: '😨 Fearful', color: 'text-blue-600' },
    { value: 'GREEDY', label: '🤑 Greedy', color: 'text-orange-600' }
  ]

  const handleAddEntry = () => {
    if (!newEntry.notes.trim()) return

    const entry: JournalEntry = {
      id: Date.now().toString(),
      tradeId: newEntry.tradeId || undefined,
      emotionalState: newEntry.emotionalState,
      notes: newEntry.notes,
      mistakes: newEntry.mistakes.split(',').map(m => m.trim()).filter(m => m),
      lessons: newEntry.lessons,
      timestamp: new Date()
    }

    setEntries(prev => [entry, ...prev])
    setNewEntry({
      tradeId: '',
      emotionalState: 'CALM',
      notes: '',
      mistakes: '',
      lessons: ''
    })
    setIsAddingEntry(false)
  }

  const getEmotionalStateColor = (state: string) => {
    const found = emotionalStates.find(s => s.value === state)
    return found ? found.color : 'text-gray-600'
  }

  const getEmotionalStateLabel = (state: string) => {
    const found = emotionalStates.find(s => s.value === state)
    return found ? found.label : state
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="kite-card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Trading Journal</h2>
          <button
            onClick={() => setIsAddingEntry(true)}
            className="kite-button kite-button-primary"
          >
            + New Entry
          </button>
        </div>

        {/* AI Insights */}
        <div className="kite-card bg-blue-50 border-blue-200 p-4 mb-6">
          <h3 className="text-blue-800 font-medium mb-3 flex items-center">
            <span className="mr-2">🤖</span> AI-Powered Insights
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600 mb-1">67%</div>
              <div className="text-xs text-muted-foreground">Entries after losses</div>
              <div className="text-xs text-yellow-600 mt-1">High emotional trading</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600 mb-1">2.3x</div>
              <div className="text-xs text-muted-foreground">Position size increase</div>
              <div className="text-xs text-yellow-600 mt-1">After frustration</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 mb-1">85%</div>
              <div className="text-xs text-muted-foreground">Calm trades profitable</div>
              <div className="text-xs text-green-600 mt-1">Best emotional state</div>
            </div>
          </div>
        </div>

        {/* Add Entry Form */}
        {isAddingEntry && (
          <div className="kite-card p-4 mb-6">
            <h3 className="text-foreground font-medium mb-4">New Journal Entry</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Trade ID (Optional)</label>
                <input
                  type="text"
                  value={newEntry.tradeId}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, tradeId: e.target.value }))}
                  placeholder="e.g., TRADE001"
                  className="kite-input"
                />
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-2">Emotional State</label>
                <select
                  value={newEntry.emotionalState}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, emotionalState: e.target.value as any }))}
                  className="kite-input"
                >
                  {emotionalStates.map(state => (
                    <option key={state.value} value={state.value}>{state.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-2">Trade Notes</label>
                <textarea
                  value={newEntry.notes}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Describe what happened in this trade..."
                  rows={3}
                  className="kite-input"
                />
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-2">Mistakes (comma-separated)</label>
                <textarea
                  value={newEntry.mistakes}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, mistakes: e.target.value }))}
                  placeholder="e.g., Didn't follow stop loss, Position size too big"
                  rows={2}
                  className="kite-input"
                />
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-2">Lessons Learned</label>
                <textarea
                  value={newEntry.lessons}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, lessons: e.target.value }))}
                  placeholder="What did you learn from this trade?"
                  rows={2}
                  className="kite-input"
                />
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={handleAddEntry}
                  className="kite-button kite-button-primary"
                >
                  Save Entry
                </button>
                <button
                  onClick={() => setIsAddingEntry(false)}
                  className="kite-button kite-button-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Journal Entries */}
        <div className="space-y-4">
          {entries.map((entry) => (
            <div key={entry.id} className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <span className={`text-lg ${getEmotionalStateColor(entry.emotionalState)}`}>
                    {getEmotionalStateLabel(entry.emotionalState)}
                  </span>
                  <div>
                    {entry.tradeId && (
                      <span className="text-xs text-slate-400">{entry.tradeId}</span>
                    )}
                    <div className="text-xs text-slate-400">
                      {entry.timestamp.toLocaleDateString()} • {entry.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium text-white mb-1">Notes</h4>
                  <p className="text-sm text-slate-300">{entry.notes}</p>
                </div>

                {entry.mistakes.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-red-400 mb-1">Mistakes</h4>
                    <ul className="text-sm text-slate-300 space-y-1">
                      {entry.mistakes.map((mistake, index) => (
                        <li key={index} className="flex items-start">
                          <span className="text-red-400 mr-2">•</span>
                          {mistake}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {entry.lessons && (
                  <div>
                    <h4 className="text-sm font-medium text-green-400 mb-1">Lessons Learned</h4>
                    <p className="text-sm text-slate-300">{entry.lessons}</p>
                  </div>
                )}
              </div>
            </div>
          ))}

          {entries.length === 0 && (
            <div className="text-center py-8 text-slate-400">
              <p className="mb-2">No journal entries yet</p>
              <p className="text-sm">Start documenting your trades to improve your discipline</p>
            </div>
          )}
        </div>
      </div>

      {/* Pattern Analysis */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
        <h3 className="text-white font-medium mb-4">Behavioral Pattern Analysis</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <h4 className="text-white font-medium mb-3">Revenge Trading Pattern</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Frequency</span>
                <span className="text-red-400">High (67% after losses)</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Avg Position Size Increase</span>
                <span className="text-red-400">2.3x</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Success Rate</span>
                <span className="text-red-400">28%</span>
              </div>
            </div>
            <div className="mt-3 p-2 bg-red-500/10 border border-red-500 rounded text-xs text-red-400">
              ⚠️ High-risk pattern detected. Consider implementing a cooldown period.
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <h4 className="text-white font-medium mb-3">Optimal Trading State</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Best Emotional State</span>
                <span className="text-green-400">Calm</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Win Rate When Calm</span>
                <span className="text-green-400">85%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Avg Return</span>
                <span className="text-green-400">+2.4%</span>
              </div>
            </div>
            <div className="mt-3 p-2 bg-green-500/10 border border-green-500 rounded text-xs text-green-400">
              ✅ Maintain emotional discipline for better results.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
