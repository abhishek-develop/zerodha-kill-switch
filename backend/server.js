import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AppAuthenticator, LoginRateLimiter } from "./auth.js";
import { buildConfig, loadEnvFile, validateSettings } from "./config.js";
import {
  createFreshState,
  GuardEngine,
  GuardInvariantError,
  normalizeState,
} from "./guard-engine.js";
import { KiteApiError, KiteClient } from "./kite-client.js";
import { WebhookNotifier } from "./notifier.js";
import { EncryptedStateStore } from "./state-store.js";

const moduleDirectory = fileURLToPath(new URL(".", import.meta.url));
const defaultRootDir = resolve(moduleDirectory, "..");

export async function createGuardApplication(options = {}) {
  const rootDir = options.rootDir || defaultRootDir;
  if (!options.config) loadEnvFile(rootDir);
  const config = options.config || buildConfig(rootDir);
  const logger = options.logger || console;
  const now = options.now || (() => new Date());
  const auth = new AppAuthenticator({
    password: config.appPassword,
    secret: config.appSecret,
    cookieName: config.cookieName,
    secure: config.cookieSecure,
    ttlMs: config.authTtlMs,
  });
  const loginLimiter = new LoginRateLimiter();

  let engine = options.engine || null;
  let startupError = null;
  if (!engine) {
    const engineIssues = config.configurationIssues.filter(
      (issue) => !issue.startsWith("APP_PASSWORD"),
    );
    if (!engineIssues.length) {
      try {
        const store = options.store || new EncryptedStateStore({
          filePath: config.stateFile,
          secret: config.appSecret,
        });
        const loaded = options.state || await store.load(() => createFreshState(config.defaults, now()));
        const state = normalizeState(loaded, config.defaults, now());
        state.settings = validateSettings(state.settings, config.defaults);

        let engineReference;
        const client = options.client || new KiteClient({
          apiKey: config.apiKey,
          apiSecret: config.apiSecret,
          baseUrl: config.kiteBase,
          timeoutMs: config.requestTimeoutMs,
          getAccessToken: () => engineReference?.state.session?.accessToken || null,
          onTokenError: (error) => engineReference?.markTokenInvalid(error),
        });
        const notifier = options.notifier || new WebhookNotifier({
          url: config.alertWebhookUrl,
          timeoutMs: config.alertWebhookTimeoutMs,
          now,
        });
        const candidateEngine = new GuardEngine({ state, store, client, notifier, config, now, logger });
        engineReference = candidateEngine;
        await candidateEngine.start();
        engine = candidateEngine;
      } catch (error) {
        // Never expose a half-started engine as configured. In particular, a
        // failed initial state write means no protection loop was scheduled.
        engine = null;
        startupError = error;
        logger.error?.(`[STARTUP_ERROR] ${error.message}`);
      }
    } else {
      startupError = new Error(engineIssues.join("; "));
    }
  }

  const staticDirectory = selectStaticDirectory(rootDir);
  const context = {
    auth,
    config,
    engine,
    loginLimiter,
    logger,
    now,
    startupError,
    staticDirectory,
  };

  const server = http.createServer((req, res) => {
    handleRequest(req, res, context).catch((error) => {
      logger.error?.(`[HTTP_ERROR] ${error.message}`);
      if (!res.headersSent) {
        sendError(req, res, error, context);
      } else {
        res.destroy();
      }
    });
  });

  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return {
    server,
    engine,
    config,
    startupError,
    async listen(port = config.port, host = config.host) {
      await new Promise((resolveListen, rejectListen) => {
        const onError = (error) => {
          server.off("listening", onListening);
          rejectListen(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolveListen();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
      return server.address();
    },
    async close() {
      let closeError = null;
      if (server.listening) {
        try {
          // Stop accepting control requests before draining the engine. The
          // guard keeps running while any in-flight request completes.
          await new Promise((resolveClose, rejectClose) => {
            server.close((error) => (error ? rejectClose(error) : resolveClose()));
          });
        } catch (error) {
          closeError = error;
        }
      }
      try {
        await engine?.shutdown();
      } catch (error) {
        closeError ||= error;
      }
      if (closeError) throw closeError;
    },
  };
}

async function handleRequest(req, res, context) {
  applySecurityHeaders(res);
  applyCors(req, res, context.config);
  if (req.method === "OPTIONS") {
    ensureAllowedOrigin(req, context.config);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = requestUrl(req);
  if (!url.pathname.startsWith("/api/")) {
    return serveStatic(req, res, url, context.staticDirectory);
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(req, res, 200, liveness(context));
  }
  if (req.method === "GET" && url.pathname === "/api/readiness") {
    const readiness = protectionReadiness(context.engine, context.now());
    return sendJson(req, res, readiness.ready ? 200 : 503, readiness);
  }
  if (req.method === "GET" && url.pathname === "/api/auth/status") {
    return sendJson(req, res, 200, {
      authenticated: context.auth.isAuthenticated(req, context.now()),
      configured: context.auth.configured && Boolean(context.engine),
      configurationIssues: context.config.configurationIssues,
      startupError: context.startupError?.message || null,
    });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    ensureAllowedOrigin(req, context.config);
    if (!context.auth.configured) throw httpError(503, "Application authentication is not configured");
    const key = clientAddress(req, context.config);
    const limit = context.loginLimiter.check(key);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))));
      throw httpError(429, "Too many login attempts; try again later");
    }
    const body = await readJson(req);
    if (!context.auth.verifyPassword(body.password)) {
      context.loginLimiter.fail(key);
      throw httpError(401, "Invalid application password");
    }
    context.loginLimiter.clear(key);
    res.setHeader("Set-Cookie", context.auth.issueCookie(context.now()));
    return sendJson(req, res, 200, { authenticated: true });
  }

  requireAppAuthentication(req, context);
  if (isMutation(req.method)) ensureAllowedOrigin(req, context.config);

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    res.setHeader("Set-Cookie", context.auth.clearCookie());
    return sendJson(req, res, 200, { authenticated: false, protectionContinues: Boolean(context.engine?.state.kill.active) });
  }

  const engine = requireEngine(context);
  if (req.method === "GET" && url.pathname === "/api/login-url") {
    return sendJson(req, res, 200, {
      loginUrl: engine.client.getLoginUrl(),
      redirectUrl: context.config.redirectUrl,
    });
  }
  if (req.method === "POST" && url.pathname === "/api/session") {
    const body = await readJson(req);
    if (typeof body.requestToken !== "string" || !body.requestToken.trim()) {
      throw httpError(400, "requestToken is required");
    }
    const session = await engine.client.generateSession(body.requestToken.trim());
    await engine.connectSession(session);
    return sendJson(req, res, 200, publicState(engine, context.now()));
  }
  if (req.method === "POST" && url.pathname === "/api/session/logout") {
    await engine.disconnectSession();
    return sendJson(req, res, 200, publicState(engine, context.now()));
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(req, res, 200, publicState(engine, context.now()));
  }
  if (req.method === "POST" && url.pathname === "/api/settings") {
    const body = await readJson(req);
    const settings = validateSettings(body, engine.state.settings);
    await engine.updateSettings(settings);
    return sendJson(req, res, 200, publicState(engine, context.now()));
  }
  if (req.method === "POST" && url.pathname === "/api/monitor/start") {
    await engine.startMonitoring();
    return sendJson(req, res, 200, publicState(engine, context.now()));
  }
  if (req.method === "POST" && url.pathname === "/api/monitor/stop") {
    await engine.stopMonitoring();
    return sendJson(req, res, 200, publicState(engine, context.now()));
  }
  if (req.method === "POST" && url.pathname === "/api/kill/activate") {
    const body = await readJson(req);
    await engine.manualKill(
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 300)
        : "Manual reactive lock activation",
    );
    return sendJson(req, res, 200, publicState(engine, context.now()));
  }
  if (req.method === "POST" && url.pathname === "/api/kill/arm-next-day") {
    await engine.armNextDay();
    return sendJson(req, res, 200, publicState(engine, context.now()));
  }
  if (req.method === "POST" && url.pathname === "/api/kill/reset") {
    throw new GuardInvariantError("Same-day kill reset has been removed; use next-day arming after the account is verified flat", {
      code: "RESET_REMOVED",
      status: 423,
    });
  }
  if (req.method === "POST" && url.pathname === "/api/snapshot/refresh") {
    await engine.refreshSnapshot();
    return sendJson(req, res, 200, publicState(engine, context.now()));
  }

  throw httpError(404, "API endpoint not found");
}

