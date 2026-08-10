import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDailyPnl,
  createFreshState,
  GuardEngine,
  GuardInvariantError,
  normalizeState,
} from "../backend/guard-engine.js";

const SETTINGS = {
  maxLoss: 10_000,
  riskPollMs: 2_000,
  guardPollMs: 1_000,
  marketProtection: -1,
  flattenProducts: ["ALL"],
  cancelGttOnKill: true,
  chargeBuffer: 0,
};

const CONFIG = {
  exitOrderMaxAgeMs: 15_000,
  settlementGraceMs: 4_000,
};

function position(quantity, overrides = {}) {
  return {
    exchange: "NFO",
    tradingsymbol: "NIFTY26AUGFUT",
    product: "NRML",
    quantity,
    m2m: -12_000,
    realised: 0,
    unrealised: -12_000,
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    order_id: "order-1",
    exchange: "NFO",
    tradingsymbol: "NIFTY26AUGFUT",
    product: "NRML",
    variety: "regular",
    transaction_type: "SELL",
    quantity: 10,
    filled_quantity: 0,
    pending_quantity: 10,
    average_price: 0,
    order_type: "MARKET",
    status: "OPEN",
    tag: null,
    // Kite timestamps are IST without an explicit offset. Keep this pending
    // order inside the guard's freshness window for the fixture's 10:30 IST
    // clock; stale-exit behaviour is tested independently.
    order_timestamp: "2026-08-10 10:29:55",
    ...overrides,
  };
}

function fixture({ date = new Date("2026-08-10T05:00:00.000Z") } = {}) {
  let currentDate = date;
  const events = [];
  const store = {
    saves: [],
    fail: false,
    async save(state) {
      if (this.fail) throw new Error("disk unavailable");
      this.saves.push(JSON.parse(JSON.stringify(state)));
      events.push({ type: "save", active: state.kill.active, phase: state.kill.phase });
    },
  };
  const broker = {
    positions: [position(10)],
    orders: [],
    gtts: [],
    throwOrders: null,
    throwPositions: null,
    cancelled: [],
    exits: [],
    deletedGtts: [],
    async getPositions() {
      events.push({ type: "positions" });
      if (this.throwPositions) throw this.throwPositions;
      return { net: this.positions };
    },
    async getOrders() {
      events.push({ type: "orders" });
      if (this.throwOrders) throw this.throwOrders;
      return this.orders;
    },
    async getGtts() {
      return this.gtts;
    },
    async cancelOrder(value) {
      this.cancelled.push(value.order_id);
    },
    async deleteGtt(id) {
      this.deletedGtts.push(id);
    },
    async placeExit(value, quantity, options) {
      events.push({ type: "exit", quantity });
      this.exits.push({ position: value, quantity, options });
      return { orderIds: [`exit-${this.exits.length}`], errors: [] };
    },
    async calculateOrderCharges() {
      return 0;
    },
  };
  const state = createFreshState(SETTINGS, currentDate);
  state.session = { accessToken: "token", userId: "AB1234", invalid: false };
  state.monitoring = true;
  const engine = new GuardEngine({
    state,
    store,
    client: broker,
    config: CONFIG,
    now: () => new Date(currentDate),
    logger: { log() {}, error() {} },
  });
  return {
    engine,
    state,
    store,
    broker,
    events,
    setDate(value) {
      currentDate = value;
    },
  };
}

test("uses daily M2M, estimated charges, and the configured safety buffer", () => {
  const pnl = calculateDailyPnl(
    [
      position(0, { m2m: -1_000, realised: 50_000, unrealised: 20_000 }),
      position(1, { m2m: -500, realised: 50_000, unrealised: 20_000 }),
    ],
    125,
    75,
  );
  assert.equal(pnl.gross, -1_500);
  assert.equal(pnl.total, -1_700);
  assert.equal(pnl.source, "KITE_POSITION_M2M");
  assert.throws(
    () => calculateDailyPnl([position(1, { m2m: undefined })]),
    /no valid daily m2m/,
  );
});

test("persists the kill latch before submitting the first reverse order", async () => {
  const { engine, state, broker, events } = fixture();

  await engine.pollRisk();

  assert.equal(state.kill.active, true);
  assert.equal(broker.exits.length, 1);
  assert.equal(broker.exits[0].quantity, 10);
  assert.equal(broker.exits[0].options.tag, "KSGUARD");
  const latchedSave = events.findIndex((event) => event.type === "save" && event.active);
  const exit = events.findIndex((event) => event.type === "exit");
  assert(latchedSave !== -1 && latchedSave < exit);
});

