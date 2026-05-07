import http from "node:http";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");
const frontendDir = join(rootDir, "frontend");

loadEnv();

const config = {
  port: intEnv("PORT", 3000),
  apiKey: mustEnv("KITE_API_KEY"),
  apiSecret: mustEnv("KITE_API_SECRET"),
  redirectUrl: process.env.KITE_REDIRECT_URL || `http://localhost:${process.env.PORT || 3000}/`,
  appOrigin: process.env.APP_ORIGIN || "*",
  stateFile: resolve(rootDir, process.env.STATE_FILE || ".data/state.json"),
  kiteBase: process.env.KITE_BASE_URL || "https://api.kite.trade",
  maxLoss: intEnv("MAX_LOSS", 10000),
  pnlPollMs: intEnv("PNL_POLL_MS", 5000),
  guardPollMs: intEnv("GUARD_POLL_MS", 1500),
  marketProtection: Number(process.env.MARKET_PROTECTION || 5),
  flattenProducts: new Set((process.env.FLATTEN_PRODUCTS || "MIS,NRML").split(",").map((s) => s.trim()).filter(Boolean)),
};

const OPEN_ORDER_STATUSES = new Set([
  "OPEN",
  "TRIGGER PENDING",
  "OPEN PENDING",
  "VALIDATION PENDING",
  "PUT ORDER REQ RECEIVED",
  "MODIFY VALIDATION PENDING",
  "MODIFY PENDING",
]);

const state = loadState();
const runtime = {
  pnlTimer: null,
  guardTimer: null,
  inFlightFlatten: new Map(),
  lastError: null,
};

function freshState() {
  return {
    session: null,
    monitoring: false,
    settings: {
      maxLoss: config.maxLoss,
      pnlPollMs: config.pnlPollMs,
      guardPollMs: config.guardPollMs,
      marketProtection: config.marketProtection,
      flattenProducts: [...config.flattenProducts],
    },
    kill: {
      active: false,
      date: null,
      activatedAt: null,
      reason: null,
    },
    pnl: {
      total: 0,
      realised: 0,
      unrealised: 0,
      updatedAt: null,
    },
    positions: [],
    orders: [],
    actions: [],
  };
}

resetExpiredKillState();
if (state.monitoring && state.session?.accessToken) {
  startLoops();
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return sendNoContent(res);
    if (req.url.startsWith("/api/")) return handleApi(req, res);
    return serveStatic(req, res);
  } catch (error) {
    logAction("ERROR", error.message);
    return sendJson(res, 500, { error: error.message });
  }
});