function publicState(engine, now) {
  const state = engine.state;
  const readiness = protectionReadiness(engine, now);
  return {
    lockMode: "REACTIVE_POSITION_LOCK",
    connected: engine.hasUsableSession(),
    user: state.session
      ? {
          userId: state.session.userId,
          userName: state.session.userName,
          loginAt: state.session.loginAt,
          invalid: Boolean(state.session.invalid),
        }
      : null,
    monitoring: state.monitoring,
    day: state.day,
    kill: {
      active: state.kill.active,
      date: state.kill.date,
      activatedAt: state.kill.activatedAt,
      reason: state.kill.reason,
      phase: state.kill.phase,
      verifiedFlat: state.kill.verifiedFlat,
      flatVerifiedAt: state.kill.flatVerifiedAt,
      lastReconciledAt: state.kill.lastReconciledAt,
      unresolvedExposureCount: state.kill.unresolvedExposureCount,
      canArmNextDay:
        engine.hasUsableSession() &&
        state.kill.active &&
        state.kill.date !== tradingDate(now) &&
        state.kill.verifiedFlat,
    },
    settings: state.settings,
    pnl: state.pnl,
    positions: state.positions,
    orders: state.orders,
    gtts: state.gtts,
    actions: state.actions.slice(-120).reverse(),
    health: {
      ...state.health,
      ready: readiness.ready,
      freshnessMs: readiness.freshnessMs,
    },
  };
}

