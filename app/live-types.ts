export type LockPhase =
  | 'ARMED'
  | 'TRIPPED'
  | 'CANCELLING'
  | 'EXITING'
  | 'VERIFYING'
  | 'VERIFIED_FLAT'
  | 'DEGRADED'
  | string

export interface AuthStatus {
  authenticated: boolean
  configured?: boolean
  authRequired?: boolean
  expiresAt?: string | null
  configurationIssues?: string[]
  startupError?: string | null
}

export interface GuardUser {
  userId?: string | null
  userName?: string | null
  loginAt?: string | null
}

export interface KillState {
  active: boolean
  date: string | null
  activatedAt: string | null
  reason: string | null
  phase: LockPhase | null
  verifiedFlat: boolean
  lastReconciledAt: string | null
  unresolvedExposureCount: number
  canArmNextDay?: boolean
}

export interface GuardSettings {
  maxLoss: number
  riskPollMs: number
  guardPollMs: number
  marketProtection: number
  flattenProducts: string[]
  cancelGttOnKill: boolean
  chargeBuffer: number
}

export interface PnlSnapshot {
  gross: number
  estimatedCharges: number
  chargeBuffer: number
  total: number
  source: string | null
  updatedAt: string | null
}

export interface OpenPosition {
  exchange?: string | null
  tradingsymbol?: string | null
  product?: string | null
  quantity?: number | null
  average_price?: number | null
  last_price?: number | null
  averagePrice?: number | null
  lastPrice?: number | null
  pnl?: number | null
  m2m?: number | null
  realised?: number | null
  unrealised?: number | null
}

export interface BrokerOrder {
  order_id?: string | null
  tag?: string | null
  exchange?: string | null
  tradingsymbol?: string | null
  transaction_type?: string | null
  quantity?: number | null
  filled_quantity?: number | null
  pending_quantity?: number | null
  status?: string | null
  status_message?: string | null
  product?: string | null
  variety?: string | null
  order_timestamp?: string | null
}

export interface GttOrderLeg {
  transaction_type?: string | null
  quantity?: number | null
  price?: number | null
  product?: string | null
  order_type?: string | null
}

export interface GttTrigger {
  id?: number | string | null
  type?: string | null
  status?: string | null
  tradingsymbol?: string | null
  exchange?: string | null
  trigger_values?: number[] | null
  triggerValues?: number[] | null
  last_price?: number | null
  condition?: {
    tradingsymbol?: string | null
    exchange?: string | null
    trigger_values?: number[] | null
    last_price?: number | null
  } | null
  orders?: GttOrderLeg[] | null
  created_at?: string | null
  updated_at?: string | null
}

export interface GuardAction {
  type?: string | null
  message?: string | null
  at?: string | null
}

export interface WebsocketHealth {
  connected?: boolean
  status?: string | null
  lastTickAt?: string | null
  lastMessageAt?: string | null
}

export interface GuardHealth {
  status: string
  ready?: boolean
  freshnessMs?: number | null
  lastRiskCheckAt: string | null
  lastGuardCheckAt: string | null
  lastSuccessAt: string | null
  consecutiveFailures: number
  lastError: string | null
  websocket: boolean | string | WebsocketHealth | null
}

export interface GuardStatus {
  connected: boolean
  user: GuardUser | null
  monitoring: boolean
  kill: KillState
  settings: GuardSettings
  pnl: PnlSnapshot
  positions: OpenPosition[]
  orders: BrokerOrder[]
  gtts: GttTrigger[]
  actions: GuardAction[]
  health: GuardHealth
}

export interface SettingsDraft {
  maxLoss: string
  riskPollMs: string
  guardPollMs: string
  marketProtection: string
  flattenProducts: string[]
  cancelGttOnKill: boolean
  chargeBuffer: string
}

export interface ApiErrorPayload {
  error?: string
  message?: string
}
