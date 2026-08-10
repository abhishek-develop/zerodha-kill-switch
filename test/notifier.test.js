import assert from "node:assert/strict";
import test from "node:test";

import { WebhookNotifier } from "../backend/notifier.js";

test("sends a structured, Slack-compatible alert and suppresses immediate duplicates", async () => {
  const requests = [];
  const notifier = new WebhookNotifier({
    url: "https://alerts.test/guard",
    now: () => new Date("2026-08-10T05:00:00.000Z"),
    fetchImpl: async (url, request) => {
      requests.push({ url, request });
      return { ok: true, status: 200 };
    },
  });
  const event = {
    type: "KILL_ACTIVATED",
    severity: "critical",
    message: "Daily limit breached",
    phase: "TRIPPED",
  };

  assert.equal(await notifier.notify(event), true);
  assert.equal(await notifier.notify(event), false);
  assert.equal(requests.length, 1);
  const payload = JSON.parse(requests[0].request.body);
  assert.match(payload.text, /TradeGuardian.*KILL_ACTIVATED/);
  assert.deepEqual(payload.event, {
    application: "TradeGuardian",
    ...event,
    at: "2026-08-10T05:00:00.000Z",
  });
});

test("does not perform network work when no webhook is configured", async () => {
  let calls = 0;
  const notifier = new WebhookNotifier({ fetchImpl: async () => { calls += 1; } });
  assert.equal(await notifier.notify({ type: "TEST", message: "ignored" }), false);
  assert.equal(calls, 0);
});

test("bounds stalled webhook delivery and allows a later retry", async () => {
  let calls = 0;
  const signals = [];
  const notifier = new WebhookNotifier({
    url: "https://alerts.test/guard",
    timeoutMs: 10,
    fetchImpl: (_url, request) => {
      calls += 1;
      signals.push(request.signal);
      return new Promise(() => {});
    },
  });

  await assert.rejects(notifier.notify({ type: "TEST", message: "timeout" }), /timed out/);
  await assert.rejects(notifier.notify({ type: "TEST", message: "timeout" }), /timed out/);
  assert.equal(calls, 2);
  assert.ok(signals.every((signal) => signal.aborted));
});