server.listen(config.port, () => {
  console.log(`Kill Switch Guard running on http://localhost:${config.port}`);
});

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readJson(req) : {};

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, monitoring: state.monitoring, killActive: state.kill.active });
  }

  if (req.method === "GET" && url.pathname === "/api/login-url") {
    const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(config.apiKey)}`;
    return sendJson(res, 200, { loginUrl, redirectUrl: config.redirectUrl });
  }

  if (req.method === "POST" && url.pathname === "/api/session") {
    assertBody(body, ["requestToken"]);
    const session = await generateSession(body.requestToken);
    state.session = {
      accessToken: session.access_token,
      publicToken: session.public_token,
      userId: session.user_id,
      userName: session.user_name,
      loginAt: new Date().toISOString(),
    };
    if (body.maxLoss) state.settings.maxLoss = Math.abs(Number(body.maxLoss));
    if (body.pnlPollMs) state.settings.pnlPollMs = Math.max(1000, Number(body.pnlPollMs));
    if (body.guardPollMs) state.settings.guardPollMs = Math.max(750, Number(body.guardPollMs));
    state.monitoring = true;
    resetExpiredKillState();
    saveState();
    startLoops();
    await refreshRiskSnapshot();
    logAction("SESSION", `Connected as ${state.session.userName || state.session.userId || "Kite user"}`);
    return sendJson(res, 200, publicState());
  }

  if (req.method === "POST" && url.pathname === "/api/session/logout") {
    stopLoops();
    state.session = null;
    state.monitoring = false;
    state.positions = [];
    state.orders = [];
    state.pnl = { total: 0, realised: 0, unrealised: 0, updatedAt: null };
    saveState();
    logAction("SESSION", "Logged out");
    return sendJson(res, 200, publicState());
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(res, 200, publicState());
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    if (body.maxLoss) state.settings.maxLoss = Math.abs(Number(body.maxLoss));
    if (body.pnlPollMs) state.settings.pnlPollMs = Math.max(1000, Number(body.pnlPollMs));
    if (body.guardPollMs) state.settings.guardPollMs = Math.max(750, Number(body.guardPollMs));
    if (Array.isArray(body.flattenProducts)) state.settings.flattenProducts = body.flattenProducts;
    saveState();
    if (state.monitoring) startLoops();
    logAction("SETTINGS", "Risk settings updated");
    return sendJson(res, 200, publicState());
  }

  if (req.method === "POST" && url.pathname === "/api/monitor/start") {
    requireSession();
    state.monitoring = true;
    saveState();
    startLoops();
    await refreshRiskSnapshot();
    logAction("MONITOR", "Monitoring started");
    return sendJson(res, 200, publicState());
  }

  if (req.method === "POST" && url.pathname === "/api/monitor/stop") {
    state.monitoring = false;
    stopLoops();
    saveState();
    logAction("MONITOR", "Monitoring stopped");
    return sendJson(res, 200, publicState());
  }

  if (req.method === "POST" && url.pathname === "/api/kill/activate") {
    requireSession();
    await activateKill(body.reason || "Manual kill activation");
    return sendJson(res, 200, publicState());
  }

  if (req.method === "POST" && url.pathname === "/api/kill/reset") {
    state.kill = { active: false, date: null, activatedAt: null, reason: null };
    saveState();
    logAction("KILL", "Kill state reset manually");
    return sendJson(res, 200, publicState());
  }

  return sendJson(res, 404, { error: "Not found" });
}

async function generateSession(requestToken) {
  const checksum = createHash("sha256")
    .update(config.apiKey + requestToken + config.apiSecret)
    .digest("hex");

  const data = await kiteRequest("/session/token", {
    method: "POST",
    auth: false,
    params: {
      api_key: config.apiKey,
      request_token: requestToken,
      checksum,
    },
  });
  return data;
}

async function refreshRiskSnapshot() {
  requireSession();
  const positions = await kiteRequest("/portfolio/positions");
  const net = positions.net || [];
  const realised = sum(net.map((p) => Number(p.realised || 0)));
  const unrealised = sum(net.map((p) => Number(p.unrealised || 0)));
  const total = realised + unrealised;
  state.pnl = {
    total,
    realised,
    unrealised,
    updatedAt: new Date().toISOString(),
  };
  state.positions = net
    .filter((p) => Number(p.quantity || 0) !== 0)
    .map((p) => ({
      exchange: p.exchange,
      tradingsymbol: p.tradingsymbol,
      product: p.product,
      quantity: Number(p.quantity || 0),
      realised: Number(p.realised || 0),
      unrealised: Number(p.unrealised || 0),
    }));

  const orders = await kiteRequest("/orders");
  state.orders = (orders || []).slice(-25).map((o) => ({
    order_id: o.order_id,
    exchange: o.exchange,
    tradingsymbol: o.tradingsymbol,
    transaction_type: o.transaction_type,
    quantity: o.quantity,
    filled_quantity: o.filled_quantity,
    pending_quantity: o.pending_quantity,
    status: o.status,
    product: o.product,
    variety: o.variety,
    order_timestamp: o.order_timestamp,
  }));

  saveState();
  if (!state.kill.active && total <= -Math.abs(Number(state.settings.maxLoss))) {
    await activateKill(`Max loss breached: ${formatCurrency(total)} <= -${formatCurrency(state.settings.maxLoss)}`);
  }
}

async function enforceKill() {
  if (!state.kill.active) return;
  requireSession();
  await cancelOpenOrders();
  await flattenOpenPositions();
  saveState();
}

async function activateKill(reason) {
  if (!state.kill.active) {
    state.kill = {
      active: true,
      date: todayKey(),
      activatedAt: new Date().toISOString(),
      reason,
    };
    logAction("KILL", reason);
  }
  state.monitoring = true;
  saveState();
  startLoops();
  await cancelOpenOrders();
  await flattenOpenPositions();
}

async function cancelOpenOrders() {
  const orders = await kiteRequest("/orders");
  const cancellable = (orders || []).filter((order) => OPEN_ORDER_STATUSES.has(order.status));
  for (const order of cancellable) {
    try {
      const params = order.parent_order_id ? { parent_order_id: order.parent_order_id } : undefined;
      await kiteRequest(`/orders/${order.variety || "regular"}/${order.order_id}`, {
        method: "DELETE",
        params,
      });
      logAction("CANCEL", `${order.tradingsymbol} ${order.transaction_type} ${order.pending_quantity || order.quantity}`);
    } catch (error) {
      logAction("CANCEL_ERROR", `${order.order_id}: ${error.message}`);
    }
  }
}

async function flattenOpenPositions() {
  const positions = await kiteRequest("/portfolio/positions");
  const allowedProducts = new Set(state.settings.flattenProducts || []);
  const openPositions = (positions.net || []).filter((position) => {
    const qty = Number(position.quantity || 0);
    return qty !== 0 && allowedProducts.has(position.product);
  });

  for (const position of openPositions) {
    const qty = Math.abs(Number(position.quantity || 0));
    const key = `${position.exchange}:${position.tradingsymbol}:${position.product}:${Math.sign(position.quantity)}`;
    const lastAttempt = runtime.inFlightFlatten.get(key) || 0;
    if (Date.now() - lastAttempt < 15000) continue;
    runtime.inFlightFlatten.set(key, Date.now());

    const transactionType = Number(position.quantity) > 0 ? "SELL" : "BUY";
    try {
      await kiteRequest("/orders/regular", {
        method: "POST",
        params: {
          exchange: position.exchange,
          tradingsymbol: position.tradingsymbol,
          transaction_type: transactionType,
          quantity: qty,
          product: position.product,
          order_type: "MARKET",
          validity: "DAY",
          market_protection: state.settings.marketProtection,
          tag: "KSGUARD",
        },
      });
      logAction("FLATTEN", `${transactionType} ${qty} ${position.exchange}:${position.tradingsymbol} ${position.product}`);
    } catch (error) {
      logAction("FLATTEN_ERROR", `${position.tradingsymbol}: ${error.message}`);
    }
  }
}

async function kiteRequest(path, options = {}) {
  const method = options.method || "GET";
  const headers = { "X-Kite-Version": "3" };
  if (options.auth !== false) {
    requireSession();
    headers.Authorization = `token ${config.apiKey}:${state.session.accessToken}`;
  }

  let url = `${config.kiteBase}${path}`;
  const request = { method, headers };
  if (options.params && method === "GET") {
    url += `?${new URLSearchParams(cleanParams(options.params)).toString()}`;
  } else if (options.params) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    request.body = new URLSearchParams(cleanParams(options.params)).toString();
  }

  const response = await fetch(url, request);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === "error") {
    const message = payload.message || payload.error_type || `Kite API failed with HTTP ${response.status}`;
    if (payload.error_type === "TokenException" || response.status === 403) {
      state.monitoring = false;
      stopLoops();
      saveState();
    }
    throw new Error(message);
  }
  return payload.data;
}

function startLoops() {
  stopLoops();
  if (!state.monitoring || !state.session?.accessToken) return;
  runtime.pnlTimer = setInterval(() => {
    refreshRiskSnapshot().catch((error) => {
      runtime.lastError = error.message;
      logAction("PNL_ERROR", error.message);
    });
  }, Number(state.settings.pnlPollMs));
  runtime.guardTimer = setInterval(() => {
    enforceKill().catch((error) => {
      runtime.lastError = error.message;
      logAction("GUARD_ERROR", error.message);
    });
  }, Number(state.settings.guardPollMs));
}

function stopLoops() {
  if (runtime.pnlTimer) clearInterval(runtime.pnlTimer);
  if (runtime.guardTimer) clearInterval(runtime.guardTimer);
  runtime.pnlTimer = null;
  runtime.guardTimer = null;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = resolve(frontendDir, `.${pathname}`);
  if (!filePath.startsWith(frontendDir) || !existsSync(filePath)) {
    return sendJson(res, 404, { error: "Not found" });
  }
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  }[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  res.end(readFileSync(filePath));
}

function publicState() {
  return {
    connected: Boolean(state.session?.accessToken),
    user: state.session ? { userId: state.session.userId, userName: state.session.userName, loginAt: state.session.loginAt } : null,
    monitoring: state.monitoring,
    kill: state.kill,
    settings: state.settings,
    pnl: state.pnl,
    positions: state.positions,
    orders: state.orders,
    actions: state.actions.slice(-80).reverse(),
    lastError: runtime.lastError,
  };
}

function loadEnv() {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function loadState() {
  try {
    if (existsSync(config.stateFile)) {
      return { ...freshState(), ...JSON.parse(readFileSync(config.stateFile, "utf8")) };
    }
  } catch (error) {
    console.warn(`Could not load state file: ${error.message}`);
  }
  return freshState();
}

function saveState() {
  mkdirSync(resolve(config.stateFile, ".."), { recursive: true });
  writeFileSync(config.stateFile, JSON.stringify(state, null, 2));
}

function resetExpiredKillState() {
  if (state.kill.active && state.kill.date && state.kill.date !== todayKey()) {
    state.kill = { active: false, date: null, activatedAt: null, reason: null };
    logAction("KILL", "Previous trading-day kill state expired");
    saveState();
  }
}

function logAction(type, message) {
  state.actions.push({ type, message, at: new Date().toISOString() });
  state.actions = state.actions.slice(-200);
  console.log(`[${type}] ${message}`);
}

function readJson(req) {
  return new Promise((resolveBody, rejectBody) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        req.destroy();
        rejectBody(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!data) return resolveBody({});
      try {
        resolveBody(JSON.parse(data));
      } catch {
        rejectBody(new Error("Invalid JSON body"));
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": config.appOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": config.appOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end();
}

function assertBody(body, fields) {
  for (const field of fields) {
    if (!body[field]) throw new Error(`Missing required field: ${field}`);
  }
}

function requireSession() {
  if (!state.session?.accessToken) throw new Error("Kite session is not connected");
}

function cleanParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function mustEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.warn(`${name} is not set. Copy .env.example to .env before connecting to Kite.`);
  }
  return value || "";
}

function formatCurrency(value) {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
