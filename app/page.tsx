'use client'

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  History,
  KeyRound,
  Loader2,
  LockKeyhole,
  LogOut,
  Play,
  Power,
  RefreshCw,
  Save,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
  X,
  Zap,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ApiErrorPayload,
  AuthStatus,
  BrokerOrder,
  GuardAction,
  GuardSettings,
  GuardStatus,
  GttTrigger,
  OpenPosition,
  SettingsDraft,
  WebsocketHealth,
} from './live-types'

const API_BASE = (process.env.NEXT_PUBLIC_KILL_SWITCH_API_BASE || '').replace(/\/$/, '')
const PRODUCTS = ['MIS', 'NRML', 'CNC', 'MTF', 'CO', 'BO', 'ALL']
const STATUS_POLL_MS = 3_000

type DashboardTab = 'overview' | 'activity' | 'settings'
type Notice = { tone: 'success' | 'error'; message: string }
type LockVisualState = 'armed' | 'exiting' | 'verified' | 'degraded' | 'disconnected' | 'paused'

class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  })
  const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload & T
  if (!response.ok) {
    throw new ApiError(payload.error || payload.message || `Request failed with HTTP ${response.status}`, response.status)
  }
  return payload
}

const numberOr = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const isFiniteNumberish = (value: unknown) => (
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
)

function normaliseStatus(payload: GuardStatus | { status?: GuardStatus; state?: GuardStatus }): GuardStatus {
  const candidate = ('status' in payload && typeof payload.status === 'object' ? payload.status : undefined)
    || ('state' in payload && typeof payload.state === 'object' ? payload.state : undefined)
    || payload
  const source = candidate as Partial<GuardStatus> & {
    lastError?: string | null
    pnl?: Partial<GuardStatus['pnl']> & { realised?: number; unrealised?: number }
  }
  const settings = source.settings || ({} as Partial<GuardSettings>)
  const pnl: Partial<GuardStatus['pnl']> = source.pnl || {}
  const health = source.health || ({} as Partial<GuardStatus['health']>)
  const pnlValid = [pnl.gross, pnl.estimatedCharges, pnl.chargeBuffer, pnl.total].every(isFiniteNumberish)

  return {
    connected: Boolean(source.connected),
    user: source.user || null,
    monitoring: Boolean(source.monitoring),
    kill: {
      active: Boolean(source.kill?.active),
      date: source.kill?.date || null,
      activatedAt: source.kill?.activatedAt || null,
      reason: source.kill?.reason || null,
      phase: source.kill?.phase || null,
      verifiedFlat: Boolean(source.kill?.verifiedFlat),
      lastReconciledAt: source.kill?.lastReconciledAt || null,
      unresolvedExposureCount: numberOr(source.kill?.unresolvedExposureCount),
      canArmNextDay: source.kill?.canArmNextDay,
    },
    settings: {
      maxLoss: numberOr(settings.maxLoss, 10_000),
      riskPollMs: numberOr(settings.riskPollMs, 5_000),
      guardPollMs: numberOr(settings.guardPollMs, 1_500),
      marketProtection: numberOr(settings.marketProtection, 5),
      flattenProducts: Array.isArray(settings.flattenProducts) ? settings.flattenProducts : [],
      cancelGttOnKill: Boolean(settings.cancelGttOnKill),
      chargeBuffer: numberOr(settings.chargeBuffer),
    },
    pnl: {
      gross: numberOr(pnl.gross),
      estimatedCharges: numberOr(pnl.estimatedCharges),
      chargeBuffer: numberOr(pnl.chargeBuffer, numberOr(settings.chargeBuffer)),
      total: numberOr(pnl.total),
      source: pnl.source || null,
      updatedAt: pnl.updatedAt || null,
    },
    positions: Array.isArray(source.positions) ? source.positions : [],
    orders: Array.isArray(source.orders) ? source.orders : [],
    gtts: Array.isArray(source.gtts) ? source.gtts : [],
    actions: Array.isArray(source.actions) ? source.actions : [],
    health: {
      status: source.connected && !pnlValid ? 'DEGRADED' : health.status || (source.connected ? 'unknown' : 'disconnected'),
      ready: source.connected && !pnlValid ? false : (typeof health.ready === 'boolean' ? health.ready : undefined),
      freshnessMs: health.freshnessMs == null ? null : numberOr(health.freshnessMs),
      lastRiskCheckAt: health.lastRiskCheckAt || null,
      lastGuardCheckAt: health.lastGuardCheckAt || null,
      lastSuccessAt: health.lastSuccessAt || null,
      consecutiveFailures: numberOr(health.consecutiveFailures),
      lastError: source.connected && !pnlValid
        ? 'The guard returned an invalid P&L snapshot; protection cannot be verified.'
        : health.lastError || source.lastError || null,
      websocket: health.websocket ?? null,
    },
  }
}

function toDraft(settings: GuardSettings): SettingsDraft {
  return {
    maxLoss: String(settings.maxLoss),
    riskPollMs: String(settings.riskPollMs),
    guardPollMs: String(settings.guardPollMs),
    marketProtection: String(settings.marketProtection),
    flattenProducts: [...settings.flattenProducts],
    cancelGttOnKill: settings.cancelGttOnKill,
    chargeBuffer: String(settings.chargeBuffer),
  }
}

const EMPTY_DRAFT: SettingsDraft = {
  maxLoss: '10000',
  riskPollMs: '5000',
  guardPollMs: '1500',
  marketProtection: '5',
  flattenProducts: ['ALL'],
  cancelGttOnKill: true,
  chargeBuffer: '0',
}

function formatCurrency(value: number, signed = false) {
  const prefix = signed && value > 0 ? '+' : ''
  return `${prefix}${new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value)}`
}

