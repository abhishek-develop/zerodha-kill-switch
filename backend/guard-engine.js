const GUARD_TAG = "KSGUARD";

const OPEN_ORDER_STATUSES = new Set([
  "OPEN",
  "TRIGGER PENDING",
  "OPEN PENDING",
  "VALIDATION PENDING",
  "PUT ORDER REQ RECEIVED",
  "MODIFY VALIDATION PENDING",
  "MODIFY PENDING",
  "AMO REQ RECEIVED",
]);

const PENDING_ORDER_STATUSES = new Set([
  ...OPEN_ORDER_STATUSES,
  "CANCEL PENDING",
]);

const TERMINAL_ORDER_STATUSES = new Set(["COMPLETE", "CANCELLED", "REJECTED"]);
const KNOWN_ORDER_STATUSES = new Set([...PENDING_ORDER_STATUSES, ...TERMINAL_ORDER_STATUSES]);
const KNOWN_GTT_STATUSES = new Set([
  "active",
  "triggered",
  "disabled",
  "expired",
  "cancelled",
  "rejected",
  "deleted",
]);

export class GuardInvariantError extends Error {
  constructor(message, { code = "GUARD_INVARIANT", status = 409 } = {}) {
    super(message);
    this.name = "GuardInvariantError";
    this.code = code;
    this.status = status;
  }
}

export function createFreshState(defaultSettings, now = new Date()) {
  return {
    version: 2,
    session: null,
    monitoring: false,
    day: { date: tradingDate(now), accountId: null },
    settings: clone(defaultSettings),
    kill: freshKill(),
    pnl: freshPnl(defaultSettings.chargeBuffer),
    positions: [],
    orders: [],
    gtts: [],
    health: {
      status: "DISCONNECTED",
      lastRiskCheckAt: null,
      lastGuardCheckAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      lastError: null,
      websocket: "REST_POLLING",
    },
    actions: [],
    internal: {
      chargesFingerprint: null,
      lastGttCheckAt: null,
    },
  };
}

export function normalizeState(loaded, defaultSettings, now = new Date()) {
  const fresh = createFreshState(defaultSettings, now);
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return fresh;

  const legacySettings = loaded.settings || {};
  const settings = {
    ...fresh.settings,
    ...legacySettings,
    riskPollMs: finiteOr(legacySettings.riskPollMs ?? legacySettings.pnlPollMs, fresh.settings.riskPollMs),
    flattenProducts: Array.isArray(legacySettings.flattenProducts)
      ? legacySettings.flattenProducts.map((item) => String(item).toUpperCase())
      : fresh.settings.flattenProducts,
    cancelGttOnKill:
      typeof legacySettings.cancelGttOnKill === "boolean"
        ? legacySettings.cancelGttOnKill
        : fresh.settings.cancelGttOnKill,
  };

  const legacyKill = loaded.kill && typeof loaded.kill === "object" && !Array.isArray(loaded.kill)
    ? loaded.kill
    : {};
  const active = Boolean(legacyKill.active);
  const kill = {
    ...fresh.kill,
    ...legacyKill,
    active,
    date: active ? resolveActiveKillDate(legacyKill, loaded.day, now) : null,
    accountId: active
      ? nonEmptyString(legacyKill.accountId) || nonEmptyString(loaded.session?.userId) || null
      : null,
    phase: active ? legacyKill.phase || "TRIPPED" : "ARMED",
    verifiedFlat: active && Boolean(legacyKill.verifiedFlat),
    exitAttempts:
      legacyKill.exitAttempts &&
      typeof legacyKill.exitAttempts === "object" &&
      !Array.isArray(legacyKill.exitAttempts)
        ? legacyKill.exitAttempts
        : {},
  };

  return {
    ...fresh,
    ...loaded,
    version: 2,
    session: loaded.session || null,
    monitoring: active ? true : Boolean(loaded.monitoring),
    day: { ...fresh.day, ...(loaded.day || {}) },
    settings,
    kill,
    pnl: { ...fresh.pnl, ...(loaded.pnl || {}), chargeBuffer: settings.chargeBuffer },
    positions: Array.isArray(loaded.positions) ? loaded.positions : [],
    orders: Array.isArray(loaded.orders) ? loaded.orders : [],
    gtts: Array.isArray(loaded.gtts) ? loaded.gtts : [],
    health: { ...fresh.health, ...(loaded.health || {}) },
    actions: Array.isArray(loaded.actions) ? loaded.actions.slice(-400) : [],
    internal: { ...fresh.internal, ...(loaded.internal || {}) },
  };
}

export function calculateDailyPnl(positions, estimatedCharges = 0, chargeBuffer = 0) {
  const gross = (positions || []).reduce((total, position, index) => {
    if (!hasFiniteNumber(position?.m2m)) {
      throw new TypeError(`Kite net position ${index} has no valid daily m2m`);
    }
    return total + Number(position.m2m);
  }, 0);
  const charges = Math.max(0, finiteOr(estimatedCharges, 0));
  const buffer = Math.max(0, finiteOr(chargeBuffer, 0));
  return {
    gross,
    estimatedCharges: charges,
    chargeBuffer: buffer,
    total: gross - charges - buffer,
    source: "KITE_POSITION_M2M",
  };
}

export function isOpenOrder(order) {
  return OPEN_ORDER_STATUSES.has(normalizeStatus(order?.status));
}

export function isPendingOrder(order) {
  return PENDING_ORDER_STATUSES.has(normalizeStatus(order?.status));
}

export function isGuardOrder(order) {
  const tags = Array.isArray(order?.tags) ? order.tags : [];
  return order?.tag === GUARD_TAG || tags.includes(GUARD_TAG);
}

export function positionKey(position) {
  return [position?.exchange, position?.tradingsymbol, position?.product]
    .map((value) => String(value || ""))
    .join(":");
}

export class GuardEngine {
  constructor({ state, store, client, notifier = null, config, now = () => new Date(), logger = console }) {
    this.state = state;
    this.store = store;
    this.client = client;
    this.notifier = notifier;
    this.config = config;
    this.now = now;
    this.logger = logger;
    this.riskTimer = null;
    this.guardTimer = null;
    this.operationTail = Promise.resolve();
    this.cleanupTasks = new Map();
    this.cleanupWaiters = [];
    this.activeCleanupCount = 0;
    this.maxCleanupConcurrency = 3;
    this.notificationTasks = new Set();
    this.closed = false;
    this.persistenceError = null;
  }

