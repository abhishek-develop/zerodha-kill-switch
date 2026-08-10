import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const FORMAT = "zerodha-kill-switch-state";
const ALGORITHM = "aes-256-gcm";
const VERSION = 1;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_DOMAIN_SEPARATOR = "\0zerodha-kill-switch:local-state:v1";
const AAD = Buffer.from(`${FORMAT}:v${VERSION}`, "utf8");

export class StateRecoveryError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "StateRecoveryError";
    this.code = "STATE_RECOVERY_FAILED";
  }
}

export class EncryptedStateStore {
  #key;
  #writeQueue = Promise.resolve();

  constructor({ filePath, secret } = {}) {
    if (typeof filePath !== "string" || filePath.trim() === "") {
      throw new TypeError("filePath must be a non-empty string");
    }
    if (typeof secret !== "string" || secret.length < 32) {
      throw new TypeError("secret must be a string containing at least 32 characters");
    }

    this.filePath = resolve(filePath);
    this.markerPath = `${this.filePath}.initialized`;
    this.#key = createHash("sha256")
      .update(secret, "utf8")
      .update(KEY_DOMAIN_SEPARATOR, "utf8")
      .digest();
  }

  async save(state) {
    const plaintext = serializeState(state);
    const operation = this.#writeQueue.then(() => this.#saveSerialized(plaintext));

    // Keep later writes usable after an individual write fails, while returning
    // the original operation so its caller still observes that failure.
    this.#writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async load(createFresh) {
    if (typeof createFresh !== "function") {
      throw new TypeError("createFresh must be a function");
    }

    await this.#writeQueue;

    let stateContents;
    let markerContents;
    try {
      [stateContents, markerContents] = await Promise.all([
        readOptionalFile(this.filePath),
        readOptionalFile(this.markerPath),
      ]);
    } catch (cause) {
      throw new StateRecoveryError("Could not read the guard state", { cause });
    }

    if (stateContents === null) {
      if (markerContents !== null) {
        throw new StateRecoveryError(
          "Guard state is missing even though this store was previously initialized",
        );
      }

      const freshState = await createFresh();
      assertStateObject(freshState, "createFresh must return a JSON object");
      return freshState;
    }

    let parsed;
    try {
      parsed = JSON.parse(stateContents);
    } catch (cause) {
      throw new StateRecoveryError("Guard state is not valid JSON", { cause });
    }

    // A marker means this store has already written the encrypted format. With
    // no marker, recognize an envelope as encrypted too (for crash recovery
    // between the state rename and the marker write).
    if (markerContents !== null || looksLikeEncryptedEnvelope(parsed)) {
      return this.#decryptEnvelope(parsed);
    }

    // The only accepted migration is the pre-encryption state.json format: a
    // JSON object in a store that has never acquired our initialization marker.
    if (!isStateObject(parsed)) {
      throw new StateRecoveryError("Legacy guard state must be a JSON object");
    }

    try {
      await this.save(parsed);
    } catch (cause) {
      throw new StateRecoveryError("Could not migrate the legacy guard state", { cause });
    }
    return parsed;
  }

  async #saveSerialized(plaintext) {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const envelope = `${JSON.stringify({
      format: FORMAT,
      version: VERSION,
      algorithm: ALGORITHM,
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    })}\n`;

    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeAtomic(this.filePath, envelope);

    const marker = `${JSON.stringify({
      format: `${FORMAT}-marker`,
      version: VERSION,
      initialized: true,
    })}\n`;
    await writeAtomic(this.markerPath, marker);
  }

  #decryptEnvelope(envelope) {
    try {
      validateEnvelope(envelope);
      const iv = decodeBase64(envelope.iv, "iv", IV_BYTES);
      const authTag = decodeBase64(envelope.authTag, "authTag", AUTH_TAG_BYTES);
      const ciphertext = decodeBase64(envelope.ciphertext, "ciphertext");
      const decipher = createDecipheriv(ALGORITHM, this.#key, iv, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(AAD);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
      const state = JSON.parse(plaintext);
      assertStateObject(state, "Decrypted guard state must be a JSON object");
      return state;
    } catch (cause) {
      if (cause instanceof StateRecoveryError) throw cause;
      throw new StateRecoveryError(
        "Guard state could not be authenticated or decrypted",
        { cause },
      );
    }
  }
}

function serializeState(state) {
  assertStateObject(state, "state must be a JSON object");

  let plaintext;
  try {
    plaintext = JSON.stringify(state);
  } catch (cause) {
    throw new TypeError("state must be JSON-serializable", { cause });
  }

  // toJSON() is allowed, but it may not turn the root state into a primitive.
  try {
    assertStateObject(JSON.parse(plaintext), "state must serialize to a JSON object");
  } catch (cause) {
    if (cause instanceof TypeError) throw cause;
    throw new TypeError("state must be JSON-serializable", { cause });
  }
  return plaintext;
}

function validateEnvelope(envelope) {
  if (!isStateObject(envelope)) {
    throw new StateRecoveryError("Encrypted guard state must be a JSON object");
  }
  if (
    envelope.format !== FORMAT
    || envelope.version !== VERSION
    || envelope.algorithm !== ALGORITHM
    || typeof envelope.iv !== "string"
    || typeof envelope.authTag !== "string"
    || typeof envelope.ciphertext !== "string"
  ) {
    throw new StateRecoveryError("Encrypted guard state has an invalid envelope");
  }
}

function looksLikeEncryptedEnvelope(value) {
  return isStateObject(value) && (
    value.format === FORMAT
    || value.algorithm === ALGORITHM
    || "ciphertext" in value
    || "authTag" in value
  );
}

function decodeBase64(value, field, expectedBytes) {
  if (
    value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new StateRecoveryError(`Encrypted guard state has invalid ${field}`);
  }
  const decoded = Buffer.from(value, "base64");
  if (expectedBytes !== undefined && decoded.length !== expectedBytes) {
    throw new StateRecoveryError(`Encrypted guard state has invalid ${field}`);
  }
  return decoded;
}

function assertStateObject(value, message) {
  if (!isStateObject(value)) throw new TypeError(message);
}

function isStateObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readOptionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(targetPath, contents) {
  const directory = dirname(targetPath);
  const temporaryPath = resolve(
    directory,
    `.${basename(targetPath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;

  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, targetPath);
    await syncDirectory(directory);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch((unlinkError) => {
      if (unlinkError?.code !== "ENOENT") error.cleanupError = unlinkError;
    });
    throw error;
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    // Some filesystems/platforms do not support fsync on a directory. The state
    // file itself has already been fsynced before its atomic rename.
    if (!["EINVAL", "ENOTSUP", "EBADF", "EISDIR", "EPERM"].includes(error?.code)) {
      throw error;
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}
