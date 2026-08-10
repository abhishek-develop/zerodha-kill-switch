import assert from "node:assert/strict";
import test from "node:test";

import { buildConfig, validateSettings } from "../backend/config.js";

const VALID_ENV = {
  KITE_API_KEY: "api-key",
  KITE_API_SECRET: "api-secret",
  APP_PASSWORD: "a sufficiently long password",
  APP_SECRET: "a-secret-value-that-is-at-least-thirty-two-characters",
};

test("uses the legacy state filename for encrypted in-place migration and all-product protection", () => {
  const config = buildConfig("/private/tmp/tradeguardian-config-test", VALID_ENV);
  assert.equal(config.stateFile, "/private/tmp/tradeguardian-config-test/.data/state.json");
  assert.deepEqual(config.defaults.flattenProducts, ["ALL"]);
  assert.equal(config.host, "127.0.0.1");
});

test("rejects unsafe browser origins, cookie names, and webhook transports", () => {
  assert.throws(
    () => buildConfig("/private/tmp/test", { ...VALID_ENV, APP_ORIGIN: "*" }),
    /cannot be '\*'/,
  );
  assert.throws(
    () => buildConfig("/private/tmp/test", { ...VALID_ENV, APP_ORIGIN: "https://guard.test/path" }),
    /without paths/,
  );
  assert.throws(
    () => buildConfig("/private/tmp/test", { ...VALID_ENV, AUTH_COOKIE_NAME: "bad cookie" }),
    /cookie-name/,
  );
  assert.throws(
    () => buildConfig("/private/tmp/test", { ...VALID_ENV, ALERT_WEBHOOK_URL: "http://alerts.example.test" }),
    /must use HTTPS/,
  );
});

test("rejects non-finite or out-of-range runtime settings", () => {
  const current = buildConfig("/private/tmp/test", VALID_ENV).defaults;
  assert.throws(() => validateSettings({ maxLoss: "not-a-number" }, current), /finite number/);
  assert.throws(() => validateSettings({ riskPollMs: 1 }, current), /between 1000 and 60000/);
  assert.throws(() => validateSettings({ flattenProducts: [] }, current), /supported Kite products/);
  assert.throws(() => validateSettings({ marketProtection: 1.5 }, current), /integer/);
});
