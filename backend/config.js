import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export function loadEnvFile(rootDir, env = process.env) {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!(key in env)) env[key] = value;
  }
}

export function buildConfig(rootDir, env = process.env) {
  const port = boundedNumber(env.PORT, 3000, 1, 65_535, "PORT", true);
  // Keep the legacy filename so an existing plaintext latch is migrated in
  // place instead of silently starting with a fresh, unlatched state.
  const statePath = env.STATE_FILE || ".data/state.json";
  const appOrigins = parseOrigins(env.APP_ORIGIN);
  const flattenProducts = parseProducts(env.FLATTEN_PRODUCTS || "ALL");
  const appSecret = String(env.APP_SECRET || "");
  const appPassword = String(env.APP_PASSWORD || "");
  const apiKey = String(env.KITE_API_KEY || "");
  const apiSecret = String(env.KITE_API_SECRET || "");
  const alertWebhookUrl = optionalWebhookUrl(env.ALERT_WEBHOOK_URL);
  const cookieName = String(env.AUTH_COOKIE_NAME || "tradeguardian_session");
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookieName)) {
    throw new TypeError("AUTH_COOKIE_NAME contains invalid cookie-name characters");
  }

  const configurationIssues = [];
  if (!apiKey) configurationIssues.push("KITE_API_KEY is missing");
  if (!apiSecret) configurationIssues.push("KITE_API_SECRET is missing");
  if (!appPassword || appPassword.length < 10) {
    configurationIssues.push("APP_PASSWORD must contain at least 10 characters");
  }
  if (appSecret.length < 32) {
    configurationIssues.push("APP_SECRET must contain at least 32 characters");
  }

  return {
    port,
    host: String(env.HOST || "127.0.0.1").trim() || "127.0.0.1",
    rootDir,
    apiKey,
    apiSecret,
    kiteBase: String(env.KITE_BASE_URL || "https://api.kite.trade").replace(/\/$/, ""),
    redirectUrl: String(env.KITE_REDIRECT_URL || `http://localhost:${port}/`),
    stateFile: isAbsolute(statePath) ? statePath : resolve(rootDir, statePath),
    appPassword,
    appSecret,
    appOrigins,
    cookieName,
    cookieSecure:
      booleanEnv(env.COOKIE_SECURE, env.NODE_ENV === "production") ||
      String(env.KITE_REDIRECT_URL || "").startsWith("https://"),
    trustProxy: booleanEnv(env.TRUST_PROXY, false),
    alertWebhookUrl,
    alertWebhookTimeoutMs: boundedNumber(env.ALERT_WEBHOOK_TIMEOUT_MS, 3_000, 500, 15_000, "ALERT_WEBHOOK_TIMEOUT_MS"),
    authTtlMs: boundedNumber(env.AUTH_TTL_MS, 12 * 60 * 60 * 1000, 60_000, 7 * 24 * 60 * 60 * 1000, "AUTH_TTL_MS"),
    requestTimeoutMs: boundedNumber(env.KITE_REQUEST_TIMEOUT_MS, 5_000, 1_000, 30_000, "KITE_REQUEST_TIMEOUT_MS"),
    exitOrderMaxAgeMs: boundedNumber(env.EXIT_ORDER_MAX_AGE_MS, 15_000, 5_000, 120_000, "EXIT_ORDER_MAX_AGE_MS"),
    settlementGraceMs: boundedNumber(env.SETTLEMENT_GRACE_MS, 4_000, 1_000, 30_000, "SETTLEMENT_GRACE_MS"),
    defaults: {
      maxLoss: boundedNumber(env.MAX_LOSS, 10_000, 1, 100_000_000, "MAX_LOSS"),
      riskPollMs: boundedNumber(env.PNL_POLL_MS, 2_000, 1_000, 60_000, "PNL_POLL_MS"),
      guardPollMs: boundedNumber(env.GUARD_POLL_MS, 1_000, 750, 30_000, "GUARD_POLL_MS"),
      marketProtection: marketProtection(env.MARKET_PROTECTION, -1),
      flattenProducts,
      cancelGttOnKill: booleanEnv(env.CANCEL_GTT_ON_KILL, true),
      chargeBuffer: boundedNumber(env.CHARGE_BUFFER, 0, 0, 10_000_000, "CHARGE_BUFFER"),
    },
    configurationIssues,
  };
}