test("emits a non-blocking critical alert when the loss latch activates", async () => {
  const { engine } = fixture();
  const alerts = [];
  engine.notifier = {
    enabled: true,
    async notify(event) {
      alerts.push(event);
      return true;
    },
  };

  await engine.pollRisk();
  await Promise.allSettled([...engine.notificationTasks]);

  assert.equal(alerts[0].type, "KILL_ACTIVATED");
  assert.equal(alerts[0].severity, "critical");
});

test("evaluates a tightened daily limit immediately after saving settings", async () => {
  const { engine, state, broker } = fixture();
  broker.positions = [position(10, { m2m: -5_000 })];

  await engine.updateSettings({ ...state.settings, maxLoss: 4_000 });

  assert.equal(state.kill.active, true);
  assert.equal(broker.exits.length, 1);
  engine.clearLoops();
});

test("does not cancel or duplicate an open guard exit that covers the position", async () => {
  const { engine, state, broker } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  state.kill.phase = "EXITING";
  broker.orders = [order({ tag: "KSGUARD" })];

  await engine.reconcileKill();

  assert.deepEqual(broker.cancelled, []);
  assert.deepEqual(broker.exits, []);
  assert.equal(state.kill.verifiedFlat, false);
});

test("submits only the quantity not covered by a pending guard exit", async () => {
  const { engine, state, broker } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  broker.orders = [order({ tag: "KSGUARD", quantity: 4, pending_quantity: 4 })];

  await engine.reconcileKill();

  assert.equal(broker.exits.length, 1);
  assert.equal(broker.exits[0].quantity, 6);
  assert.deepEqual(broker.cancelled, []);
});

test("cancels user orders but preserves a valid guard exit", async () => {
  const { engine, state, broker } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  broker.orders = [
    order({ order_id: "user-order", tag: null }),
    order({ order_id: "guard-order", tag: "KSGUARD" }),
  ];

  await engine.reconcileKill();

  assert.deepEqual(broker.cancelled, ["user-order"]);
  assert.equal(broker.exits.length, 0);
});

test("still exits current positions when the order-book read fails", async () => {
  const { engine, state, broker } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  broker.throwOrders = new Error("order book unavailable");

  await engine.reconcileKill();

  assert.equal(broker.exits.length, 1);
  assert.equal(state.kill.phase, "DEGRADED");
});

test("reopens reconciliation when a trader creates exposure after verified lock", async () => {
  const { engine, state, broker } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  broker.positions = [];

  await engine.reconcileKill();
  await Promise.allSettled([...engine.cleanupTasks.values()]);
  await engine.reconcileKill();
  assert.equal(state.kill.phase, "LOCKED");
  assert.equal(state.kill.verifiedFlat, true);

  broker.positions = [position(-3, { m2m: -100 })];
  await engine.reconcileKill();
  assert.equal(state.kill.verifiedFlat, false);
  assert.equal(broker.exits.at(-1).quantity, 3);
  assert.equal(broker.exits.at(-1).position.quantity, -3);
});

test("same-day stop, settings changes, disconnect, and reset are denied", async () => {
  const { engine, state } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";

  await assert.rejects(engine.stopMonitoring(), GuardInvariantError);
  await assert.rejects(engine.disconnectSession(), GuardInvariantError);
  await assert.rejects(engine.updateSettings({ ...SETTINGS, maxLoss: 99_999 }), GuardInvariantError);
  await assert.rejects(engine.armNextDay(), (error) => error.code === "SAME_DAY_LOCK");
});

test("next-day arming requires a fresh reconciliation that is verified flat", async () => {
  const controls = fixture();
  const { engine, state, broker } = controls;
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  broker.positions = [];
  controls.setDate(new Date("2026-08-11T05:00:00.000Z"));

  await engine.armNextDay();

  assert.equal(state.kill.active, false);
  assert.equal(state.kill.phase, "ARMED");
  assert.equal(state.day.date, "2026-08-11");
  assert.equal(state.monitoring, true);
});