  async start() {
    this.closed = false;
    if (this.state.kill.active) this.state.monitoring = true;
    const sessionAccountId = nonEmptyString(this.state.session?.userId);
    const dailyAccountId = nonEmptyString(this.state.day?.accountId);
    const lockedAccountId = nonEmptyString(this.state.kill.accountId);
    if (
      this.state.kill.active &&
      lockedAccountId &&
      sessionAccountId &&
      lockedAccountId !== sessionAccountId
    ) {
      this.state.session.invalid = true;
      this.state.day.accountId = lockedAccountId;
      this.state.kill.phase = "DEGRADED";
      this.state.health.status = "CRITICAL";
      this.state.health.lastError = "Persisted Kite session does not match the account-bound same-day lock";
      this.log("ACCOUNT_MISMATCH", this.state.health.lastError);
      this.emitAlert("LOCKED_ACCOUNT_MISMATCH", "critical", this.state.health.lastError);
    } else if (sessionAccountId) {
      if (!this.state.kill.active && dailyAccountId && dailyAccountId !== sessionAccountId) {
        this.resetDailySnapshot(this.now(), sessionAccountId);
        this.log("ACCOUNT_CHANGE", "Reset account-scoped daily P&L after detecting a session mismatch");
      } else {
        this.state.day.accountId = lockedAccountId || sessionAccountId;
      }
    }
    if (this.hasUsableSession()) this.state.health.websocket = "REST_POLLING";
    await this.save();
    this.restartLoops({ immediate: true });
  }

  async shutdown() {
    this.closed = true;
    this.clearLoops();
    await this.operationTail.catch(() => undefined);
    await Promise.allSettled([...this.cleanupTasks.values()]);
    await this.operationTail.catch(() => undefined);
    await Promise.allSettled([...this.notificationTasks]);
    await this.save();
  }

  restartLoops({ immediate = false } = {}) {
    this.clearLoops();
    if (this.closed || !this.hasUsableSession()) return;
    if (this.state.kill.active) {
      this.scheduleGuard(immediate ? 0 : this.state.settings.guardPollMs);
    } else if (this.state.monitoring) {
      this.scheduleRisk(immediate ? 0 : this.state.settings.riskPollMs);
    }
  }

  clearLoops() {
    if (this.riskTimer) clearTimeout(this.riskTimer);
    if (this.guardTimer) clearTimeout(this.guardTimer);
    this.riskTimer = null;
    this.guardTimer = null;
  }

  scheduleRisk(delay) {
    if (this.closed || this.riskTimer || this.state.kill.active || !this.state.monitoring || !this.hasUsableSession()) return;
    this.riskTimer = setTimeout(async () => {
      this.riskTimer = null;
      try {
        await this.pollRisk();
      } catch (error) {
        this.logger.error?.(`[RISK_ERROR] ${error.message}`);
      } finally {
        if (!this.closed && !this.state.kill.active && this.state.monitoring && this.hasUsableSession()) {
          this.scheduleRisk(this.state.settings.riskPollMs);
        }
      }
    }, Math.max(0, delay));
    this.riskTimer.unref?.();
  }

  scheduleGuard(delay) {
    if (this.closed || this.guardTimer || !this.state.kill.active || !this.hasUsableSession()) return;
    this.guardTimer = setTimeout(async () => {
      this.guardTimer = null;
      try {
        await this.reconcileKill();
      } catch (error) {
        this.logger.error?.(`[GUARD_ERROR] ${error.message}`);
      } finally {
        if (!this.closed && this.state.kill.active && this.hasUsableSession()) {
          this.scheduleGuard(this.state.settings.guardPollMs);
        }
      }
    }, Math.max(0, delay));
    this.guardTimer.unref?.();
  }

  enqueue(operation) {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.catch(() => undefined);
    return result;
  }

  async connectSession(session) {
    return this.enqueue(async () => {
      if (!session || typeof session !== "object" || Array.isArray(session)) {
        throw new TypeError("Kite session must be an object");
      }
      const accessToken = nonEmptyString(session.access_token);
      const incomingUserId = nonEmptyString(session.user_id);
      if (!accessToken || !incomingUserId) {
        throw new TypeError("Kite session must contain access_token and user_id");
      }
      if (this.state.kill.active) {
        const lockedUserId = nonEmptyString(this.state.kill.accountId) || nonEmptyString(this.state.session?.userId);
        if (!lockedUserId || lockedUserId !== incomingUserId) {
          throw new GuardInvariantError(
            "The active same-day lock is bound to a different Zerodha account",
            { code: "LOCKED_ACCOUNT_MISMATCH", status: 423 },
          );
        }
        this.state.kill.accountId = lockedUserId;
      }
      const previousState = clone(this.state);
      const now = this.now();
      const previousAccountId =
        nonEmptyString(this.state.session?.userId) || nonEmptyString(this.state.day?.accountId);
      this.state.session = {
        accessToken,
        publicToken: session.public_token || null,
        userId: incomingUserId,
        userName: session.user_name || session.user_shortname || null,
        loginAt: now.toISOString(),
        invalid: false,
      };
      if (
        !this.state.kill.active &&
        (this.state.day.date !== tradingDate(now) || previousAccountId !== incomingUserId)
      ) {
        this.resetDailySnapshot(now, incomingUserId);
        if (previousAccountId && previousAccountId !== incomingUserId) {
          this.log("ACCOUNT_CHANGE", `Reset daily P&L before switching to Zerodha account ${incomingUserId}`);
        }
      } else {
        this.state.day.accountId = incomingUserId;
      }
      this.state.monitoring = true;
      this.state.health.status = "CHECKING";
      this.state.health.lastError = null;
      this.state.health.websocket = "REST_POLLING";
      this.log("SESSION", `Connected as ${this.state.session.userName || this.state.session.userId || "Kite user"}`);
      try {
        await this.save();
      } catch (error) {
        restoreObject(this.state, previousState);
        this.restartLoops();
        throw error;
      }

      try {
        if (this.state.kill.active) await this.reconcileKillInternal();
        else await this.pollRiskInternal();
      } finally {
        this.restartLoops();
      }
      return this.state;
    });
  }

  async disconnectSession() {
    return this.enqueue(async () => {
      if (this.state.kill.active) {
        throw new GuardInvariantError("The Kite session cannot be disconnected while the same-day lock is active", {
          code: "LOCK_ACTIVE",
          status: 423,
        });
      }
      const previousState = clone(this.state);
      this.clearLoops();
      this.state.day.accountId = nonEmptyString(this.state.session?.userId) || this.state.day.accountId || null;
      this.state.session = null;
      this.state.monitoring = false;
      this.state.positions = [];
      this.state.orders = [];
      this.state.gtts = [];
      this.state.health = {
        ...this.state.health,
        status: "DISCONNECTED",
        lastError: null,
        websocket: "DISCONNECTED",
      };
      this.log("SESSION", "Disconnected from Kite");
      try {
        await this.save();
      } catch (error) {
        restoreObject(this.state, previousState);
        this.restartLoops();
        throw error;
      }
      return this.state;
    });
  }

