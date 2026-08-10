export interface User {
  id: string;
  name: string;
  email: string;
  brokerConnected: boolean;
  subscriptionPlan: 'free' | 'pro' | 'enterprise';
}

export interface RiskSettings {
  dailyLossLimit: number;
  maxTradesPerDay: number;
  consecutiveLossLimit: number;
  consecutiveLossCooldown: number; // minutes
  maxPositionSize: number;
  positionSizeMultiplier: number;
  profitProtectionEnabled: boolean;
  profitProtectionThreshold: number;
  profitProtectionDrawdown: number;
  revengeTradingDetection: boolean;
  revengeTradingCooldown: number; // minutes
}

export interface Trade {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  timestamp: Date;
  pnl?: number;
  status: 'OPEN' | 'CLOSED';
}

export interface Position {
  id: string;
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  timestamp: Date;
}

export interface DailyStats {
  date: string;
  totalPnL: number;
  tradesCount: number;
  winRate: number;
  maxDrawdown: number;
  disciplineScore: number;
  riskViolations: number;
}

export interface Alert {
  id: string;
  type: 'WARNING' | 'CRITICAL' | 'INFO';
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

export interface DisciplineMetrics {
  score: number;
  riskAdherence: number;
  consistency: number;
  emotionalControl: number;
  overtrading: number;
  revengeTrading: number;
  timing: number;
}

export interface BehavioralPattern {
  id: string;
  pattern: string;
  description: string;
  frequency: number;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation: string;
}

export interface JournalEntry {
  id: string;
  tradeId?: string;
  emotionalState: 'CALM' | 'FRUSTRATED' | 'EXCITED' | 'FEARFUL' | 'GREEDY';
  notes: string;
  mistakes: string[];
  lessons: string;
  timestamp: Date;
}

export interface KillSwitchStatus {
  active: boolean;
  reason?: string;
  activatedAt?: Date;
  expiresAt?: Date;
  autoSquareOff: boolean;
}
