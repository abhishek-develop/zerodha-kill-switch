import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export class AppAuthenticator {
  constructor({ password, secret, cookieName = "tradeguardian_session", secure = false, ttlMs = 43_200_000 }) {
    this.password = String(password || "");
    this.secret = String(secret || "");
    this.cookieName = cookieName;
    this.secure = secure;
    this.ttlMs = ttlMs;
  }

  get configured() {
    return this.password.length >= 10 && this.secret.length >= 32;
  }

  verifyPassword(candidate) {
    if (!this.configured || typeof candidate !== "string") return false;
    const expected = this.digest(`password:${this.password}`);
    const received = this.digest(`password:${candidate}`);
    return timingSafeEqual(expected, received);
  }

  issueCookie(now = new Date()) {
    if (!this.configured) throw new Error("Application authentication is not configured");
    const issuedAt = now.getTime();
    const nonce = randomBytes(18).toString("base64url");
    const payload = `v1.${issuedAt}.${nonce}`;
    const signature = this.digest(`session:${payload}`).toString("base64url");
    const value = `${payload}.${signature}`;
    const attributes = [
      `${this.cookieName}=${value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${Math.floor(this.ttlMs / 1000)}`,
    ];
    if (this.secure) attributes.push("Secure");
    return attributes.join("; ");
  }

  clearCookie() {
    const attributes = [
      `${this.cookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=0",
    ];
    if (this.secure) attributes.push("Secure");
    return attributes.join("; ");
  }

  isAuthenticated(req, now = new Date()) {
    if (!this.configured) return false;
    const cookies = parseCookies(req.headers.cookie || "");
    const value = cookies[this.cookieName];
    if (!value) return false;
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") return false;
    const issuedAt = Number(parts[1]);
    if (!Number.isSafeInteger(issuedAt)) return false;
    const age = now.getTime() - issuedAt;
    if (age < -60_000 || age > this.ttlMs) return false;
    const payload = parts.slice(0, 3).join(".");
    let signature;
    try {
      signature = Buffer.from(parts[3], "base64url");
    } catch {
      return false;
    }
    const expected = this.digest(`session:${payload}`);
    return signature.length === expected.length && timingSafeEqual(signature, expected);
  }

  digest(value) {
    return createHmac("sha256", this.secret).update(value).digest();
  }
}

export class LoginRateLimiter {
  constructor({ maxAttempts = 5, windowMs = 15 * 60_000, maxKeys = 10_000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.attempts = new Map();
  }

  check(key, now = Date.now()) {
    const attempt = this.current(key, now);
    return {
      allowed: attempt.count < this.maxAttempts,
      retryAfterMs: Math.max(0, attempt.resetAt - now),
    };
  }

  fail(key, now = Date.now()) {
    if (!this.attempts.has(key) && this.attempts.size >= this.maxKeys) {
      for (const [candidate, value] of this.attempts) {
        if (value.resetAt <= now) this.attempts.delete(candidate);
      }
      while (this.attempts.size >= this.maxKeys) {
        this.attempts.delete(this.attempts.keys().next().value);
      }
    }
    const attempt = this.current(key, now);
    attempt.count += 1;
    this.attempts.set(key, attempt);
  }

  clear(key) {
    this.attempts.delete(key);
  }

  current(key, now) {
    const existing = this.attempts.get(key);
    if (!existing || existing.resetAt <= now) {
      return { count: 0, resetAt: now + this.windowMs };
    }
    return existing;
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const item of String(header).split(";")) {
    const separator = item.indexOf("=");
    if (separator === -1) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}