  async startMonitoring() {
    return this.enqueue(async () => {
      this.requireSession();
      const previousState = clone(this.state);
      this.state.monitoring = true;
      this.log("MONITOR", "Risk monitoring started");
      try {
        await this.save();
      } catch (error) {
        restoreObject(this.state, previousState);
        this.restartLoops();
        throw error;
      }
      try {
        if (this.state.kill.active) await this.reconcileKillInternal();
        else await this.pollRiskInternal();
      } finally {
        this.restartLoops();
      }
      return this.state;
    });
  }

  async stopMonitoring() {
    return this.enqueue(async () => {
      if (this.state.kill.active) {
        throw new GuardInvariantError("Monitoring cannot be stopped while the same-day lock is active", {
          code: "LOCK_ACTIVE",
          status: 423,
        });
      }
      const previousState = clone(this.state);
      this.state.monitoring = false;
      this.clearLoops();
      this.log("MONITOR", "Risk monitoring stopped");
      try {
        await this.save();
      } catch (error) {
        restoreObject(this.state, previousState);
        this.restartLoops();
        throw error;
      }
      return this.state;
    });
  }

  async updateSettings(settings) {
    return this.enqueue(async () => {
      if (this.state.kill.active) {
        throw new GuardInvariantError("Risk settings are frozen until the next-day lock is armed", {
          code: "LOCK_ACTIVE",
          status: 423,
        });
      }
      const previousState = clone(this.state);
      this.state.settings = clone(settings);
      this.state.pnl = {
        ...calculateDailyPnl([], this.state.pnl.estimatedCharges, settings.chargeBuffer),
        gross: this.state.pnl.gross,
        total: this.state.pnl.gross - this.state.pnl.estimatedCharges - settings.chargeBuffer,
        updatedAt: this.state.pnl.updatedAt,
      };
      this.log("SETTINGS", "Risk settings updated");
      try {
        await this.save();
      } catch (error) {
        restoreObject(this.state, previousState);
        this.restartLoops();
        throw error;
      }
      try {
        if (this.state.monitoring && this.hasUsableSession()) await this.pollRiskInternal();
      } finally {
        // A newly tightened limit must be evaluated immediately, and a
        // transient first poll must still leave the appropriate loop alive.
        this.restartLoops();
      }
      return this.state;
    });
  }

  async refreshSnapshot() {
    if (this.state.kill.active) return this.reconcileKill();
    return this.pollRisk();
  }

  async pollRisk() {
    return this.enqueue(() => this.pollRiskInternal());
  }

  async pollRiskInternal() {
    this.requireSession();
    if (!this.state.monitoring && !this.state.kill.active) return this.state;

    const now = this.now();
    try {
      if (!this.state.kill.active && this.state.day.date !== tradingDate(now)) {
        this.resetDailySnapshot(now);
        this.log("DAY_ROLLOVER", `Started a fresh India trading-day snapshot for ${this.state.day.date}`);
        await this.saveForContinuity("daily rollover");
      }
      const positionsPayload = await this.client.getPositions();
      this.applyPositions(readNetPositions(positionsPayload), now);
      this.state.health.lastRiskCheckAt = now.toISOString();
      this.recordSuccess();
      await this.saveForContinuity("risk snapshot");

      if (!this.state.kill.active && this.lossLimitBreached()) {
        await this.activateKillInternal(
          `Daily loss limit breached: ${formatMoney(this.state.pnl.total)} <= -${formatMoney(this.state.settings.maxLoss)}`,
        );
        return this.state;
      }

      await this.refreshOrdersAndCharges({ allowTrip: true });
      await this.saveForContinuity("risk snapshot");
      return this.state;
    } catch (error) {
      await this.recordFailure(error, "RISK");
      throw error;
    }
  }

  async manualKill(reason = "Manual reactive lock activation") {
    return this.enqueue(async () => {
      this.requireSession();
      await this.activateKillInternal(reason);
      this.restartLoops();
      return this.state;
    });
  }

  async activateKillInternal(reason) {
    if (!this.state.kill.active) {
      const now = this.now();
      this.state.kill = {
        ...freshKill(),
        active: true,
        accountId: this.state.session.userId,
        date: tradingDate(now),
        activatedAt: now.toISOString(),
        reason,
        phase: "TRIPPED",
      };
      this.state.monitoring = true;
      this.log("KILL", reason);
      // Persist the irreversible latch before the first cancellation or exit request.
      // If the disk is unavailable, continue flattening in memory and keep the
      // guard loop alive; the health state remains CRITICAL until a write works.
      await this.saveForContinuity("kill latch");
      this.emitAlert("KILL_ACTIVATED", "critical", reason);
    }
    try {
      await this.reconcileKillInternal();
    } finally {
      // A failed broker read or state write must never leave a newly latched
      // risk loop idle with no guard timer scheduled.
      this.restartLoops();
    }
  }

  async reconcileKill() {
    return this.enqueue(() => this.reconcileKillInternal());
  }

