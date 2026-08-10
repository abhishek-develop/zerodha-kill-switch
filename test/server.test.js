import assert from "node:assert/strict";
import test from "node:test";

import { createFreshState, GuardEngine } from "../backend/guard-engine.js";
import { createGuardApplication } from "../backend/server.js";

const PASSWORD = "correct horse battery staple";
const SECRET = "server-test-secret-that-is-more-than-thirty-two-characters";
const ALLOWED_ORIGIN = "https://guard.test";
const NOW = new Date("2026-08-10T05:00:00.000Z");

function settings() {
  return {
    maxLoss: 10_000,
    riskPollMs: 2_000,
    guardPollMs: 1_000,
    marketProtection: -1,
    flattenProducts: ["ALL"],
    cancelGttOnKill: true,
    chargeBuffer: 0,
  };
}

function config(overrides = {}) {
  return {
    port: 0,
    rootDir: process.cwd(),
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    kiteBase: "https://kite.invalid",
    redirectUrl: "https://guard.test/",
    stateFile: "/tmp/tradeguardian-server-test-state.json",
    appPassword: PASSWORD,
    appSecret: SECRET,
    appOrigins: [ALLOWED_ORIGIN],
    cookieName: "tradeguardian_test_session",
    cookieSecure: false,
    authTtlMs: 60_000,
    requestTimeoutMs: 1_000,
    exitOrderMaxAgeMs: 15_000,
    settlementGraceMs: 4_000,
    defaults: settings(),
    configurationIssues: [],
    ...overrides,
  };
}

function engineFixture(overrides = {}) {
  const state = {
    session: {
      accessToken: "must-never-cross-the-http-boundary",
      publicToken: "also-private",
      userId: "AB1234",
      userName: "Safety Tester",
      loginAt: NOW.toISOString(),
      invalid: false,
    },
    monitoring: true,
    day: { date: "2026-08-10" },
    settings: settings(),
    kill: {
      active: true,
      date: "2026-08-10",
      activatedAt: NOW.toISOString(),
      reason: "Daily loss limit breached",
      phase: "LOCKED",
      verifiedFlat: true,
      flatVerifiedAt: NOW.toISOString(),
      lastReconciledAt: NOW.toISOString(),
      unresolvedExposureCount: 0,
      exitAttempts: {},
    },
    pnl: {
      gross: -10_100,
      estimatedCharges: 25,
      chargeBuffer: 0,
      total: -10_125,
      source: "KITE_POSITION_M2M",
      updatedAt: NOW.toISOString(),
    },
    positions: [],
    orders: [],
    gtts: [],
    actions: [],
    health: {
      status: "HEALTHY",
      lastRiskCheckAt: NOW.toISOString(),
      lastGuardCheckAt: NOW.toISOString(),
      lastSuccessAt: NOW.toISOString(),
      consecutiveFailures: 0,
      lastError: null,
      websocket: "DISCONNECTED",
    },
  };

  return {
    state,
    client: {
      getLoginUrl: () => "https://kite.invalid/login",
      generateSession: async () => ({
        access_token: "new-token",
        user_id: "AB1234",
        user_name: "Safety Tester",
      }),
    },
    hasUsableSession: () => true,
    shutdown: async () => {},
    connectSession: async () => state,
    disconnectSession: async () => state,
    updateSettings: async (next) => {
      state.settings = next;
      return state;
    },
    startMonitoring: async () => state,
    stopMonitoring: async () => state,
    manualKill: async () => state,
    armNextDay: async () => state,
    refreshSnapshot: async () => state,
    ...overrides,
  };
}

function activeGuardEngine() {
  const state = createFreshState(settings(), NOW);
  state.session = {
    accessToken: "real-engine-test-token",
    userId: "AB1234",
    userName: "Safety Tester",
    loginAt: NOW.toISOString(),
    invalid: false,
  };
  state.monitoring = true;
  state.kill = {
    ...state.kill,
    active: true,
    date: "2026-08-10",
    activatedAt: NOW.toISOString(),
    reason: "Test same-day latch",
    phase: "LOCKED",
    verifiedFlat: true,
    flatVerifiedAt: NOW.toISOString(),
  };
  return new GuardEngine({
    state,
    store: { save: async () => {} },
    client: {},
    config: { exitOrderMaxAgeMs: 15_000, settlementGraceMs: 4_000 },
    now: () => new Date(NOW),
    logger: { log() {}, error() {} },
  });
}