export function validateSettings(input, current) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Settings must be a JSON object");
  }

  const next = { ...current };
  if (Object.hasOwn(input, "maxLoss")) {
    next.maxLoss = boundedNumber(input.maxLoss, undefined, 1, 100_000_000, "maxLoss");
  }
  if (Object.hasOwn(input, "riskPollMs") || Object.hasOwn(input, "pnlPollMs")) {
    next.riskPollMs = boundedNumber(input.riskPollMs ?? input.pnlPollMs, undefined, 1_000, 60_000, "riskPollMs");
  }
  if (Object.hasOwn(input, "guardPollMs")) {
    next.guardPollMs = boundedNumber(input.guardPollMs, undefined, 750, 30_000, "guardPollMs");
  }
  if (Object.hasOwn(input, "marketProtection")) {
    next.marketProtection = marketProtection(input.marketProtection);
  }
  if (Object.hasOwn(input, "flattenProducts")) {
    next.flattenProducts = parseProducts(input.flattenProducts);
  }
  if (Object.hasOwn(input, "cancelGttOnKill")) {
    if (typeof input.cancelGttOnKill !== "boolean") {
      throw new TypeError("cancelGttOnKill must be a boolean");
    }
    next.cancelGttOnKill = input.cancelGttOnKill;
  }
  if (Object.hasOwn(input, "chargeBuffer")) {
    next.chargeBuffer = boundedNumber(input.chargeBuffer, undefined, 0, 10_000_000, "chargeBuffer");
  }
  return next;
}

export function parseProducts(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const products = [...new Set(raw.map((item) => String(item).trim().toUpperCase()).filter(Boolean))];
  if (products.includes("ALL")) return ["ALL"];
  const allowed = new Set(["MIS", "NRML", "CNC", "MTF", "CO", "BO"]);
  if (!products.length || products.some((product) => !allowed.has(product))) {
    throw new RangeError("flattenProducts must contain ALL or supported Kite products");
  }
  return products;
}

function parseOrigins(value) {
  if (!value) return [];
  const origins = String(value)
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (origins.includes("*")) {
    throw new RangeError("APP_ORIGIN cannot be '*'");
  }
  const validated = origins.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new TypeError(`APP_ORIGIN contains an invalid origin: ${origin}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new TypeError(`APP_ORIGIN must contain exact HTTP(S) origins without paths: ${origin}`);
    }
    return parsed.origin;
  });
  return [...new Set(validated)];
}

function marketProtection(value, fallback) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new TypeError("marketProtection is required");
  }
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new TypeError("marketProtection must be an integer");
  }
  if (number !== -1 && number !== 0 && (number < 1 || number > 100)) {
    throw new RangeError("marketProtection must be -1, 0, or between 1 and 100");
  }
  return number;
}

function boundedNumber(value, fallback, min, max, name, integer = false) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new TypeError(`${name} is required`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) {
    throw new TypeError(`${name} must be a finite ${integer ? "integer" : "number"}`);
  }
  if (number < min || number > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}`);
  }
  return number;
}

function booleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new TypeError(`Invalid boolean value: ${value}`);
}

function optionalWebhookUrl(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new TypeError("ALERT_WEBHOOK_URL must be an absolute URL");
  }
  const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new TypeError("ALERT_WEBHOOK_URL must use HTTPS (HTTP is allowed only for loopback testing)");
  }
  return parsed.toString();
}