  async reconcileKillInternal({ synchronousGtt = false } = {}) {
    if (!this.state.kill.active) return this.state;
    this.requireSession();

    const now = this.now();
    this.state.kill.lastReconciledAt = now.toISOString();
    this.state.kill.verifiedFlat = false;
    let ordersKnown = false;
    let gttsKnown = !this.state.settings.cancelGttOnKill;
    let hadErrors = false;
    let orders = [];
    let gtts = [];

    const [ordersResult, positionsResult] = await Promise.allSettled([
      this.client.getOrders(),
      this.client.getPositions(),
    ]);

    try {
      if (ordersResult.status === "rejected") throw ordersResult.reason;
      orders = readOrders(ordersResult.value);
      ordersKnown = true;
      this.state.orders = compactOrders(orders);
      this.updateExitAttempts(orders, now);
    } catch (error) {
      hadErrors = true;
      this.log("ORDER_BOOK_ERROR", error.message);
      if (isTokenError(error)) {
        await this.recordFailure(error, "GUARD", true);
        throw error;
      }
    }

    let netPositions;
    try {
      if (positionsResult.status === "rejected") throw positionsResult.reason;
      netPositions = readNetPositions(positionsResult.value);
      this.applyPositions(netPositions, now);
    } catch (error) {
      await this.recordFailure(error, "GUARD", true);
      this.state.kill.phase = "DEGRADED";
      await this.saveForContinuity("malformed or unavailable position snapshot");
      throw error;
    }

    const protectedPositions = netPositions.filter(
      (position) => Number(position.quantity || 0) !== 0 && this.protectsProduct(position.product),
    );
    const positionByKey = new Map(protectedPositions.map((position) => [positionKey(position), position]));
    const pendingOrders = ordersKnown ? orders.filter(isPendingOrder) : [];
    const cancellableOrders = pendingOrders.filter(isOpenOrder);
    const guardOrders = pendingOrders.filter(isGuardOrder);
    const userOrders = pendingOrders.filter((order) => !isGuardOrder(order));
    const userOrdersToCancel = cancellableOrders.filter((order) => !isGuardOrder(order));
    const guardOrdersToCancel = new Set();
    const guardOrdersBlockingExit = new Set();
    const keptGuardOrders = new Map();

    for (const order of guardOrders) {
      const key = positionKey(order);
      const position = positionByKey.get(key);
      if (!position || !orderReducesPosition(order, position) || orderAgeMs(order, now) > this.config.exitOrderMaxAgeMs) {
        guardOrdersBlockingExit.add(order);
        if (isOpenOrder(order)) guardOrdersToCancel.add(order);
        continue;
      }
      if (!keptGuardOrders.has(key)) keptGuardOrders.set(key, []);
      keptGuardOrders.get(key).push(order);
    }

    for (const [key, pendingOrders] of keptGuardOrders) {
      const quantity = Math.abs(Number(positionByKey.get(key)?.quantity || 0));
      const pending = sum(pendingOrders.map(orderPendingQuantity));
      if (pending > quantity) {
        pendingOrders.forEach((order) => {
          guardOrdersBlockingExit.add(order);
          if (isOpenOrder(order)) guardOrdersToCancel.add(order);
        });
        keptGuardOrders.delete(key);
      }
    }

    const cancellationKeys = new Set([...guardOrdersBlockingExit].map(positionKey));
    const ordersToCancel = [...userOrdersToCancel, ...guardOrdersToCancel];
    if (ordersToCancel.length) this.state.kill.phase = "CANCELLING";

    const exitPlans = [];
    for (const position of protectedPositions) {
      const key = positionKey(position);
      if (cancellationKeys.has(key)) continue;
      const keptOrders = keptGuardOrders.get(key) || [];
      const pending = sum(keptOrders.map(orderPendingQuantity));
      const deferred = this.exitAttemptDeferredQuantity(key, position, now, keptOrders);
      const uncovered = Math.max(0, Math.abs(Number(position.quantity)) - pending - deferred);
      if (!uncovered) continue;
      exitPlans.push({ key, position, quantity: uncovered, deferred });
    }

    if (exitPlans.length) this.state.kill.phase = "EXITING";
    for (const plan of exitPlans) {
      const previousAttempt = this.state.kill.exitAttempts[plan.key];
      const carriedOrderIds = plan.deferred > 0 && Array.isArray(previousAttempt?.orderIds)
        ? previousAttempt.orderIds
        : [];
      const attempt = {
        key: plan.key,
        submittedAt: this.now().toISOString(),
        requestedQuantity: plan.quantity + plan.deferred,
        transactionType: Number(plan.position.quantity) > 0 ? "SELL" : "BUY",
        orderIds: [...carriedOrderIds],
        errors: [],
        status: "SUBMITTING",
        terminalObservedAt: null,
        tryCount: finiteOr(previousAttempt?.tryCount, 0) + 1,
      };
      this.state.kill.exitAttempts[plan.key] = attempt;
      plan.attempt = attempt;
    }
    if (exitPlans.length) await this.saveForContinuity("exit intents");

    // Exit requests are the critical path. Cleanup starts concurrently and is
    // tracked across cycles, so slow cancel/GTT endpoints cannot stop the
    // one-second exposure reconciliation loop.
    const exitWork = mapConcurrent(exitPlans, 3, async (plan) => {
      const { attempt } = plan;

      try {
        const result = await this.client.placeExit(plan.position, plan.quantity, {
          marketProtection: this.state.settings.marketProtection,
          tag: GUARD_TAG,
        });
        const newOrderIds = result.orderIds || [];
        attempt.orderIds = [...new Set([...attempt.orderIds, ...newOrderIds])];
        attempt.errors = (result.errors || []).map((error) => error?.message || String(error));
        attempt.status = newOrderIds.length ? "SUBMITTED" : (attempt.orderIds.length ? "UNCERTAIN" : "REJECTED");
        if (newOrderIds.length) {
          this.log(
            "EXIT_SUBMIT",
            `${Number(plan.position.quantity) > 0 ? "SELL" : "BUY"} ${plan.quantity} ${plan.key} (${newOrderIds.join(", ")})`,
          );
        }
        if (attempt.errors.length) {
          hadErrors = true;
          const tokenError = (result.errors || []).find(isTokenError);
          if (tokenError) this.markTokenInvalid(tokenError);
          this.log("EXIT_PARTIAL_ERROR", `${plan.key}: ${attempt.errors.join("; ")}`);
        }
      } catch (error) {
        hadErrors = true;
        if (isTokenError(error)) this.markTokenInvalid(error);
        attempt.status = "UNCERTAIN";
        attempt.errors = [error.message];
        this.log("EXIT_UNCERTAIN", `${plan.key}: ${error.message}`);
      }
    });

    for (const order of ordersToCancel) {
      this.launchCleanup(
        `order:${order.order_id}`,
        () => this.client.cancelOrder(order),
        () => this.log(
          isGuardOrder(order) ? "EXIT_CANCEL" : "ORDER_CANCEL",
          `${order.order_id} ${order.exchange || ""}:${order.tradingsymbol || ""}`.trim(),
        ),
        (error) => this.log("CANCEL_ERROR", `${order.order_id}: ${error.message}`),
      );
    }

    if (this.state.settings.cancelGttOnKill && this.shouldRefreshGtts(now)) {
      if (synchronousGtt) {
        try {
          gtts = readGtts(await this.client.getGtts());
          this.state.gtts = compactGtts(gtts);
          const active = gtts.filter((gtt) => String(gtt.status).toLowerCase() === "active");
          const results = await Promise.allSettled(active.map((gtt) => this.client.deleteGtt(gtt.id)));
          results.forEach((result, index) => {
            const gtt = active[index];
            if (result.status === "fulfilled") this.log("GTT_DELETE", `Deleted active GTT ${gtt.id}`);
            else {
              hadErrors = true;
              if (isTokenError(result.reason)) this.markTokenInvalid(result.reason);
              this.log("GTT_DELETE_ERROR", `${gtt.id}: ${result.reason?.message || result.reason}`);
            }
          });
          gttsKnown = active.length === 0 && !hadErrors;
          this.state.internal.lastGttCheckAt = gttsKnown ? now.toISOString() : null;
        } catch (error) {
          hadErrors = true;
          if (isTokenError(error)) this.markTokenInvalid(error);
          gttsKnown = false;
          this.state.internal.lastGttCheckAt = null;
          this.log("GTT_BOOK_ERROR", error.message);
        }
      } else {
        this.launchGttRefresh(now);
        gtts = this.state.gtts;
        // A refresh was required, so persisted GTT data is stale until the
        // tracked cleanup task completes and a subsequent broker read is clear.
        gttsKnown = false;
      }
    } else if (this.state.settings.cancelGttOnKill) {
      gtts = this.state.gtts;
      gttsKnown = Boolean(this.state.internal.lastGttCheckAt);
    }

    await exitWork;
    if (exitPlans.length) await this.saveForContinuity("exit results");

    const activeGtts = (gtts || this.state.gtts).filter(
      (gtt) => String(gtt.status).toLowerCase() === "active",
    );
    const pendingGuardOrders = guardOrders;
    const verifiedFlat =
      ordersKnown &&
      protectedPositions.length === 0 &&
      userOrders.length === 0 &&
      pendingGuardOrders.length === 0 &&
      (!this.state.settings.cancelGttOnKill || (gttsKnown && activeGtts.length === 0));

    this.state.kill.verifiedFlat = verifiedFlat;
    this.state.kill.unresolvedExposureCount =
      protectedPositions.length + userOrders.length + pendingGuardOrders.length + activeGtts.length;
    if (verifiedFlat) {
      this.state.kill.phase = "LOCKED";
      if (!this.state.kill.flatVerifiedAt) {
        this.state.kill.flatVerifiedAt = this.now().toISOString();
        this.log("LOCKED", "All protected positions, open orders, and active GTTs are verified clear");
        this.emitAlert("VERIFIED_FLAT", "info", "Protected positions, pending orders, and active GTTs are verified clear");
      }
    } else if (hadErrors) {
      this.state.kill.phase = "DEGRADED";
    } else if (ordersToCancel.length) {
      this.state.kill.phase = "CANCELLING";
    } else {
      this.state.kill.phase = "EXITING";
    }

    this.state.health.lastGuardCheckAt = now.toISOString();
    if (!this.hasUsableSession()) {
      this.state.kill.phase = "DEGRADED";
      this.state.health.status = "CRITICAL";
      this.state.health.lastError ||= "Kite access token became unavailable during reconciliation";
    } else if (hadErrors) {
      this.state.health.status = "DEGRADED";
      this.state.health.consecutiveFailures += 1;
      this.state.health.lastError ||= "One or more reconciliation actions failed; retrying";
    } else {
      this.recordSuccess();
    }
    await this.saveForContinuity("kill reconciliation");
    return this.state;
  }