function formatDateTime(value?: string | null, includeDate = false) {
  if (!value) return '—'
  const parsed = new Date(normaliseBrokerTimestamp(value))
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    ...(includeDate ? { day: '2-digit', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed)
}

function relativeTime(value?: string | null, now = Date.now()) {
  if (!value) return 'never'
  const timestamp = new Date(normaliseBrokerTimestamp(value)).getTime()
  if (!Number.isFinite(timestamp)) return 'unknown'
  const seconds = Math.max(0, Math.round((now - timestamp) / 1_000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

function statusTone(status?: string | null) {
  const normalised = String(status || '').toUpperCase()
  if (normalised.includes('COMPLETE') || normalised === 'ACTIVE' || normalised === 'ENABLED') return 'success'
  if (normalised.includes('REJECT') || normalised.includes('CANCEL') || normalised.includes('ERROR') || normalised.includes('DISABLED')) return 'danger'
  if (normalised.includes('OPEN') || normalised.includes('PENDING') || normalised.includes('TRIGGER')) return 'warning'
  return 'neutral'
}

function positionPnl(position: OpenPosition) {
  if (isFiniteNumberish(position.pnl)) return numberOr(position.pnl)
  if (isFiniteNumberish(position.m2m)) return numberOr(position.m2m)
  return 0
}

function websocketState(value: GuardStatus['health']['websocket']) {
  if (typeof value === 'boolean') return value ? 'Streaming' : 'Offline'
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const health = value as WebsocketHealth
    return health.status || (health.connected ? 'Streaming' : 'Offline')
  }
  return 'Not reported'
}

function gttSymbol(gtt: GttTrigger) {
  return gtt.tradingsymbol || gtt.condition?.tradingsymbol || 'Unknown instrument'
}

function gttExchange(gtt: GttTrigger) {
  return gtt.exchange || gtt.condition?.exchange || '—'
}

function gttTriggers(gtt: GttTrigger) {
  const values = gtt.triggerValues || gtt.trigger_values || gtt.condition?.trigger_values || []
  return values.length ? values.map((value) => formatCurrency(numberOr(value))).join(' / ') : '—'
}

function normaliseBrokerTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}+05:30`
    : value
}

export default function Home() {
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<GuardStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [pollError, setPollError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(EMPTY_DRAFT)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [confirmKill, setConfirmKill] = useState(false)
  const [pendingRequestToken, setPendingRequestToken] = useState<string | null>(null)
  const [lastApiSuccess, setLastApiSuccess] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const pollInFlight = useRef(false)
  const sessionExchangeStarted = useRef(false)

  const loadStatus = useCallback(async (showSpinner = false) => {
    if (pollInFlight.current) return null
    pollInFlight.current = true
    if (showSpinner) setStatusLoading(true)
    try {
      const payload = await apiRequest<GuardStatus | { status?: GuardStatus; state?: GuardStatus }>('/api/status')
      const nextStatus = normaliseStatus(payload)
      setStatus(nextStatus)
      setLastApiSuccess(Date.now())
      setPollError(null)
      return nextStatus
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuth((current) => ({ ...(current || { authenticated: false }), authenticated: false }))
        setStatus(null)
      }
      setPollError(error instanceof Error ? error.message : 'Could not reach the guard service')
      return null
    } finally {
      pollInFlight.current = false
      if (showSpinner) setStatusLoading(false)
    }
  }, [])

  const acceptStatusPayload = useCallback((payload: GuardStatus | { status?: GuardStatus; state?: GuardStatus }) => {
    const next = normaliseStatus(payload)
    setStatus(next)
    setLastApiSuccess(Date.now())
    setPollError(null)
    return next
  }, [])

  const mutate = useCallback(async (
    actionKey: string,
    path: string,
    body: Record<string, unknown> = {},
    successMessage?: string,
  ) => {
    setBusyAction(actionKey)
    setNotice(null)
    try {
      const payload = await apiRequest<GuardStatus | { status?: GuardStatus; state?: GuardStatus }>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const candidate = payload as Partial<GuardStatus> & { status?: GuardStatus; state?: GuardStatus }
      if (typeof candidate.connected === 'boolean' || candidate.status || candidate.state) {
        acceptStatusPayload(payload)
      } else {
        await loadStatus()
      }
      if (successMessage) setNotice({ tone: 'success', message: successMessage })
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuth((current) => ({ ...(current || { authenticated: false }), authenticated: false }))
        setStatus(null)
      }
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'The request failed' })
      return false
    } finally {
      setBusyAction(null)
    }
  }, [acceptStatusPayload, loadStatus])

  useEffect(() => {
    const url = new URL(window.location.href)
    const requestToken = url.searchParams.get('request_token')
    const kiteStatus = url.searchParams.get('status')
    const stateTimer = window.setTimeout(() => {
      if (requestToken) setPendingRequestToken(requestToken)
      if (!requestToken && kiteStatus && kiteStatus.toLowerCase() !== 'success') {
        setNotice({ tone: 'error', message: 'Kite login did not complete. Please try connecting again.' })
      }
    }, 0)
    if (requestToken || kiteStatus || url.searchParams.has('action')) {
      url.searchParams.delete('request_token')
      url.searchParams.delete('status')
      url.searchParams.delete('action')
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
    }
    return () => window.clearTimeout(stateTimer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const checkAuth = async () => {
      try {
        const payload = await apiRequest<AuthStatus>('/api/auth/status')
        if (!cancelled) setAuth(payload)
      } catch (error) {
        if (!cancelled) {
          setAuth({ authenticated: false })
          setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Could not check console authentication' })
        }
      } finally {
        if (!cancelled) setAuthChecking(false)
      }
    }
    void checkAuth()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!auth?.authenticated) return
    const initialLoad = window.setTimeout(() => void loadStatus(true), 0)
    const interval = window.setInterval(() => void loadStatus(), STATUS_POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadStatus()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [auth?.authenticated, loadStatus])

  useEffect(() => {
    const initialTick = window.setTimeout(() => setNow(Date.now()), 0)
    const clock = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => {
      window.clearTimeout(initialTick)
      window.clearInterval(clock)
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 6_000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (!status || settingsDirty) return
    const syncDraft = window.setTimeout(() => setSettingsDraft(toDraft(status.settings)), 0)
    return () => window.clearTimeout(syncDraft)
  }, [settingsDirty, status])

  useEffect(() => {
    if (!auth?.authenticated || !pendingRequestToken || sessionExchangeStarted.current) return
    sessionExchangeStarted.current = true
    const exchangeSession = async () => {
      const success = await mutate(
        'kite-session',
        '/api/session',
        { requestToken: pendingRequestToken },
        'Kite session connected. The risk guard is now using live broker data.',
      )
      setPendingRequestToken(null)
      if (!success) sessionExchangeStarted.current = false
    }
    void exchangeSession()
  }, [auth?.authenticated, mutate, pendingRequestToken])

  const snapshotTimestamp = status?.kill.active
    ? status.health.lastGuardCheckAt
    : status?.health.lastRiskCheckAt || status?.pnl.updatedAt || null
  const staleThreshold = status?.kill.active
    ? Math.max(10_000, numberOr(status.settings.guardPollMs, 1_000) * 5)
    : Math.max(15_000, numberOr(status?.settings.riskPollMs, 5_000) * 5)
  const computedSnapshotAge = snapshotTimestamp ? now - new Date(snapshotTimestamp).getTime() : null
  const snapshotAge = status?.health.freshnessMs ?? computedSnapshotAge
  const snapshotMissing = Boolean(status?.connected && status.monitoring && !snapshotTimestamp)
  const snapshotStale = Boolean(status?.connected && status.monitoring && snapshotAge !== null && snapshotAge > staleThreshold)
  const apiStale = Boolean(lastApiSuccess && now - lastApiSuccess > Math.max(12_000, STATUS_POLL_MS * 3))
  const healthStatus = String(status?.health.status || '').toLowerCase()
  const killPhase = String(status?.kill.phase || '').toUpperCase()
  const healthReportsBad = ['critical', 'degraded', 'unhealthy', 'error', 'offline', 'failed'].some((value) => healthStatus.includes(value))
  const degraded = Boolean(
    status?.connected
      && (
        snapshotMissing
        || snapshotStale
        || apiStale
        || Boolean(pollError)
        || (status.health.ready === false && (status.monitoring || status.kill.active))
        || healthReportsBad
        || killPhase.includes('DEGRADED')
        || status.health.consecutiveFailures >= 3
      ),
  )

  const visualState = useMemo<LockVisualState>(() => {
    if (!status?.connected) return 'disconnected'
    if (degraded) return 'degraded'
    if (status.kill.active && (status.kill.verifiedFlat || killPhase.includes('VERIFIED_FLAT'))) return 'verified'
    if (status.kill.active) return 'exiting'
    if (status.monitoring) return 'armed'
    return 'paused'
  }, [degraded, killPhase, status])

  const lockPresentation = {
    armed: {
      eyebrow: 'ARMED',
      title: 'Loss guard is watching',
      description: 'Live P&L is being checked against your daily limit. A breach will latch the reactive lock and start flattening exposure.',
      icon: ShieldCheck,
    },
    exiting: {
      eyebrow: 'EXITING · LOCKED',
      title: 'Reactive lock is enforcing',
      description: 'Open orders are being cancelled and positions are being reversed. New exposure detected today will be flattened again.',
      icon: Zap,
    },
    verified: {
      eyebrow: 'PROTECTED EXPOSURE CLEAR · LOCKED',
      title: 'Protected exposure was verified clear',
      description: 'The same-day lock remains latched. The guard keeps checking and will reverse any newly detected protected position.',
      icon: CheckCircle2,
    },
    degraded: {
      eyebrow: 'DEGRADED',
      title: 'Protection cannot be verified',
      description: 'Broker checks are stale or failing. Do not place trades until connectivity and reconciliation recover.',
      icon: ShieldAlert,
    },
    disconnected: {
      eyebrow: 'DISCONNECTED',
      title: 'Kite is not connected',
      description: 'No broker data is available and the app cannot detect or flatten positions. Connect a valid daily Kite session.',
      icon: WifiOff,
    },
    paused: {
      eyebrow: 'PAUSED',
      title: 'Monitoring is stopped',
      description: 'The guard is connected but is not checking P&L. Start monitoring before trading.',
      icon: AlertTriangle,
    },
  }[visualState]

  const lossUsed = status
    ? Math.max(0, Math.min(100, (-status.pnl.total / Math.max(1, status.settings.maxLoss)) * 100))
    : 0
  const remainingLoss = status ? Math.max(0, status.settings.maxLoss + Math.min(0, status.pnl.total)) : 0
  const userName = status?.user?.userName || status?.user?.userId || 'Kite user'

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!password.trim()) return
    setBusyAction('auth-login')
    setNotice(null)
    try {
      const payload = await apiRequest<AuthStatus>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setAuth({ ...payload, authenticated: true })
      setPassword('')
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Sign-in failed' })
    } finally {
      setBusyAction(null)
    }
  }

  const logoutConsole = async () => {
    setBusyAction('auth-logout')
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
      setAuth({ authenticated: false })
      setStatus(null)
      setPollError(null)
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Could not sign out' })
    } finally {
      setBusyAction(null)
    }
  }

  const connectKite = async () => {
    setBusyAction('kite-connect')
    setNotice(null)
    try {
      const payload = await apiRequest<{ loginUrl?: string; url?: string }>('/api/login-url')
      const loginUrl = payload.loginUrl || payload.url
      if (!loginUrl) throw new Error('The guard did not return a Kite login URL')
      window.location.assign(loginUrl)
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Could not start Kite login' })
      setBusyAction(null)
    }
  }

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (status?.kill.active) {
      setNotice({ tone: 'error', message: 'Risk settings are frozen while today’s reactive lock is active.' })
      return
    }
    const maxLoss = numberOr(settingsDraft.maxLoss, NaN)
    const riskPollMs = numberOr(settingsDraft.riskPollMs, NaN)
    const guardPollMs = numberOr(settingsDraft.guardPollMs, NaN)
    const marketProtection = numberOr(settingsDraft.marketProtection, NaN)
    const chargeBuffer = numberOr(settingsDraft.chargeBuffer, NaN)
    if (![maxLoss, riskPollMs, guardPollMs, marketProtection, chargeBuffer].every(Number.isFinite)) {
      setNotice({ tone: 'error', message: 'Every numeric setting must contain a valid number.' })
      return
    }
    if (
      maxLoss <= 0
      || riskPollMs < 1_000
      || riskPollMs > 60_000
      || guardPollMs < 750
      || guardPollMs > 30_000
      || !Number.isInteger(marketProtection)
      || marketProtection < -1
      || marketProtection > 100
      || chargeBuffer < 0
    ) {
      setNotice({ tone: 'error', message: 'Check the allowed range shown for each setting.' })
      return
    }
    if (!settingsDraft.flattenProducts.length) {
      setNotice({ tone: 'error', message: 'Select at least one product to flatten after a breach.' })
      return
    }
    const success = await mutate('settings', '/api/settings', {
      maxLoss,
      riskPollMs,
      guardPollMs,
      marketProtection,
      flattenProducts: settingsDraft.flattenProducts,
      cancelGttOnKill: settingsDraft.cancelGttOnKill,
      chargeBuffer,
    }, 'Risk settings saved.')
    if (success) setSettingsDirty(false)
  }

  const updateDraft = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => {
    setSettingsDraft((current) => ({ ...current, [key]: value }))
    setSettingsDirty(true)
  }

  const toggleProduct = (product: string) => {
    const selected = settingsDraft.flattenProducts.includes(product)
    const withoutAll = settingsDraft.flattenProducts.filter((item) => item !== 'ALL')
    const next = product === 'ALL'
      ? (selected ? [] : ['ALL'])
      : (selected ? withoutAll.filter((item) => item !== product) : [...withoutAll, product])
    updateDraft('flattenProducts', next)
  }

  const activateKill = async () => {
    const success = await mutate(
      'kill',
      '/api/kill/activate',
      { reason: 'Manual activation from risk console' },
      'Reactive lock activated. Flattening and reconciliation are in progress.',
    )
    if (success) setConfirmKill(false)
  }

  if (authChecking) {
    return (
      <main className="auth-shell">
        <div className="boot-card" role="status">
          <span className="brand-mark"><Shield size={23} /></span>
          <Loader2 className="spin" size={24} />
          <p>Checking guard console…</p>
        </div>
      </main>
    )
  }

  if (!auth?.authenticated) {
    return (
      <main className="auth-shell">
        <div className="auth-ambient auth-ambient-one" />
        <div className="auth-ambient auth-ambient-two" />
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-brand">
            <span className="brand-mark"><Shield size={24} /></span>
            <span>TradeGuardian</span>
          </div>
          <div className="auth-copy">
            <span className="overline"><LockKeyhole size={14} /> Private risk console</span>
            <h1 id="auth-title">Sign in to your guard</h1>
            <p>This password protects the control panel. Your Zerodha login is handled separately through Kite.</p>
          </div>
          {notice && <InlineNotice notice={notice} onClose={() => setNotice(null)} />}
          {auth?.configured === false && (
            <div className="inline-notice error" role="alert">
              <AlertTriangle size={18} />
              <span>{auth.startupError || auth.configurationIssues?.join('; ') || 'The guard is not fully configured. Check the server environment and restart it.'}</span>
            </div>
          )}
          <form className="auth-form" onSubmit={login}>
            <label htmlFor="console-password">Console password</label>
            <div className="password-wrap">
              <KeyRound size={18} aria-hidden="true" />
              <input
                id="console-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
                autoFocus
              />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={auth?.configured === false || !password.trim() || busyAction === 'auth-login'}>
              {busyAction === 'auth-login' ? <Loader2 className="spin" size={17} /> : <LockKeyhole size={17} />}
              Sign in
            </button>
          </form>
          <p className="auth-footnote">This is a reactive safety system, not a Zerodha order block. Keep the guard process and internet connection running while you trade.</p>
        </section>
      </main>
    )
  }

  if (statusLoading && !status) {
    return (
      <main className="auth-shell">
        <div className="boot-card" role="status">
          <span className="brand-mark"><Shield size={23} /></span>
          <Loader2 className="spin" size={24} />
          <p>Loading live guard state…</p>
        </div>
      </main>
    )
  }

  if (!status) {
    return (
      <main className="auth-shell">
        <section className="auth-card compact-card">
          <span className="state-icon degraded"><WifiOff size={26} /></span>
          <h1>Guard service unavailable</h1>
          <p>{pollError || 'The live state could not be loaded.'}</p>
          <div className="button-row">
            <button className="btn btn-primary" onClick={() => void loadStatus(true)}><RefreshCw size={16} /> Retry</button>
            <button className="btn btn-quiet" onClick={() => void logoutConsole()}><LogOut size={16} /> Sign out</button>
          </div>
        </section>
      </main>
    )
  }

  const StatusIcon = lockPresentation.icon
  const activePositions = status.positions.filter((position) => numberOr(position.quantity) !== 0)
  const protectsAllProducts = status.settings.flattenProducts.includes('ALL')
  const protectedProducts = new Set(status.settings.flattenProducts.map((product) => product.toUpperCase()))
  const unprotectedPositions = protectsAllProducts
    ? []
    : activePositions.filter((position) => !protectedProducts.has(String(position.product || '').toUpperCase()))
  const recentOrders = [...status.orders]
    .sort((left, right) => new Date(normaliseBrokerTimestamp(right.order_timestamp || '')).getTime() - new Date(normaliseBrokerTimestamp(left.order_timestamp || '')).getTime())
    .slice(0, 40)
  const recentActions = [...status.actions]
    .sort((left, right) => new Date(right.at || 0).getTime() - new Date(left.at || 0).getTime())
    .slice(0, 80)
  const canArmNextDay = Boolean(status.kill.canArmNextDay)

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark"><Shield size={22} /></span>
            <div>
              <strong>TradeGuardian</strong>
              <span>Risk control console</span>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="truth-chip"><span className="truth-dot" /> REACTIVE LOCK</span>
            <button
              className="icon-button"
              type="button"
              onClick={() => void loadStatus(true)}
              disabled={statusLoading}
              aria-label="Refresh live status"
              title="Refresh live status"
            >
              <RefreshCw className={statusLoading ? 'spin' : ''} size={17} />
            </button>
            <div className="user-block">
              <span className="avatar">{userName.slice(0, 1).toUpperCase()}</span>
              <div><strong>{userName}</strong><span>{status.connected ? 'Kite connected' : 'Kite offline'}</span></div>
            </div>
            <button className="icon-button" type="button" onClick={() => void logoutConsole()} aria-label="Sign out of console" title="Sign out of console">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>

      <nav className="dashboard-nav" aria-label="Dashboard sections">
        <div className="dashboard-nav-inner">
          {([
            ['overview', 'Live overview', Activity],
            ['activity', 'Orders & activity', History],
            ['settings', 'Risk settings', Settings],
          ] as const).map(([tab, label, Icon]) => (
            <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
              <Icon size={16} /> {label}
              {tab === 'activity' && status.kill.unresolvedExposureCount > 0 && <span className="nav-count">{status.kill.unresolvedExposureCount}</span>}
            </button>
          ))}
          <span className="nav-updated">API updated {lastApiSuccess ? relativeTime(new Date(lastApiSuccess).toISOString(), now) : 'never'}</span>
        </div>
      </nav>

      <main className="dashboard-main">
        {notice && <InlineNotice notice={notice} onClose={() => setNotice(null)} />}
        {pollError && (
          <div className="risk-banner danger" role="alert">
            <ShieldAlert size={19} />
            <div><strong>Live status refresh failed</strong><span>{pollError}. Last API response was {lastApiSuccess ? relativeTime(new Date(lastApiSuccess).toISOString(), now) : 'never'}.</span></div>
            <button type="button" onClick={() => void loadStatus()}><RefreshCw size={15} /> Retry</button>
          </div>
        )}
        {status.kill.active && status.kill.verifiedFlat && unprotectedPositions.length > 0 && (
          <div className="risk-banner danger" role="alert">
            <ShieldAlert size={19} />
            <div>
              <strong>{unprotectedPositions.length} open position{unprotectedPositions.length === 1 ? '' : 's'} outside the protected product scope</strong>
              <span>The lock verified only the configured products. Review and close excluded exposure directly in Kite.</span>
            </div>
          </div>
        )}
        {(snapshotStale || snapshotMissing) && (
          <div className="risk-banner warning" role="alert">
            <Clock3 size={19} />
            <div>
              <strong>{snapshotMissing ? 'No successful broker snapshot recorded' : 'Broker data is stale'}</strong>
              <span>{snapshotMissing ? 'Protection cannot be confirmed until a risk check succeeds.' : `Last successful broker check was ${relativeTime(snapshotTimestamp, now)}.`}</span>
            </div>
            <button type="button" onClick={() => void mutate('snapshot', '/api/snapshot/refresh', {}, 'Live broker snapshot refreshed.')} disabled={busyAction === 'snapshot'}>
              <RefreshCw className={busyAction === 'snapshot' ? 'spin' : ''} size={15} /> Refresh broker
            </button>
          </div>
        )}
        {status.health.lastError && (
          <div className="risk-banner danger" role="alert">
            <AlertTriangle size={19} />
            <div><strong>Guard error</strong><span>{status.health.lastError}</span></div>
            <span className="failure-count">{status.health.consecutiveFailures} consecutive failure{status.health.consecutiveFailures === 1 ? '' : 's'}</span>
          </div>
        )}
        {!status.connected && (
          <section className="connect-card">
            <div className="connect-icon"><ExternalLink size={25} /></div>
            <div>
              <span className="overline">Broker session required</span>
              <h2>Connect Zerodha Kite for today</h2>
              <p>Kite access tokens expire daily. Complete Zerodha login before trading so the guard can read P&amp;L and manage exposure.</p>
            </div>
            <button className="btn btn-primary" type="button" onClick={() => void connectKite()} disabled={busyAction === 'kite-connect'}>
              {busyAction === 'kite-connect' ? <Loader2 className="spin" size={17} /> : <ExternalLink size={17} />}
              Connect Kite
            </button>
          </section>
        )}

        {activeTab === 'overview' && (
          <>
            <section className={`lock-hero ${visualState}`} aria-live="polite">
              <div className="lock-copy">
                <span className={`state-icon ${visualState}`}><StatusIcon size={29} /></span>
                <div>
                  <span className="overline">{lockPresentation.eyebrow}</span>
                  <h1>{lockPresentation.title}</h1>
                  <p>{lockPresentation.description}</p>
                  <div className="status-meta">
                    <span><span className={status.monitoring ? 'live-dot' : 'muted-dot'} /> {status.monitoring ? 'Monitor running' : 'Monitor stopped'}</span>
                    <span>Phase: {status.kill.phase || (status.monitoring ? 'ARMED' : 'IDLE')}</span>
                    {status.kill.date && <span>Lock date: {status.kill.date}</span>}
                  </div>
                </div>
              </div>
              <div className="lock-controls">
                {!status.monitoring && !status.kill.active && (
                  <button className="btn btn-light" type="button" onClick={() => void mutate('monitor-start', '/api/monitor/start', {}, 'Monitoring started.')} disabled={!status.connected || busyAction !== null}>
                    <Play size={17} /> Start monitoring
                  </button>
                )}
                {status.monitoring && !status.kill.active && (
                  <button className="btn btn-quiet-on-dark" type="button" onClick={() => void mutate('monitor-stop', '/api/monitor/stop', {}, 'Monitoring stopped.')} disabled={busyAction !== null}>
                    <Power size={17} /> Stop monitoring
                  </button>
                )}
                {!status.kill.active ? (
                  <button className="btn btn-danger" type="button" onClick={() => setConfirmKill(true)} disabled={!status.connected || busyAction !== null}>
                    <ShieldAlert size={17} /> Activate lock now
                  </button>
                ) : (
                  <button className="btn btn-light" type="button" onClick={() => void mutate('arm-next-day', '/api/kill/arm-next-day', {}, 'Next trading day is armed.')} disabled={busyAction !== null || !canArmNextDay} title={!canArmNextDay ? 'Available on the next trading day after protected exposure is verified clear' : undefined}>
                    <ShieldCheck size={17} /> {canArmNextDay ? 'Arm next trading day' : 'Available next trading day'}
                  </button>
                )}
                {status.kill.active && <span className="control-note"><LockKeyhole size={14} /> Same-day stop, Kite disconnect, and risk edits are disabled.</span>}
              </div>
            </section>

            <section className="metrics-grid">
              <article className="metric-card pnl-card">
                <div className="metric-heading"><span>Guarded P&amp;L</span><CircleDollarSign size={18} /></div>
                <strong className={status.pnl.total < 0 ? 'negative' : 'positive'}>{formatCurrency(status.pnl.total, true)}</strong>
                <div className="limit-track" aria-label={`${Math.round(lossUsed)} percent of loss limit consumed`}>
                  <span style={{ width: `${lossUsed}%` }} />
                </div>
                <div className="metric-foot"><span>{Math.round(lossUsed)}% of limit</span><span>{formatCurrency(remainingLoss)} room</span></div>
              </article>
              <article className="metric-card">
                <div className="metric-heading"><span>Daily loss limit</span><Shield size={18} /></div>
                <strong>{formatCurrency(status.settings.maxLoss)}</strong>
                <div className="metric-detail"><span>Trip level</span><b>-{formatCurrency(status.settings.maxLoss)}</b></div>
                <div className="metric-foot"><span>Uses charge-adjusted total</span></div>
              </article>
              <article className="metric-card">
                <div className="metric-heading"><span>Open exposure</span><Activity size={18} /></div>
                <strong>{activePositions.length}</strong>
                <div className="metric-detail"><span>Unresolved after lock</span><b className={status.kill.unresolvedExposureCount ? 'negative' : ''}>{status.kill.unresolvedExposureCount}</b></div>
                <div className="metric-foot"><span>{status.kill.lastReconciledAt ? `Reconciled ${relativeTime(status.kill.lastReconciledAt, now)}` : 'Not yet reconciled'}</span></div>
              </article>
              <article className="metric-card">
                <div className="metric-heading"><span>Guard health</span><Activity size={18} /></div>
                <strong className={`health-word ${degraded ? 'negative' : ''}`}>{degraded ? 'Degraded' : status.health.status}</strong>
                <div className="metric-detail"><span>Broker feed</span><b>{websocketState(status.health.websocket)}</b></div>
                <div className="metric-foot"><span>Broker success {relativeTime(snapshotTimestamp, now)}</span></div>
              </article>
            </section>

            <section className="content-grid">
              <div className="panel positions-panel">
                <PanelHeader
                  eyebrow="Live exposure"
                  title="Open positions"
                  detail={`${activePositions.length} position${activePositions.length === 1 ? '' : 's'}`}
                  action={<button className="text-button" type="button" onClick={() => void mutate('snapshot', '/api/snapshot/refresh', {}, 'Live broker snapshot refreshed.')} disabled={!status.connected || busyAction === 'snapshot'}><RefreshCw className={busyAction === 'snapshot' ? 'spin' : ''} size={14} /> Refresh</button>}
                />
                <PositionsTable positions={activePositions} />
              </div>
              <aside className="panel breakdown-panel">
                <PanelHeader eyebrow="Loss calculation" title="P&L breakdown" detail={status.pnl.source || 'Broker snapshot'} />
                <div className="breakdown-list">
                  <div><span>Gross P&amp;L</span><b className={status.pnl.gross < 0 ? 'negative' : 'positive'}>{formatCurrency(status.pnl.gross, true)}</b></div>
                  <div><span>Estimated charges</span><b>-{formatCurrency(Math.abs(status.pnl.estimatedCharges))}</b></div>
                  <div><span>Safety buffer</span><b>-{formatCurrency(Math.abs(status.pnl.chargeBuffer))}</b></div>
                  <div className="breakdown-total"><span>Guarded total</span><b className={status.pnl.total < 0 ? 'negative' : 'positive'}>{formatCurrency(status.pnl.total, true)}</b></div>
                </div>
                <div className="snapshot-note"><Clock3 size={15} /><span>Snapshot {relativeTime(status.pnl.updatedAt, now)}<small>{formatDateTime(status.pnl.updatedAt, true)}</small></span></div>
              </aside>
            </section>

            <section className="truth-panel">
              <ShieldAlert size={21} />
              <div>
                <strong>Reactive lock — not a broker-side trading block</strong>
                <p>Zerodha can still accept a new order. After today’s lock trips, this service repeatedly polls for exposure and submits reverse orders. Network delays, slippage, market gaps, exchange limits, or rejected orders can increase the final loss.</p>
              </div>
            </section>
          </>
        )}

        {activeTab === 'activity' && (
          <section className="activity-layout">
            <div className="panel">
              <PanelHeader eyebrow="Execution ledger" title="Recent orders" detail={`${recentOrders.length} shown`} />
              <OrdersTable orders={recentOrders} />
            </div>
            <div className="panel">
              <PanelHeader eyebrow="Conditional exposure" title="GTT triggers" detail={`${status.gtts.length} trigger${status.gtts.length === 1 ? '' : 's'}`} />
              <GttTable gtts={status.gtts} />
              {status.gtts.length > 0 && !status.settings.cancelGttOnKill && (
                <div className="panel-alert"><AlertTriangle size={16} /> GTT cancellation on breach is disabled. A trigger could reopen exposure after flattening.</div>
              )}
            </div>
            <div className="panel action-panel">
              <PanelHeader eyebrow="Audit trail" title="Guard actions" detail={`${recentActions.length} events`} />
              <ActionTimeline actions={recentActions} />
            </div>
          </section>
        )}

        {activeTab === 'settings' && (
          <section className="settings-layout">
            <form className="panel settings-form" onSubmit={saveSettings}>
              <PanelHeader eyebrow="Enforcement policy" title="Risk settings" detail={status.kill.active ? 'Frozen for today' : 'Applies immediately'} />
              {status.kill.active && (
                <div className="locked-settings-note"><LockKeyhole size={18} /><div><strong>Today’s policy is locked</strong><span>Settings cannot be weakened or monitoring stopped after a breach. Arm the next trading day when you are ready.</span></div></div>
              )}
              <fieldset disabled={status.kill.active || busyAction === 'settings'}>
                <div className="form-grid">
                  <label className="field">
                    <span>Daily loss limit <small>INR</small></span>
                    <div className="input-prefix"><span>₹</span><input type="number" min="1" step="1" value={settingsDraft.maxLoss} onChange={(event) => updateDraft('maxLoss', event.target.value)} /></div>
                    <small>Must be greater than ₹0.</small>
                  </label>
                  <label className="field">
                    <span>Charge safety buffer <small>INR</small></span>
                    <div className="input-prefix"><span>₹</span><input type="number" min="0" step="1" value={settingsDraft.chargeBuffer} onChange={(event) => updateDraft('chargeBuffer', event.target.value)} /></div>
                    <small>Added to estimated charges before threshold evaluation.</small>
                  </label>
                  <label className="field">
                    <span>Risk polling <small>milliseconds</small></span>
                    <input type="number" min="1000" step="250" value={settingsDraft.riskPollMs} onChange={(event) => updateDraft('riskPollMs', event.target.value)} />
                    <small>Minimum 1,000 ms. Faster polling increases API use.</small>
                  </label>
                  <label className="field">
                    <span>Lock guard polling <small>milliseconds</small></span>
                    <input type="number" min="750" step="250" value={settingsDraft.guardPollMs} onChange={(event) => updateDraft('guardPollMs', event.target.value)} />
                    <small>Minimum 750 ms while the lock is enforcing.</small>
                  </label>
                  <label className="field">
                    <span>Market protection <small>percent</small></span>
                    <div className="input-suffix"><input type="number" min="-1" max="100" step="1" value={settingsDraft.marketProtection} onChange={(event) => updateDraft('marketProtection', event.target.value)} /><span>%</span></div>
                    <small>Use -1 for Kite automatic protection, 0 to disable, or 1–100%.</small>
                  </label>
                </div>
                <div className="setting-section">
                  <div className="setting-copy"><strong>Products to flatten</strong><span>Only selected broker product types will be reversed after the lock trips.</span></div>
                  <div className="product-pills">
                    {PRODUCTS.map((product) => (
                      <label key={product} className={settingsDraft.flattenProducts.includes(product) ? 'selected' : ''}>
                        <input type="checkbox" checked={settingsDraft.flattenProducts.includes(product)} onChange={() => toggleProduct(product)} />
                        <span>{product}</span>
                        {settingsDraft.flattenProducts.includes(product) && <CheckCircle2 size={14} />}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="setting-section toggle-row">
                  <div className="setting-copy"><strong>Cancel active GTTs on breach</strong><span>Prevents a later GTT trigger from reopening exposure after positions are flattened.</span></div>
                  <label className="switch">
                    <input type="checkbox" checked={settingsDraft.cancelGttOnKill} onChange={(event) => updateDraft('cancelGttOnKill', event.target.checked)} />
                    <span aria-hidden="true" />
                    <b>{settingsDraft.cancelGttOnKill ? 'On' : 'Off'}</b>
                  </label>
                </div>
                <div className="form-actions">
                  <span>{settingsDirty ? 'You have unsaved changes.' : 'Settings match the running guard.'}</span>
                  <button className="btn btn-primary" type="submit" disabled={!settingsDirty || busyAction === 'settings'}>
                    {busyAction === 'settings' ? <Loader2 className="spin" size={17} /> : <Save size={17} />} Save settings
                  </button>
                </div>
              </fieldset>
              {status.kill.active && (
                <div className="next-day-action">
                  <div><strong>Prepare the next trading day</strong><span>The server will keep today’s latch intact and only arm a valid next-day session.</span></div>
                  <button className="btn btn-secondary" type="button" onClick={() => void mutate('arm-next-day', '/api/kill/arm-next-day', {}, 'Next trading day is armed.')} disabled={busyAction !== null || !canArmNextDay} title={!canArmNextDay ? 'Available on the next trading day after protected exposure is verified clear' : undefined}>
                    <ShieldCheck size={17} /> {canArmNextDay ? 'Arm next trading day' : 'Available next trading day'}
                  </button>
                </div>
              )}
            </form>

            <aside className="settings-sidebar">
              <div className="panel compact-panel">
                <PanelHeader eyebrow="Broker session" title={status.connected ? 'Kite connected' : 'Kite disconnected'} detail={status.user?.loginAt ? `Since ${formatDateTime(status.user.loginAt)}` : 'No active session'} />
                <div className="connection-summary"><span className={status.connected ? 'connection-orb online' : 'connection-orb'} /><div><strong>{userName}</strong><span>{status.connected ? 'Broker APIs available' : 'No live broker access'}</span></div></div>
                {status.connected ? (
                  <button className="btn btn-secondary btn-block" type="button" onClick={() => void mutate('session-logout', '/api/session/logout', {}, 'Kite session disconnected.')} disabled={status.kill.active || busyAction !== null} title={status.kill.active ? 'Kite logout is blocked while today’s lock is active' : undefined}>
                    <LogOut size={16} /> Disconnect Kite
                  </button>
                ) : (
                  <button className="btn btn-primary btn-block" type="button" onClick={() => void connectKite()} disabled={busyAction !== null}><ExternalLink size={16} /> Connect Kite</button>
                )}
              </div>
              <div className="panel compact-panel health-list">
                <PanelHeader eyebrow="Runtime" title="Health details" />
                <div><span>Risk check</span><b>{relativeTime(status.health.lastRiskCheckAt, now)}</b></div>
                <div><span>Guard check</span><b>{relativeTime(status.health.lastGuardCheckAt, now)}</b></div>
                <div><span>Last success</span><b>{relativeTime(status.health.lastSuccessAt, now)}</b></div>
                <div><span>Broker feed</span><b>{websocketState(status.health.websocket)}</b></div>
                <div><span>Failures</span><b className={status.health.consecutiveFailures ? 'negative' : ''}>{status.health.consecutiveFailures}</b></div>
              </div>
            </aside>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <span><Shield size={14} /> TradeGuardian reactive risk control</span>
        <span>{API_BASE ? `API: ${API_BASE}` : 'API: same origin'}</span>
      </footer>

      {confirmKill && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirmKill(false)
        }}>
          <section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="kill-title" aria-describedby="kill-description">
            <button className="modal-close" type="button" onClick={() => setConfirmKill(false)} aria-label="Close confirmation"><X size={18} /></button>
            <span className="modal-icon"><ShieldAlert size={27} /></span>
            <span className="overline">Irreversible for today</span>
            <h2 id="kill-title">Activate the reactive lock now?</h2>
            <p id="kill-description">The guard will cancel eligible open orders, cancel GTTs if configured, and submit reverse orders for selected products. It will remain latched and keep flattening newly detected exposure for the rest of the trading day.</p>
            <div className="modal-warning"><AlertTriangle size={16} /> Exits are market operations and may fill with slippage or be rejected by the exchange.</div>
            <div className="modal-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setConfirmKill(false)} disabled={busyAction === 'kill'}>Keep monitoring</button>
              <button className="btn btn-danger" type="button" onClick={() => void activateKill()} disabled={busyAction === 'kill'}>
                {busyAction === 'kill' ? <Loader2 className="spin" size={17} /> : <ShieldAlert size={17} />} Activate and flatten
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function InlineNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <div className={`inline-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      {notice.tone === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <span>{notice.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss message"><X size={15} /></button>
    </div>
  )
}

function PanelHeader({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <div className="panel-header">
      <div><span className="overline">{eyebrow}</span><h2>{title}</h2></div>
      <div className="panel-header-side">{detail && <span>{detail}</span>}{action}</div>
    </div>
  )
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span><CheckCircle2 size={21} /></span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}

function PositionsTable({ positions }: { positions: OpenPosition[] }) {
  if (!positions.length) return <EmptyState title="No open positions" detail="The latest broker snapshot has no non-zero exposure." />
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Instrument</th><th>Product</th><th className="number-cell">Quantity</th><th className="number-cell">Average</th><th className="number-cell">Last</th><th className="number-cell">P&amp;L</th></tr></thead>
        <tbody>
          {positions.map((position, index) => {
            const quantity = numberOr(position.quantity)
            const pnl = positionPnl(position)
            const averagePrice = position.averagePrice ?? position.average_price
            const lastPrice = position.lastPrice ?? position.last_price
            return (
              <tr key={`${position.exchange}-${position.tradingsymbol}-${position.product}-${index}`}>
                <td><div className="instrument"><strong>{position.tradingsymbol || '—'}</strong><span>{position.exchange || '—'}</span></div></td>
                <td><span className="product-badge">{position.product || '—'}</span></td>
                <td className={`number-cell ${quantity < 0 ? 'negative' : 'positive'}`}>{quantity > 0 ? `+${quantity}` : quantity}</td>
                <td className="number-cell">{averagePrice == null ? '—' : formatCurrency(numberOr(averagePrice))}</td>
                <td className="number-cell">{lastPrice == null ? '—' : formatCurrency(numberOr(lastPrice))}</td>
                <td className={`number-cell strong-cell ${pnl < 0 ? 'negative' : 'positive'}`}>{formatCurrency(pnl, true)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function OrdersTable({ orders }: { orders: BrokerOrder[] }) {
  if (!orders.length) return <EmptyState title="No orders reported" detail="Broker order history will appear here after the first successful snapshot." />
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Time / order</th><th>Instrument</th><th>Side</th><th className="number-cell">Fill</th><th>Status</th><th>Tag</th></tr></thead>
        <tbody>
          {orders.map((order, index) => (
            <tr key={order.order_id || index}>
              <td><div className="instrument"><strong>{formatDateTime(order.order_timestamp)}</strong><span>{order.order_id || 'No order ID'}</span></div></td>
              <td><div className="instrument"><strong>{order.tradingsymbol || '—'}</strong><span>{order.exchange || '—'} · {order.product || '—'}</span></div></td>
              <td><span className={`side-badge ${String(order.transaction_type).toLowerCase()}`}>{order.transaction_type || '—'}</span></td>
              <td className="number-cell"><strong>{numberOr(order.filled_quantity)}</strong><span className="muted-inline"> / {numberOr(order.quantity)}</span></td>
              <td><span className={`status-badge ${statusTone(order.status)}`}>{order.status || 'UNKNOWN'}</span>{order.status_message && <span className="cell-note" title={order.status_message}>{order.status_message}</span>}</td>
              <td><span className={order.tag === 'KSGUARD' ? 'guard-tag' : 'muted-inline'}>{order.tag || '—'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GttTable({ gtts }: { gtts: GttTrigger[] }) {
  if (!gtts.length) return <EmptyState title="No active GTT triggers" detail="No conditional order exposure was returned by the broker." />
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Instrument</th><th>Type</th><th>Trigger</th><th>Legs</th><th>Status</th></tr></thead>
        <tbody>
          {gtts.map((gtt, index) => (
            <tr key={String(gtt.id ?? index)}>
              <td><div className="instrument"><strong>{gttSymbol(gtt)}</strong><span>{gttExchange(gtt)}</span></div></td>
              <td>{gtt.type || '—'}</td>
              <td>{gttTriggers(gtt)}</td>
              <td>{gtt.orders?.length || 0}</td>
              <td><span className={`status-badge ${statusTone(gtt.status)}`}>{gtt.status || 'UNKNOWN'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ActionTimeline({ actions }: { actions: GuardAction[] }) {
  if (!actions.length) return <EmptyState title="No guard actions yet" detail="Monitoring checks, cancellations, and exit attempts will be recorded here." />
  return (
    <ol className="timeline">
      {actions.map((action, index) => {
        const type = String(action.type || 'INFO').toUpperCase()
        const danger = type.includes('ERROR') || type.includes('FAIL') || type.includes('REJECT')
        const important = type.includes('KILL') || type.includes('FLATTEN') || type.includes('EXIT')
        return (
          <li key={`${action.at}-${index}`} className={danger ? 'danger' : important ? 'important' : ''}>
            <span className="timeline-dot" />
            <div className="timeline-copy"><span className="action-type">{type}</span><strong>{action.message || 'Guard event'}</strong></div>
            <time>{formatDateTime(action.at, true)}</time>
            <ChevronRight size={15} />
          </li>
        )
      })}
    </ol>
  )
}