function liveness(context) {
  const readiness = protectionReadiness(context.engine, context.now());
  const phase = context.engine?.state.kill.phase || "NOT_CONFIGURED";
  return {
    ok: true,
    process: "UP",
    configured: Boolean(context.engine),
    authConfigured: context.auth.configured,
    startupError: context.startupError?.message || null,
    configurationIssues: context.config.configurationIssues,
    protection: readiness.ready ? phase : "UNAVAILABLE",
    protectionReady: readiness.ready,
    phase,
  };
}

function protectionReadiness(engine, now) {
  if (!engine) return { ready: false, reason: "Guard engine is not configured", freshnessMs: null };
  const state = engine.state;
  const timestamp = state.kill.active ? state.health.lastGuardCheckAt : state.health.lastRiskCheckAt;
  const freshnessMs = timestamp ? Math.max(0, now.getTime() - new Date(timestamp).getTime()) : null;
  const maximumAge = state.kill.active
    ? Math.max(10_000, state.settings.guardPollMs * 5)
    : Math.max(15_000, state.settings.riskPollMs * 5);
  const ready =
    engine.hasUsableSession() &&
    (state.monitoring || state.kill.active) &&
    state.health.status === "HEALTHY" &&
    freshnessMs !== null &&
    freshnessMs <= maximumAge;
  return {
    ready,
    reason: ready
      ? "Protection loop is current"
      : state.health.lastError || (!engine.hasUsableSession()
        ? "Kite session is disconnected"
        : state.health.status !== "HEALTHY"
          ? `Protection health is ${state.health.status}`
          : "Protection loop is stale"),
    freshnessMs,
    status: state.health.status,
    phase: state.kill.phase,
  };
}

function requireAppAuthentication(req, context) {
  if (!context.auth.configured) throw httpError(503, "Application authentication is not configured");
  if (!context.auth.isAuthenticated(req, context.now())) throw httpError(401, "Application login required");
}

function requireEngine(context) {
  if (!context.engine) {
    throw httpError(503, context.startupError?.message || "Guard engine is not configured");
  }
  return context.engine;
}

function ensureAllowedOrigin(req, config) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (!isAllowedOrigin(req, origin, config)) throw httpError(403, "Request origin is not allowed");
}