  async armNextDay() {
    return this.enqueue(async () => {
      this.requireSession();
      if (!this.state.kill.active) return this.state;
      const today = tradingDate(this.now());
      if (!isTradingDate(this.state.kill.date) || this.state.kill.date >= today) {
        throw new GuardInvariantError("The reactive lock cannot be cleared on the day it was triggered", {
          code: "SAME_DAY_LOCK",
          status: 423,
        });
      }

      await this.reconcileKillInternal({ synchronousGtt: true });
      if (!this.state.kill.verifiedFlat) {
        throw new GuardInvariantError("The new trading day cannot be armed until the account is verified flat", {
          code: "NOT_VERIFIED_FLAT",
          status: 409,
        });
      }

      const previousState = clone(this.state);
      this.state.kill = freshKill();
      this.resetDailySnapshot(this.now());
      this.state.monitoring = true;
      this.log("ARMED", `Reactive protection armed for ${today}`);
      try {
        await this.save();
      } catch (error) {
        restoreObject(this.state, previousState);
        this.restartLoops();
        throw error;
      }
      try {
        await this.pollRiskInternal();
      } finally {
        this.restartLoops();
      }
      return this.state;
    });
  }

  markTokenInvalid(error) {
    if (!this.state.session) return;
    this.state.session.invalid = true;
    this.state.monitoring = false;
    this.state.health.status = "CRITICAL";
    this.state.health.lastError = error?.message || "Kite access token is invalid";
    if (this.state.kill.active) this.state.kill.phase = "DEGRADED";
    this.clearLoops();
    this.emitAlert("KITE_TOKEN_INVALID", "critical", this.state.health.lastError);
    this.save().catch((saveError) => this.logger.error?.(`[STATE_ERROR] ${saveError.message}`));
  }

  hasUsableSession() {
    return Boolean(this.state.session?.accessToken && !this.state.session.invalid);
  }

  requireSession() {
    if (!this.hasUsableSession()) {
      throw new GuardInvariantError("A valid Kite session is required", {
        code: "KITE_SESSION_REQUIRED",
        status: 401,
      });
    }
  }

  protectsProduct(product) {
    const products = this.state.settings.flattenProducts || [];
    return products.includes("ALL") || products.includes(String(product || "").toUpperCase());
  }

  lossLimitBreached() {
    return Number.isFinite(this.state.pnl.total) && this.state.pnl.total <= -Math.abs(this.state.settings.maxLoss);
  }

  applyPositions(netPositions, now) {
    const calculated = calculateDailyPnl(
      netPositions,
      this.state.pnl.estimatedCharges,
      this.state.settings.chargeBuffer,
    );
    this.state.pnl = { ...calculated, updatedAt: now.toISOString() };
    this.state.positions = (netPositions || [])
      .filter((position) => Number(position.quantity || 0) !== 0)
      .map(compactPosition);
  }

  async refreshOrdersAndCharges({ allowTrip }) {
    try {
      const orders = readOrders(await this.client.getOrders());
      this.state.orders = compactOrders(orders);
      await this.updateCharges(orders, { allowTrip });
    } catch (error) {
      this.state.health.status = "DEGRADED";
      this.state.health.lastError = `Order/charges refresh failed: ${error.message}`;
      this.log("ORDER_REFRESH_ERROR", error.message);
      if (isTokenError(error)) throw error;
    }
  }