test("active GTTs are deleted and prevent a premature verified-flat status", async () => {
  const { engine, state, broker } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  broker.positions = [];
  broker.gtts = [{ id: 123, status: "active", condition: { exchange: "NSE", tradingsymbol: "INFY" } }];

  await engine.reconcileKill();

  assert.deepEqual(broker.deletedGtts, [123]);
  assert.equal(state.kill.verifiedFlat, false);
});

test("does not trust a stale persisted GTT snapshot while its refresh is in flight", async () => {
  const { engine, state, broker } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  state.positions = [];
  state.gtts = [];
  state.internal.lastGttCheckAt = "2026-08-10T04:59:00.000Z";
  broker.positions = [];
  broker.gtts = [{ id: 456, status: "active", condition: { exchange: "NSE", tradingsymbol: "INFY" } }];

  await engine.reconcileKill();

  assert.equal(state.kill.verifiedFlat, false);
  await Promise.allSettled([...engine.cleanupTasks.values()]);
});

test("does not duplicate an exit while a newly submitted order is missing from the order book", async () => {
  const controls = fixture();
  const { engine, state, broker } = controls;
  state.kill.active = true;
  state.kill.date = "2026-08-10";

  await engine.reconcileKill();
  assert.equal(broker.exits.length, 1);

  controls.setDate(new Date("2026-08-10T05:00:01.000Z"));
  await engine.reconcileKill();
  assert.equal(broker.exits.length, 1);

  controls.setDate(new Date("2026-08-10T05:00:16.000Z"));
  await engine.reconcileKill();
  assert.equal(broker.exits.length, 2);
});

test("exits newly uncovered growth while an earlier key-level attempt is inside grace", async () => {
  const controls = fixture();
  const { engine, state, broker } = controls;
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  state.kill.accountId = "AB1234";

  await engine.reconcileKill();
  assert.equal(broker.exits.length, 1);
  assert.equal(broker.exits[0].quantity, 10);

  controls.setDate(new Date("2026-08-10T05:00:01.000Z"));
  broker.positions = [position(110, { m2m: -13_000 })];
  await engine.reconcileKill();

  assert.equal(broker.exits.length, 2);
  assert.equal(broker.exits[1].quantity, 100);
  assert.equal(broker.exits[1].position.quantity, 110);
});

test("exits sign-flipped exposure while an earlier key-level attempt is inside grace", async () => {
  const controls = fixture();
  const { engine, state, broker } = controls;
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  state.kill.accountId = "AB1234";

  await engine.reconcileKill();
  assert.equal(broker.exits.length, 1);
  assert.equal(broker.exits[0].position.quantity, 10);

  controls.setDate(new Date("2026-08-10T05:00:01.000Z"));
  broker.positions = [position(-5, { m2m: -13_000 })];
  await engine.reconcileKill();

  assert.equal(broker.exits.length, 2);
  assert.equal(broker.exits[1].quantity, 5);
  assert.equal(broker.exits[1].position.quantity, -5);
});

test("resets account-scoped P&L and charges before polling a newly connected unlocked account", async () => {
  const controls = fixture();
  const { engine, state, broker } = controls;
  state.pnl = {
    gross: -100,
    estimatedCharges: 9_900,
    chargeBuffer: 0,
    total: -10_000,
    breakdown: null,
  };
  state.internal.chargesFingerprint = "account-a-orders";
  state.positions = [position(1, { m2m: -100 })];
  state.orders = [order({ order_id: "account-a-order" })];
  broker.positions = [position(1, { m2m: -200 })];

  try {
    await engine.connectSession({
      access_token: "account-b-token",
      user_id: "XY9999",
    });
  } finally {
    engine.clearLoops();
    await Promise.allSettled([...engine.cleanupTasks.values()]);
  }

  assert.equal(state.session.userId, "XY9999");
  assert.equal(state.pnl.gross, -200);
  assert.equal(state.pnl.estimatedCharges, 0);
  assert.equal(state.pnl.total, -200);
  assert.notEqual(state.internal.chargesFingerprint, "account-a-orders");
  assert.equal(state.kill.active, false);
  assert.equal(broker.exits.length, 0);
});

test("rejects duplicate net-position keys before submitting any exit", async () => {
  const { engine, state, broker } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  state.kill.accountId = "AB1234";
  broker.positions = [
    position(10),
    position(10, { m2m: -1_000 }),
  ];

  await assert.rejects(engine.reconcileKill(), /duplicate/i);

  assert.equal(broker.exits.length, 0);
  assert.equal(state.kill.verifiedFlat, false);
  assert.equal(state.kill.phase, "DEGRADED");
});

