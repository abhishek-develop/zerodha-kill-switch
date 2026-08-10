import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EncryptedStateStore,
  StateRecoveryError,
} from "../backend/state-store.js";

const SECRET = "test-only-secret-with-at-least-32-characters";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "kill-switch-state-"));
  const filePath = join(directory, "state.json");
  return {
    directory,
    filePath,
    store: new EncryptedStateStore({ filePath, secret: SECRET }),
  };
}

test("round-trips state without storing the access token as plaintext", async () => {
  const { filePath, store } = await fixture();
  const state = {
    session: { accessToken: "highly-sensitive-access-token" },
    kill: { active: true },
  };

  await store.save(state);

  const raw = await readFile(filePath, "utf8");
  assert.doesNotMatch(raw, /highly-sensitive-access-token/);
  assert.deepEqual(await store.load(() => ({ fresh: true })), state);
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  assert.equal((await stat(store.markerPath)).mode & 0o777, 0o600);
});

test("rejects a state encrypted with a different key", async () => {
  const { filePath, store } = await fixture();
  await store.save({ kill: { active: true } });
  const wrongKeyStore = new EncryptedStateStore({
    filePath,
    secret: "a-different-secret-that-is-also-at-least-32-characters",
  });

  await assert.rejects(
    wrongKeyStore.load(() => ({ kill: { active: false } })),
    StateRecoveryError,
  );
});

test("fails closed when encrypted state is corrupted", async () => {
  const { filePath, store } = await fixture();
  await store.save({ session: { accessToken: "secret" } });
  const envelope = JSON.parse(await readFile(filePath, "utf8"));
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  ciphertext[0] ^= 0xff;
  envelope.ciphertext = ciphertext.toString("base64");
  await writeFile(filePath, JSON.stringify(envelope), "utf8");

  await assert.rejects(store.load(() => ({ reset: true })), StateRecoveryError);
});

test("atomically replaces existing state and leaves no temporary files", async () => {
  const { directory, filePath, store } = await fixture();
  await store.save({ revision: 1, payload: "old".repeat(10_000) });
  const firstEnvelope = await readFile(filePath, "utf8");

  await store.save({ revision: 2, payload: "new".repeat(10_000) });

  const secondEnvelope = await readFile(filePath, "utf8");
  assert.notEqual(secondEnvelope, firstEnvelope);
  assert.deepEqual(await store.load(() => ({ revision: 0 })), {
    revision: 2,
    payload: "new".repeat(10_000),
  });
  assert.equal((await readdir(directory)).some((name) => name.endsWith(".tmp")), false);
});

test("returns createFresh state on a true first run", async () => {
  const { filePath, store } = await fixture();
  let calls = 0;

  const state = await store.load(() => {
    calls += 1;
    return { kill: { active: false } };
  });

  assert.deepEqual(state, { kill: { active: false } });
  assert.equal(calls, 1);
  await assert.rejects(readFile(filePath), { code: "ENOENT" });
  await assert.rejects(readFile(store.markerPath), { code: "ENOENT" });
});

test("fails closed when initialized state goes missing", async () => {
  const { filePath, store } = await fixture();
  await store.save({ kill: { active: true } });
  await unlink(filePath);

  await assert.rejects(
    store.load(() => ({ kill: { active: false } })),
    (error) => {
      assert(error instanceof StateRecoveryError);
      assert.match(error.message, /missing/i);
      return true;
    },
  );
});

test("migrates a valid legacy plaintext object to encrypted storage", async () => {
  const { filePath, store } = await fixture();
  const legacy = {
    session: { accessToken: "legacy-plaintext-token" },
    kill: { active: true },
  };
  await writeFile(filePath, JSON.stringify(legacy), "utf8");

  assert.deepEqual(await store.load(() => ({ fresh: true })), legacy);

  const migrated = await readFile(filePath, "utf8");
  assert.doesNotMatch(migrated, /legacy-plaintext-token/);
  assert.equal(JSON.parse(migrated).format, "zerodha-kill-switch-state");
  assert.equal(JSON.parse(await readFile(store.markerPath, "utf8")).initialized, true);
});