  async updateCharges(orders, { allowTrip }) {
    const fingerprint = chargesFingerprint(orders);
    if (fingerprint === this.state.internal.chargesFingerprint) return;
    try {
      const charges = await this.client.calculateOrderCharges(orders);
      this.state.internal.chargesFingerprint = fingerprint;
      this.state.pnl.estimatedCharges = Math.max(0, finiteOr(charges, 0));
      this.state.pnl.chargeBuffer = this.state.settings.chargeBuffer;
      this.state.pnl.total =
        this.state.pnl.gross - this.state.pnl.estimatedCharges - this.state.settings.chargeBuffer;
      if (allowTrip && !this.state.kill.active && this.lossLimitBreached()) {
        await this.activateKillInternal(
          `Daily loss limit breached after estimated charges: ${formatMoney(this.state.pnl.total)} <= -${formatMoney(this.state.settings.maxLoss)}`,
        );
      }
    } catch (error) {
      this.log("CHARGES_ERROR", error.message);
      this.state.health.status = "DEGRADED";
      this.state.health.lastError = `Charge estimation failed: ${error.message}`;
      if (isTokenError(error)) throw error;
    }
  }

  updateExitAttempts(orders, now) {
    const byId = new Map((orders || []).map((order) => [String(order.order_id), order]));
    for (const attempt of Object.values(this.state.kill.exitAttempts || {})) {
      const orderIds = attempt.orderIds || [];
      const matched = orderIds.map((id) => byId.get(String(id))).filter(Boolean);
      if (!matched.length) continue;
      if (matched.length < orderIds.length) {
        attempt.status = "UNCERTAIN";
        continue;
      }
      if (matched.some(isPendingOrder)) {
        attempt.status = "PENDING";
        continue;
      }
      const complete = matched.some((order) => normalizeStatus(order.status) === "COMPLETE");
      attempt.status = complete ? "COMPLETE" : "TERMINAL_FAILED";
      attempt.terminalObservedAt ||= now.toISOString();
    }
  }

  exitAttemptDeferredQuantity(key, position, now, keptOrders = []) {
    const attempt = this.state.kill.exitAttempts?.[key];
    if (!attempt) return 0;
    const expectedTransaction = Number(position.quantity) > 0 ? "SELL" : "BUY";
    const knownTransaction = String(
      attempt.transactionType || keptOrders.find((order) =>
        (attempt.orderIds || []).includes(order.order_id))?.transaction_type || "",
    ).toUpperCase();
    // A same-symbol position can flip direction while an earlier exit is in
    // flight. Never let an old opposite-side attempt suppress the new exit.
    if (knownTransaction !== expectedTransaction) return 0;

    const submittedAge = now.getTime() - new Date(attempt.submittedAt).getTime();
    if (!Number.isFinite(submittedAge) || submittedAge < -60_000) return 0;
    let deferred = false;
    if (["SUBMITTING", "UNCERTAIN", "SUBMITTED", "PENDING"].includes(attempt.status)) {
      deferred = submittedAge < this.config.exitOrderMaxAgeMs;
    } else if (attempt.status === "COMPLETE" && attempt.terminalObservedAt) {
      const terminalAge = now.getTime() - new Date(attempt.terminalObservedAt).getTime();
      deferred = Number.isFinite(terminalAge) && terminalAge >= -60_000 && terminalAge < this.config.settlementGraceMs;
    } else if (["REJECTED", "TERMINAL_FAILED"].includes(attempt.status)) {
      const exponent = Math.max(0, Math.min(5, finiteOr(attempt.tryCount, 1) - 1));
      const retryDelay = Math.min(30_000, this.state.settings.guardPollMs * (2 ** exponent));
      deferred = submittedAge < retryDelay;
    }
    if (!deferred) return 0;

    const attemptIds = new Set((attempt.orderIds || []).map(String));
    const representedPending = sum(
      keptOrders
        .filter((order) => attemptIds.has(String(order.order_id)))
        .map(orderPendingQuantity),
    );
    const requestedQuantity = Number(attempt.requestedQuantity);
    if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0) return 0;
    return Math.max(0, requestedQuantity - representedPending);
  }

  shouldRefreshGtts(now) {
    const previous = this.state.internal.lastGttCheckAt;
    if (!previous) return true;
    const age = now.getTime() - new Date(previous).getTime();
    return !Number.isFinite(age) || age < -60_000 || age >= 15_000;
  }

  recordSuccess() {
    if (!this.hasUsableSession()) {
      this.state.health.status = "CRITICAL";
      this.state.health.lastError ||= "Kite access token is unavailable";
      return;
    }
    if (this.persistenceError) {
      this.state.health.status = "CRITICAL";
      this.state.health.lastError = `STATE: ${this.persistenceError.message}`;
      return;
    }
    const previousStatus = this.state.health.status;
    this.state.health.status = "HEALTHY";
    this.state.health.lastSuccessAt = this.now().toISOString();
    this.state.health.consecutiveFailures = 0;
    this.state.health.lastError = null;
    if (["CRITICAL", "DEGRADED"].includes(previousStatus)) {
      this.emitAlert("PROTECTION_RECOVERED", "info", "Broker reconciliation is healthy again");
    }
  }

  async recordFailure(error, scope, critical = false) {
    if (isTokenError(error)) this.markTokenInvalid(error);
    this.state.health.status = critical || isTokenError(error) ? "CRITICAL" : "DEGRADED";
    this.state.health.consecutiveFailures += 1;
    this.state.health.lastError = `${scope}: ${error.message}`;
    if (this.state.kill.active && critical) this.state.kill.phase = "DEGRADED";
    this.log(`${scope}_ERROR`, error.message);
    if (critical || isTokenError(error)) this.emitAlert(`${scope}_FAILURE`, "critical", error.message);
    if (this.state.kill.active) await this.saveForContinuity(`${scope.toLowerCase()} failure`);
    else await this.save();
  }

  resetDailySnapshot(
    now,
    accountId = nonEmptyString(this.state.session?.userId) || nonEmptyString(this.state.day?.accountId),
  ) {
    this.state.day = { date: tradingDate(now), accountId: accountId || null };
    this.state.pnl = freshPnl(this.state.settings.chargeBuffer);
    this.state.positions = [];
    this.state.orders = [];
    this.state.gtts = [];
    this.state.internal.chargesFingerprint = null;
    this.state.internal.lastGttCheckAt = null;
  }

  log(type, message) {
    const action = { type, message, at: this.now().toISOString() };
    this.state.actions.push(action);
    this.state.actions = this.state.actions.slice(-400);
    this.logger.log?.(`[${type}] ${message}`);
  }

  async save() {
    await this.store.save(this.state);
    this.persistenceError = null;
  }

  async saveForContinuity(scope) {
    try {
      await this.save();
      return true;
    } catch (error) {
      this.persistenceError = error;
      this.state.health.status = "CRITICAL";
      this.state.health.lastError = `STATE: ${error.message}`;
      if (this.state.kill.active) this.state.kill.phase = "DEGRADED";
      const message = `Could not persist ${scope}: ${error.message}`;
      if (this.state.actions.at(-1)?.message !== message) this.log("STATE_ERROR", message);
      this.logger.error?.(`[STATE_ERROR] ${message}`);
      this.emitAlert("STATE_PERSISTENCE_FAILURE", "critical", message);
      return false;
    }
  }

  launchCleanup(key, operation, onSuccess, onFailure) {
    if (this.cleanupTasks.has(key)) return false;
    const task = Promise.resolve()
      .then(() => this.runCleanupOperation(operation))
      .then(
        (result) => this.enqueue(async () => {
          onSuccess?.(result);
          await this.saveForContinuity("broker cleanup result");
        }),
        (error) => this.enqueue(async () => {
          onFailure?.(error);
          if (isTokenError(error)) {
            await this.recordFailure(error, "CLEANUP", true);
            return;
          }
          this.state.health.status = "DEGRADED";
          this.state.health.lastError = `Cleanup failed: ${error.message}`;
          await this.saveForContinuity("broker cleanup failure");
        }),
      )
      .catch((error) => this.logger.error?.(`[CLEANUP_ERROR] ${error.message}`))
      .finally(() => this.cleanupTasks.delete(key));
    this.cleanupTasks.set(key, task);
    return true;
  }

  async runCleanupOperation(operation) {
    if (this.activeCleanupCount >= this.maxCleanupConcurrency) {
      await new Promise((resolve) => this.cleanupWaiters.push(resolve));
    }
    this.activeCleanupCount += 1;
    try {
      return await operation();
    } finally {
      this.activeCleanupCount -= 1;
      this.cleanupWaiters.shift()?.();
    }
  }

  launchGttRefresh(now) {
    return this.launchCleanup(
      "gtt:refresh",
      async () => {
        const gtts = readGtts(await this.client.getGtts());
        const active = gtts.filter((gtt) => String(gtt.status).toLowerCase() === "active");
        const deletionResults = await Promise.allSettled(active.map((gtt) => this.client.deleteGtt(gtt.id)));
        return { gtts, active, deletionResults };
      },
      ({ gtts, active, deletionResults }) => {
        this.state.gtts = compactGtts(gtts);
        let failed = false;
        deletionResults.forEach((result, index) => {
          const gtt = active[index];
          if (result.status === "fulfilled") this.log("GTT_DELETE", `Deleted active GTT ${gtt.id}`);
          else {
            failed = true;
            if (isTokenError(result.reason)) this.markTokenInvalid(result.reason);
            this.log("GTT_DELETE_ERROR", `${gtt.id}: ${result.reason?.message || result.reason}`);
          }
        });
        // If anything was active, force a fresh broker read on the next cycle
        // before allowing VERIFIED_FLAT/LOCKED.
        this.state.internal.lastGttCheckAt = !active.length && !failed ? now.toISOString() : null;
      },
      (error) => {
        this.state.internal.lastGttCheckAt = null;
        this.log("GTT_BOOK_ERROR", error.message);
      },
    );
  }

  emitAlert(type, severity, message) {
    if (!this.notifier?.enabled) return;
    let task;
    task = Promise.resolve()
      .then(() => this.notifier.notify({
        type,
        severity,
        message,
        phase: this.state.kill.phase,
      }))
      .catch((error) => this.logger.error?.(`[ALERT_ERROR] ${error.message}`))
      .finally(() => this.notificationTasks.delete(task));
    this.notificationTasks.add(task);
  }
}