async function applicationFixture(t, options = {}) {
  const engine = options.engine || engineFixture();
  const application = await createGuardApplication({
    config: options.config || config(),
    engine,
    now: () => new Date(NOW),
    logger: { log() {}, error() {} },
  });
  const address = await application.listen(0, "127.0.0.1");
  t.after(() => application.close());
  return {
    application,
    engine,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function listenApplication(t, application) {
  const address = await application.listen(0, "127.0.0.1");
  t.after(() => application.close());
  return `http://127.0.0.1:${address.port}`;
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: options.headers,
    body: options.body,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
}

async function login(baseUrl) {
  const result = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ALLOWED_ORIGIN,
    },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(result.response.status, 200);
  const setCookie = result.response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0];
}

test("keeps operational endpoints public but requires a signed app session for account state", async (t) => {
  const { baseUrl } = await applicationFixture(t);

  const health = await request(baseUrl, "/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.response.headers.get("x-frame-options"), "DENY");
  assert.equal(health.response.headers.get("cache-control"), "no-store");

  const unauthenticated = await request(baseUrl, "/api/status");
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.json.error, "Application login required");

  const cookie = await login(baseUrl);
  const authenticated = await request(baseUrl, "/api/status", {
    headers: { Cookie: cookie },
  });
  assert.equal(authenticated.response.status, 200);
  assert.equal(authenticated.json.connected, true);
  assert.equal(authenticated.json.user.userId, "AB1234");
  assert.doesNotMatch(authenticated.text, /must-never-cross-the-http-boundary/);
  assert.doesNotMatch(authenticated.text, /also-private/);

  const tampered = await request(baseUrl, "/api/status", {
    headers: { Cookie: `${cookie}tampered` },
  });
  assert.equal(tampered.response.status, 401);
});

test("rejects cross-origin login and authenticated mutations", async (t) => {
  const { baseUrl } = await applicationFixture(t);

  const crossOriginLogin = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://attacker.invalid",
    },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(crossOriginLogin.response.status, 403);

  const cookie = await login(baseUrl);
  const crossOriginMutation = await request(baseUrl, "/api/snapshot/refresh", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "https://attacker.invalid",
    },
  });
  assert.equal(crossOriginMutation.response.status, 403);
  assert.equal(crossOriginMutation.response.headers.get("access-control-allow-origin"), null);

  const allowedMutation = await request(baseUrl, "/api/snapshot/refresh", {
    method: "POST",
    headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN },
  });
  assert.equal(allowedMutation.response.status, 200);
  assert.equal(allowedMutation.response.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
  assert.equal(allowedMutation.response.headers.get("access-control-allow-credentials"), "true");
});

test("returns 400 for malformed JSON and remains available for the next request", async (t) => {
  const { baseUrl } = await applicationFixture(t);

  const malformed = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ALLOWED_ORIGIN,
    },
    body: "{not valid json",
  });
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.json.code, "HTTP_ERROR");
  assert.match(malformed.json.error, /Invalid JSON body/);

  const nonObject = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ALLOWED_ORIGIN,
    },
    body: "[]",
  });
  assert.equal(nonObject.response.status, 400);

  const oversized = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ALLOWED_ORIGIN,
    },
    body: JSON.stringify({ password: "x".repeat(256_001) }),
  });
  assert.equal(oversized.response.status, 413);
  assert.match(oversized.json.error, /too large/i);

  const nextRequest = await request(baseUrl, "/api/health");
  assert.equal(nextRequest.response.status, 200);
  assert.equal(nextRequest.json.ok, true);
});

test("never exposes a reset endpoint and app logout does not disable an active guard", async (t) => {
  const { baseUrl } = await applicationFixture(t);
  const cookie = await login(baseUrl);
  const headers = { Cookie: cookie, Origin: ALLOWED_ORIGIN };

  const reset = await request(baseUrl, "/api/kill/reset", {
    method: "POST",
    headers,
  });
  assert.equal(reset.response.status, 423);
  assert.equal(reset.json.code, "RESET_REMOVED");

  const logout = await request(baseUrl, "/api/auth/logout", {
    method: "POST",
    headers,
  });
  assert.equal(logout.response.status, 200);
  assert.equal(logout.json.authenticated, false);
  assert.equal(logout.json.protectionContinues, true);
  assert.match(logout.response.headers.get("set-cookie") || "", /Max-Age=0/);

  const loggedOutBrowser = await request(baseUrl, "/api/status");
  assert.equal(loggedOutBrowser.response.status, 401);
});