test("continues flattening and schedules the guard when state persistence fails during a trip", async () => {
  const { engine, state, store, broker } = fixture();
  store.fail = true;

  await engine.pollRisk();

  assert.equal(state.kill.active, true);
  assert.equal(broker.exits.length, 1);
  assert(engine.guardTimer, "the active guard loop must remain scheduled");
  assert.equal(state.health.status, "CRITICAL");
  engine.clearLoops();
});

test("fails closed on malformed position data instead of declaring the account flat", async () => {
  const { engine, state, broker } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  broker.positions = null;

  await assert.rejects(engine.reconcileKill(), /net positions response must be an array/);

  assert.equal(state.kill.verifiedFlat, false);
  assert.equal(state.kill.phase, "DEGRADED");
});

test("rolls charges and fingerprints at the India trading-date boundary", async () => {
  const { engine, state, broker } = fixture();
  state.day.date = "2026-08-09";
  state.pnl.estimatedCharges = 20_000;
  state.pnl.total = -20_000;
  state.internal.chargesFingerprint = "yesterday";
  broker.positions = [position(0, { m2m: 0, realised: 0, unrealised: 0 })];

  await engine.pollRisk();

  assert.equal(state.day.date, "2026-08-10");
  assert.equal(state.pnl.estimatedCharges, 0);
  assert.equal(state.pnl.total, 0);
  assert.equal(state.kill.active, false);
});

test("normalises an unknown or conflicting active-latch date to fail closed", () => {
  const now = new Date("2026-08-10T05:00:00.000Z");
  const unknown = normalizeState({ kill: { active: true } }, SETTINGS, now);
  assert.equal(unknown.kill.date, "2026-08-10");

  const conflicting = normalizeState({
    day: { date: "2026-08-09" },
    kill: { active: true, date: "2026-08-09", activatedAt: "2026-08-10T04:00:00.000Z" },
  }, SETTINGS, now);
  assert.equal(conflicting.kill.date, "2026-08-10");

  const future = normalizeState({ kill: { active: true, date: "2030-01-01" } }, SETTINGS, now);
  assert.equal(future.kill.date, "2026-08-10");
});

test("restores monitoring and its timer when a stop cannot be persisted", async () => {
  const { engine, state, store } = fixture();
  engine.restartLoops();
  store.fail = true;

  await assert.rejects(engine.stopMonitoring(), /disk unavailable/);

  assert.equal(state.monitoring, true);
  assert(engine.riskTimer, "the previous monitoring loop must be restored");
  engine.clearLoops();
});

test("schedules monitoring after the immediate start poll fails", async () => {
  const { engine, state, broker } = fixture();
  state.monitoring = false;
  broker.throwPositions = new Error("temporary positions failure");

  await assert.rejects(engine.startMonitoring(), /temporary positions failure/);

  assert.equal(state.monitoring, true);
  assert(engine.riskTimer, "a transient first poll must not leave protection idle");
  engine.clearLoops();
});

test("cannot replace an active lock's Kite session with another account", async () => {
  const { engine, state } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  state.kill.accountId = "AB1234";

  await assert.rejects(
    engine.connectSession({ access_token: "other-token", user_id: "XY9999" }),
    (error) => error.code === "LOCKED_ACCOUNT_MISMATCH" && error.status === 423,
  );

  assert.equal(state.session.userId, "AB1234");
  assert.equal(state.session.accessToken, "token");
});

test("fails closed on startup when the persisted session does not match the locked account", async () => {
  const { engine, state } = fixture();
  state.kill.active = true;
  state.kill.accountId = "AB1234";
  state.kill.date = "2026-08-10";
  state.session.userId = "XY9999";

  await engine.start();

  assert.equal(state.session.invalid, true);
  assert.equal(state.health.status, "CRITICAL");
  assert.equal(state.kill.phase, "DEGRADED");
  assert.equal(engine.guardTimer, null);
});

test("treats malformed order rows as unknown instead of verified clear", async () => {
  const { engine, state, broker } = fixture();
  state.kill.active = true;
  state.kill.date = "2026-08-10";
  broker.positions = [];
  broker.orders = [{}];

  await engine.reconcileKill();

  assert.equal(state.kill.verifiedFlat, false);
  assert.equal(state.kill.phase, "DEGRADED");
});