function freshKill() {
  return {
    active: false,
    accountId: null,
    date: null,
    activatedAt: null,
    reason: null,
    phase: "ARMED",
    verifiedFlat: false,
    flatVerifiedAt: null,
    lastReconciledAt: null,
    unresolvedExposureCount: 0,
    exitAttempts: {},
  };
}

function freshPnl(chargeBuffer = 0) {
  return {
    gross: 0,
    estimatedCharges: 0,
    chargeBuffer: finiteOr(chargeBuffer, 0),
    total: -finiteOr(chargeBuffer, 0),
    source: "NOT_AVAILABLE",
    updatedAt: null,
  };
}

function compactPosition(position) {
  const averagePrice = finiteOr(position.average_price ?? position.averagePrice, 0);
  const lastPrice = finiteOr(position.last_price ?? position.lastPrice, 0);
  return {
    exchange: position.exchange,
    tradingsymbol: position.tradingsymbol,
    product: position.product,
    quantity: finiteOr(position.quantity, 0),
    average_price: averagePrice,
    last_price: lastPrice,
    // Keep the original camel-case aliases for encrypted-state migrations.
    averagePrice,
    lastPrice,
    pnl: finiteOr(position.pnl, 0),
    m2m: finiteOr(position.m2m, finiteOr(position.realised, 0) + finiteOr(position.unrealised, 0)),
    realised: finiteOr(position.realised, 0),
    unrealised: finiteOr(position.unrealised, 0),
  };
}

function compactOrders(orders) {
  return (orders || []).slice(-100).map((order) => ({
    order_id: order.order_id,
    exchange: order.exchange,
    tradingsymbol: order.tradingsymbol,
    transaction_type: order.transaction_type,
    quantity: finiteOr(order.quantity, 0),
    filled_quantity: finiteOr(order.filled_quantity, 0),
    pending_quantity: finiteOr(order.pending_quantity, 0),
    average_price: finiteOr(order.average_price, 0),
    status: order.status,
    status_message: order.status_message || null,
    product: order.product,
    variety: order.variety,
    tag: order.tag || null,
    tags: Array.isArray(order.tags) ? order.tags : [],
    order_timestamp: order.order_timestamp || null,
    exchange_update_timestamp: order.exchange_update_timestamp || null,
  }));
}

function compactGtts(gtts) {
  return (gtts || []).slice(-100).map((gtt) => ({
    id: gtt.id,
    status: gtt.status,
    type: gtt.type,
    tradingsymbol: gtt.condition?.tradingsymbol,
    exchange: gtt.condition?.exchange,
    trigger_values: gtt.condition?.trigger_values || gtt.trigger_values || [],
    last_price: finiteOr(gtt.condition?.last_price ?? gtt.last_price, 0),
    orders: Array.isArray(gtt.orders) ? gtt.orders : [],
    created_at: gtt.created_at || null,
    updated_at: gtt.updated_at || null,
  }));
}

function orderReducesPosition(order, position) {
  const quantity = Number(position.quantity || 0);
  const transaction = String(order.transaction_type || "").toUpperCase();
  return (quantity > 0 && transaction === "SELL") || (quantity < 0 && transaction === "BUY");
}