test("enforces the same-day latch through every HTTP control path", async (t) => {
  const { baseUrl } = await applicationFixture(t, { engine: activeGuardEngine() });
  const cookie = await login(baseUrl);
  const headers = {
    Cookie: cookie,
    Origin: ALLOWED_ORIGIN,
    "Content-Type": "application/json",
  };
  const attempts = [
    ["/api/monitor/stop", undefined, "LOCK_ACTIVE"],
    ["/api/session/logout", undefined, "LOCK_ACTIVE"],
    ["/api/settings", JSON.stringify({ maxLoss: 99_999 }), "LOCK_ACTIVE"],
    ["/api/kill/arm-next-day", undefined, "SAME_DAY_LOCK"],
    ["/api/kill/reset", undefined, "RESET_REMOVED"],
  ];

  for (const [path, body, expectedCode] of attempts) {
    const result = await request(baseUrl, path, { method: "POST", headers, body });
    assert.equal(result.response.status, 423, path);
    assert.equal(result.json.code, expectedCode, path);
  }

  const status = await request(baseUrl, "/api/status", { headers: { Cookie: cookie } });
  assert.equal(status.response.status, 200);
  assert.equal(status.json.kill.active, true);
  assert.equal(status.json.monitoring, true);
});

test("keeps account APIs fail-closed when persisted state cannot be recovered", async (t) => {
  const application = await createGuardApplication({
    config: config(),
    store: {
      async load() {
        throw new Error("persisted guard state is corrupt");
      },
    },
    now: () => new Date(NOW),
    logger: { log() {}, error() {} },
  });
  const baseUrl = await listenApplication(t, application);

  assert.equal(application.engine, null);
  assert.match(application.startupError?.message || "", /state is corrupt/);

  const authStatus = await request(baseUrl, "/api/auth/status");
  assert.equal(authStatus.response.status, 200);
  assert.equal(authStatus.json.configured, false);
  assert.match(authStatus.json.startupError, /state is corrupt/);

  const readiness = await request(baseUrl, "/api/readiness");
  assert.equal(readiness.response.status, 503);
  assert.equal(readiness.json.ready, false);

  const cookie = await login(baseUrl);
  const accountState = await request(baseUrl, "/api/status", {
    headers: { Cookie: cookie },
  });
  assert.equal(accountState.response.status, 503);
  assert.match(accountState.json.error, /state is corrupt/);
});

test("readiness fails closed while guard health is degraded", async (t) => {
  const engine = engineFixture();
  engine.state.health.status = "DEGRADED";
  engine.state.health.lastError = "Guard reconciliation is incomplete";
  const { baseUrl } = await applicationFixture(t, { engine });

  const readiness = await request(baseUrl, "/api/readiness");

  assert.equal(readiness.response.status, 503);
  assert.equal(readiness.json.ready, false);
  assert.equal(readiness.json.status, "DEGRADED");
});

test("does not expose a half-started engine when the initial durable write fails", async () => {
  const application = await createGuardApplication({
    config: config(),
    store: {
      async load(createFresh) {
        return createFresh();
      },
      async save() {
        throw new Error("initial state write failed");
      },
    },
    client: {},
    now: () => new Date(NOW),
    logger: { log() {}, error() {} },
  });

  assert.equal(application.engine, null);
  assert.match(application.startupError?.message || "", /initial state write failed/);
  await application.close();
});

test("closes the HTTP listener even when the final state save fails", async () => {
  const engine = engineFixture({
    shutdown: async () => {
      throw new Error("final state save failed");
    },
  });
  const application = await createGuardApplication({
    config: config(),
    engine,
    now: () => new Date(NOW),
    logger: { log() {}, error() {} },
  });
  await application.listen(0, "127.0.0.1");

  await assert.rejects(application.close(), /final state save failed/);
  assert.equal(application.server.listening, false);
});
