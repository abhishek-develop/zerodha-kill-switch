'use client'

import { useState } from 'react'
import { BehavioralPattern } from '@/types'

export function BehavioralProfile() {
  const [patterns, setPatterns] = useState<BehavioralPattern[]>([
    {
      id: '1',
      pattern: 'Revenge Trading After Losses',
      description: 'You tend to increase position size and trading frequency after consecutive losses',
      frequency: 67,
      impact: 'HIGH',
      recommendation: 'Implement a mandatory 30-minute cooldown after 2 consecutive losses'
    },
    {
      id: '2',
      pattern: 'Overtrading Near Market Close',
      description: 'Trading activity increases by 40% in the last 30 minutes of market hours',
      frequency: 45,
      impact: 'MEDIUM',
      recommendation: 'Set a rule to stop trading 30 minutes before market close'
    },
    {
      id: '3',
      pattern: 'Profit Taking Too Early',
      description: 'You exit profitable trades prematurely, missing out on additional gains',
      frequency: 58,
      impact: 'MEDIUM',
      recommendation: 'Use trailing stop losses to let winners run longer'
    },
    {
      id: '4',
      pattern: 'Weekend Trading Anxiety',
      description: 'Analysis shows increased position sizes on Monday mornings',
      frequency: 35,
      impact: 'LOW',
      recommendation: 'Start with smaller positions on Mondays to ease into the week'
    },
    {
      id: '5',
      pattern: 'Emotional Trading After Big Wins',
      description: 'After profitable days, you tend to take riskier trades the next day',
      frequency: 42,
      impact: 'HIGH',
      recommendation: 'Maintain consistent position sizes regardless of recent performance'
    }
  ])

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'HIGH': return 'text-red-400 bg-red-500/20 border-red-500'
      case 'MEDIUM': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500'
      case 'LOW': return 'text-green-400 bg-green-500/20 border-green-500'
      default: return 'text-gray-400 bg-gray-500/20 border-gray-500'
    }
  }

  const getFrequencyColor = (frequency: number) => {
    if (frequency >= 60) return 'text-red-400'
    if (frequency >= 40) return 'text-yellow-400'
    return 'text-green-400'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white mb-6">Your Trading DNA</h2>

        {/* Overall Profile Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-yellow-400 mb-2">68</div>
            <div className="text-sm text-slate-400">Behavioral Score</div>
            <div className="text-xs text-yellow-400 mt-1">Needs Improvement</div>
          </div>
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-red-400 mb-2">5</div>
            <div className="text-sm text-slate-400">Risk Patterns</div>
            <div className="text-xs text-red-400 mt-1">High priority</div>
          </div>
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-green-400 mb-2">3</div>
            <div className="text-sm text-slate-400">Strengths</div>
            <div className="text-xs text-green-400 mt-1">Leverage these</div>
          </div>
        </div>

        {/* Key Insights */}
        <div className="bg-blue-500/10 border border-blue-500 rounded-lg p-4 mb-6">
          <h3 className="text-blue-400 font-medium mb-2 flex items-center">
            <span className="mr-2">🧠</span> AI Behavioral Analysis
          </h3>
          <p className="text-slate-300 text-sm mb-3">
            Your trading behavior shows strong emotional patterns that significantly impact performance.
            Revenge trading is your most destructive pattern, occurring 67% of the time after losses.
            When calm, your win rate improves by 35%.
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-full">
              High Emotional Trading
            </span>
            <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded-full">
              Inconsistent Position Sizing
            </span>
            <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">
              Good Technical Analysis
            </span>
          </div>
        </div>

        {/* Behavioral Patterns */}
        <div className="space-y-4">
          <h3 className="text-white font-medium">Detected Behavioral Patterns</h3>
          {patterns.map((pattern) => (
            <div key={pattern.id} className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h4 className="text-white font-medium mb-1">{pattern.pattern}</h4>
                  <p className="text-slate-300 text-sm">{pattern.description}</p>
                </div>
                <div className="flex flex-col items-end space-y-2 ml-4">
                  <span className={`px-2 py-1 text-xs rounded-full border ${getImpactColor(pattern.impact)}`}>
                    {pattern.impact} IMPACT
                  </span>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${getFrequencyColor(pattern.frequency)}`}>
                      {pattern.frequency}%
                    </div>
                    <div className="text-xs text-slate-400">frequency</div>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-700">
                <div className="flex items-start">
                  <span className="text-blue-400 mr-2">💡</span>
                  <div>
                    <div className="text-sm font-medium text-blue-400 mb-1">Recommendation</div>
                    <p className="text-slate-300 text-sm">{pattern.recommendation}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trading Personality */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
        <h3 className="text-white font-medium mb-4">Your Trading Personality</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-slate-400 text-sm font-medium mb-3">Strengths</h4>
            <div className="space-y-2">
              <div className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                <span className="text-slate-300 text-sm">Strong technical analysis skills</span>
              </div>
              <div className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                <span className="text-slate-300 text-sm">Good risk management when calm</span>
              </div>
              <div className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                <span className="text-slate-300 text-sm">Disciplined stop-loss usage</span>
              </div>
              <div className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                <span className="text-slate-300 text-sm">Detailed trade documentation</span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-slate-400 text-sm font-medium mb-3">Areas for Improvement</h4>
            <div className="space-y-2">
              <div className="flex items-center">
                <span className="text-red-400 mr-2">!</span>
                <span className="text-slate-300 text-sm">Emotional decision making</span>
              </div>
              <div className="flex items-center">
                <span className="text-red-400 mr-2">!</span>
                <span className="text-slate-300 text-sm">Inconsistent position sizing</span>
              </div>
              <div className="flex items-center">
                <span className="text-red-400 mr-2">!</span>
                <span className="text-slate-300 text-sm">Revenge trading tendencies</span>
              </div>
              <div className="flex items-center">
                <span className="text-red-400 mr-2">!</span>
                <span className="text-slate-300 text-sm">Premature profit taking</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Improvement Plan */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
        <h3 className="text-white font-medium mb-4">Personalized Improvement Plan</h3>
        <div className="space-y-4">
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <div className="flex items-center mb-2">
              <span className="text-lg mr-3">🎯</span>
              <h4 className="text-white font-medium">Week 1-2: Emotional Awareness</h4>
            </div>
            <ul className="text-slate-300 text-sm space-y-1 ml-8">
              <li>• Practice mindfulness before each trading session</li>
              <li>• Rate emotional state (1-10) before entering trades</li>
              <li>• Implement mandatory breaks after 3 consecutive trades</li>
            </ul>
          </div>

          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <div className="flex items-center mb-2">
              <span className="text-lg mr-3">⚡</span>
              <h4 className="text-white font-medium">Week 3-4: Position Sizing Discipline</h4>
            </div>
            <ul className="text-slate-300 text-sm space-y-1 ml-8">
              <li>• Set maximum position size rules in TradeGuardian</li>
              <li>• Use position size calculator for every trade</li>
              <li>• Review position sizes weekly for consistency</li>
            </ul>
          </div>

          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4">
            <div className="flex items-center mb-2">
              <span className="text-lg mr-3">🛡️</span>
              <h4 className="text-white font-medium">Week 5-6: Revenge Trading Prevention</h4>
            </div>
            <ul className="text-slate-300 text-sm space-y-1 ml-8">
              <li>• Enable automatic cooldown after losses</li>
              <li>• Set daily loss limits in risk settings</li>
              <li>• Create "revenge trading" alert triggers</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Progress Tracking */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur-sm">
        <h3 className="text-white font-medium mb-4">Progress Tracking</h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-400">Emotional Control</span>
              <span className="text-yellow-400">45%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div className="bg-yellow-400 h-2 rounded-full" style={{ width: '45%' }}></div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-400">Consistency</span>
              <span className="text-green-400">72%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div className="bg-green-400 h-2 rounded-full" style={{ width: '72%' }}></div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-400">Risk Management</span>
              <span className="text-red-400">28%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div className="bg-red-400 h-2 rounded-full" style={{ width: '28%' }}></div>
            </div>
          </div>
        </div>

        <div className="mt-4 p-3 bg-slate-900/50 border border-slate-600 rounded-lg">
          <p className="text-slate-300 text-sm">
            <span className="text-blue-400 font-medium">Next Milestone:</span> Improve emotional control to 60% by implementing pre-trade mindfulness routines.
          </p>
        </div>
      </div>
    </div>
  )
}