function orderPendingQuantity(order) {
  const pending = Number(order.pending_quantity);
  if (Number.isFinite(pending) && pending >= 0) return pending;
  return Math.max(0, finiteOr(order.quantity, 0) - finiteOr(order.filled_quantity, 0));
}

function orderAgeMs(order, now) {
  const timestamp = order.exchange_update_timestamp || order.order_timestamp;
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(timestamp)
    ? `${timestamp.replace(" ", "T")}+05:30`
    : timestamp;
  const parsed = new Date(normalized).getTime();
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  const age = now.getTime() - parsed;
  return age < -60_000 ? Number.POSITIVE_INFINITY : Math.max(0, age);
}

function readNetPositions(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Kite positions response must be an object");
  }
  const positions = requireArray(payload.net, "Kite net positions");
  const keys = new Set();
  positions.forEach((position, index) => {
    if (!position || typeof position !== "object" || Array.isArray(position)) {
      throw new TypeError(`Kite net position ${index} must be an object`);
    }
    for (const field of ["exchange", "tradingsymbol", "product"]) {
      if (!nonEmptyString(position[field])) {
        throw new TypeError(`Kite net position ${index} is missing ${field}`);
      }
    }
    if (!isFiniteInteger(position.quantity)) {
      throw new TypeError(`Kite net position ${index} has an invalid quantity`);
    }
    if (!hasFiniteNumber(position.m2m)) {
      throw new TypeError(`Kite net position ${index} has no valid daily m2m`);
    }
    const key = positionKey(position);
    if (keys.has(key)) {
      throw new TypeError(`Kite net positions contain duplicate instrument key ${key}`);
    }
    keys.add(key);
  });
  return positions;
}

function readOrders(value) {
  const orders = requireArray(value, "Kite orders");
  const orderIds = new Set();
  orders.forEach((order, index) => {
    if (!order || typeof order !== "object" || Array.isArray(order)) {
      throw new TypeError(`Kite order ${index} must be an object`);
    }
    const orderId = nonEmptyString(order.order_id);
    if (!orderId) throw new TypeError(`Kite order ${index} is missing order_id`);
    if (orderIds.has(orderId)) throw new TypeError(`Kite orders contain duplicate order_id ${orderId}`);
    orderIds.add(orderId);
    const status = normalizeStatus(order.status);
    if (!KNOWN_ORDER_STATUSES.has(status)) {
      throw new TypeError(`Kite order ${index} has an unknown status`);
    }
    if (!isFiniteInteger(order.quantity) || Number(order.quantity) <= 0) {
      throw new TypeError(`Kite order ${index} has an invalid quantity`);
    }
    if (!isFiniteInteger(order.filled_quantity) || Number(order.filled_quantity) < 0) {
      throw new TypeError(`Kite order ${index} has an invalid filled_quantity`);
    }
    if (Number(order.filled_quantity) > Number(order.quantity)) {
      throw new TypeError(`Kite order ${index} has filled_quantity above quantity`);
    }
    if (order.average_price != null && (!hasFiniteNumber(order.average_price) || Number(order.average_price) < 0)) {
      throw new TypeError(`Kite order ${index} has an invalid average_price`);
    }
    if (PENDING_ORDER_STATUSES.has(status) || Number(order.filled_quantity) > 0) {
      for (const field of ["exchange", "tradingsymbol", "product"]) {
        if (!nonEmptyString(order[field])) throw new TypeError(`Kite order ${index} is missing ${field}`);
      }
      if (!["BUY", "SELL"].includes(String(order.transaction_type || "").toUpperCase())) {
        throw new TypeError(`Kite order ${index} has an invalid transaction_type`);
      }
    }
    if (PENDING_ORDER_STATUSES.has(status)) {
      if (order.pending_quantity != null && (!isFiniteInteger(order.pending_quantity) || Number(order.pending_quantity) < 0)) {
        throw new TypeError(`Pending Kite order ${index} has an invalid pending_quantity`);
      }
    }
    if (Number(order.filled_quantity) > 0) {
      if (!hasFiniteNumber(order.average_price) || Number(order.average_price) <= 0) {
        throw new TypeError(`Filled Kite order ${index} has an invalid average_price`);
      }
      if (!nonEmptyString(order.order_type)) {
        throw new TypeError(`Filled Kite order ${index} is missing order_type`);
      }
    }
  });
  return orders;
}

function readGtts(value) {
  const gtts = requireArray(value, "Kite GTT triggers");
  const ids = new Set();
  gtts.forEach((gtt, index) => {
    if (!gtt || typeof gtt !== "object" || Array.isArray(gtt)) {
      throw new TypeError(`Kite GTT trigger ${index} must be an object`);
    }
    if (gtt.id === null || gtt.id === undefined || String(gtt.id).trim() === "") {
      throw new TypeError(`Kite GTT trigger ${index} is missing id`);
    }
    const id = String(gtt.id);
    if (ids.has(id)) throw new TypeError(`Kite GTT triggers contain duplicate id ${id}`);
    ids.add(id);
    const status = String(gtt.status || "").trim().toLowerCase();
    if (!KNOWN_GTT_STATUSES.has(status)) {
      throw new TypeError(`Kite GTT trigger ${index} has an unknown status`);
    }
  });
  return gtts;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} response must be an array`);
  return value;
}

function isTradingDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function resolveActiveKillDate(kill, day, now) {
  const today = tradingDate(now);
  const candidates = [kill?.date, day?.date].filter(isTradingDate);
  if (kill?.activatedAt) {
    const activated = new Date(kill.activatedAt);
    if (Number.isFinite(activated.getTime())) candidates.push(tradingDate(activated));
  }
  // A future or missing date is corrupt. Treat it as today's latch so it can
  // never be cleared early, while still allowing recovery on a later day.
  if (!candidates.length || candidates.some((date) => date > today)) return today;
  return candidates.sort().at(-1);
}

function restoreObject(target, snapshot) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, snapshot);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function isFiniteInteger(value) {
  return hasFiniteNumber(value) && Number.isSafeInteger(Number(value));
}

function chargesFingerprint(orders) {
  return (orders || [])
    .filter((order) => finiteOr(order.filled_quantity, 0) > 0 && finiteOr(order.average_price, 0) > 0)
    .map((order) => `${order.order_id}:${order.filled_quantity}:${order.average_price}`)
    .sort()
    .join("|");
}

function isTokenError(error) {
  return Boolean(
    error?.isTokenError ||
    error?.errorType === "TokenException" ||
    error?.error_type === "TokenException" ||
    error?.code === "TOKEN_EXCEPTION"
  );
}

function normalizeStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function tradingDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sum(values) {
  return values.reduce((total, value) => total + finiteOr(value, 0), 0);
}

async function mapConcurrent(items, limit, operation) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
