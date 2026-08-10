export class WebhookNotifier {
  constructor({
    url,
    timeoutMs = 3_000,
    repeatWindowMs = 60_000,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
  } = {}) {
    this.url = url || null;
    this.timeoutMs = timeoutMs;
    this.repeatWindowMs = repeatWindowMs;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sent = new Map();
  }

  get enabled() {
    return Boolean(this.url);
  }

  async notify({ type, severity = "warning", message, phase = null } = {}) {
    if (!this.enabled) return false;
    const key = `${type}:${severity}:${message}`;
    const timestamp = this.now();
    const previous = this.sent.get(key);
    if (previous && timestamp.getTime() - previous < this.repeatWindowMs) return false;
    this.sent.set(key, timestamp.getTime());
    this.prune(timestamp.getTime());

    const controller = new AbortController();
    let timer;
    try {
      const text = `[TradeGuardian] ${String(severity).toUpperCase()} ${type}: ${message}`;
      const request = Promise.resolve().then(() => this.fetchImpl(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          event: {
            application: "TradeGuardian",
            type,
            severity,
            message,
            phase,
            at: timestamp.toISOString(),
          },
        }),
        signal: controller.signal,
      }));
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Alert webhook timed out after ${this.timeoutMs}ms`));
        }, this.timeoutMs);
      });
      const response = await Promise.race([request, timeout]);
      if (!response?.ok) throw new Error(`Alert webhook returned HTTP ${response?.status || 0}`);
      return true;
    } catch (error) {
      this.sent.delete(key);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  prune(now) {
    for (const [key, timestamp] of this.sent) {
      if (now - timestamp >= this.repeatWindowMs) this.sent.delete(key);
    }
  }
}