function applyCors(req, res, config) {
  const origin = req.headers.origin;
  if (!origin || !isAllowedOrigin(req, origin, config)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isAllowedOrigin(req, origin, config) {
  const normalized = String(origin).replace(/\/$/, "");
  if (config.appOrigins.includes(normalized)) return true;
  const forwardedProtocol = config.trustProxy ? req.headers["x-forwarded-proto"] : null;
  const protocol = String(forwardedProtocol || (req.socket.encrypted ? "https" : "http"))
    .split(",")[0]
    .trim();
  return normalized === `${protocol}://${req.headers.host}`;
}

function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    // Next's static export contains inline hydration bootstraps. Because this
    // server does not rewrite HTML per request, nonces are not available.
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://kite.zerodha.com",
  );
  res.setHeader("Cache-Control", "no-store");
}

function serveStatic(req, res, url, staticDirectory) {
  if (!staticDirectory || !["GET", "HEAD"].includes(req.method)) throw httpError(404, "Not found");
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const requested = resolve(staticDirectory, `.${pathname}`);
  const relativePath = relative(staticDirectory, requested);
  if (relativePath.startsWith("..") || isAbsolute(relativePath) || !existsSync(requested)) {
    throw httpError(404, "Not found");
  }
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
  }[extname(requested)] || "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", type);
  if (requested.includes(`${join(staticDirectory, "_next")}`)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  if (req.method === "HEAD") return res.end();
  res.end(readFileSync(requested));
}

function selectStaticDirectory(rootDir) {
  const nextExport = join(rootDir, "out");
  if (existsSync(join(nextExport, "index.html"))) return nextExport;
  // Never fall back to the retired prototype dashboard: its controls and
  // status model do not represent the live guard. The API remains available
  // so an already-running protection loop is not coupled to a UI build.
  return null;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256_000) throw httpError(413, "Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON root must be an object");
    }
    return parsed;
  } catch (error) {
    throw httpError(400, `Invalid JSON body: ${error.message}`);
  }
}

function requestUrl(req) {
  try {
    return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  } catch {
    throw httpError(400, "Invalid request URL");
  }
}

function sendJson(_req, res, status, payload) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendError(req, res, error, context) {
  const normalized = normalizeHttpError(error);
  applySecurityHeaders(res);
  applyCors(req, res, context.config);
  sendJson(req, res, normalized.status, {
    error: normalized.message,
    code: normalized.code,
  });
}

function normalizeHttpError(error) {
  if (error instanceof GuardInvariantError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof KiteApiError) {
    const status = error.errorType === "TokenException" ? 401 : 502;
    return { status, code: error.errorType, message: error.message };
  }
  if (error?.httpStatus) {
    return { status: error.httpStatus, code: error.code || "HTTP_ERROR", message: error.message };
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return { status: 400, code: "VALIDATION_ERROR", message: error.message };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "Internal server error" };
}

function httpError(status, message, code = "HTTP_ERROR") {
  const error = new Error(message);
  error.httpStatus = status;
  error.code = code;
  return error;
}

function clientAddress(req, config) {
  const address = config.trustProxy
    ? req.headers["x-forwarded-for"] || req.socket.remoteAddress
    : req.socket.remoteAddress;
  return String(address || "unknown")
    .split(",")[0]
    .trim();
}

function isMutation(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

function tradingDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let application;
  try {
    application = await createGuardApplication();
    const address = await application.listen();
    const port = typeof address === "object" && address ? address.port : application.config.port;
    console.log(`TradeGuardian reactive lock running on http://${application.config.host}:${port}`);
    if (application.startupError) {
      console.error(`Guard engine is not active: ${application.startupError.message}`);
    }
  } catch (error) {
    console.error(`Could not start TradeGuardian: ${error.message}`);
    process.exitCode = 1;
  }

  const shutdown = async (signal) => {
    console.log(`Received ${signal}; saving guard state and shutting down`);
    try {
      await application?.close();
    } catch (error) {
      console.error(`Shutdown failed: ${error.message}`);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
