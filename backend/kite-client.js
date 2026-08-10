import { createHash } from "node:crypto";

const DEFAULT_BASE_URL = "https://api.kite.trade";
const LOGIN_URL = "https://kite.zerodha.com/connect/login";
const RETRYABLE_STATUS_CODES = new Set([429]);
const CHARGE_BATCH_SIZE = 10;

/**
 * A normalised Kite API failure. The original HTTP status and Kite error type
 * are retained so callers can make safe state-machine decisions without
 * matching error message strings.
 */
export class KiteApiError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "KiteApiError";
    this.status = options.status ?? 0;
    this.statusCode = this.status;
    this.errorType = options.errorType ?? "KiteApiError";
    this.data = options.data ?? null;
    this.code = options.code;
    this.isNetworkError = options.isNetworkError === true;
  }
}

export class KiteClient {
  constructor({
    apiKey,
    apiSecret,
    baseUrl = DEFAULT_BASE_URL,
    getAccessToken = () => null,
    timeoutMs = 5_000,
    onTokenError = () => {},
    fetchImpl = globalThis.fetch,
    retryDelayMs = 25,
    delayImpl = defaultDelay,
  } = {}) {
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new TypeError("apiKey must be a non-empty string");
    }
    if (typeof apiSecret !== "string") {
      throw new TypeError("apiSecret must be a string");
    }
    if (typeof getAccessToken !== "function") {
      throw new TypeError("getAccessToken must be a function");
    }
    if (typeof fetchImpl !== "function") {
      throw new TypeError("fetchImpl must be a function");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("timeoutMs must be a positive number");
    }
    if (typeof onTokenError !== "function") {
      throw new TypeError("onTokenError must be a function");
    }
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
      throw new TypeError("retryDelayMs must be a non-negative number");
    }
    if (typeof delayImpl !== "function") {
      throw new TypeError("delayImpl must be a function");
    }

    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.getAccessToken = getAccessToken;
    this.timeoutMs = timeoutMs;
    this.onTokenError = onTokenError;
    this.fetchImpl = fetchImpl;
    this.retryDelayMs = retryDelayMs;
    this.delayImpl = delayImpl;
  }

  getLoginUrl() {
    const params = new URLSearchParams({ v: "3", api_key: this.apiKey });
    return `${LOGIN_URL}?${params.toString()}`;
  }

  async generateSession(requestToken) {
    if (typeof requestToken !== "string" || requestToken.length === 0) {
      throw new TypeError("requestToken must be a non-empty string");
    }

    const checksum = createHash("sha256")
      .update(`${this.apiKey}${requestToken}${this.apiSecret}`)
      .digest("hex");

    const session = await this.#request("/session/token", {
      method: "POST",
      auth: false,
      params: {
        api_key: this.apiKey,
        request_token: requestToken,
        checksum,
      },
    });
    if (
      !session ||
      typeof session !== "object" ||
      Array.isArray(session) ||
      typeof session.access_token !== "string" ||
      !session.access_token ||
      typeof session.user_id !== "string" ||
      !session.user_id
    ) {
      throw invalidData("Kite session response is missing access_token or user_id", session);
    }
    return session;
  }

  async getPositions() {
    const positions = await this.#request("/portfolio/positions");
    if (
      !positions ||
      typeof positions !== "object" ||
      Array.isArray(positions) ||
      !Array.isArray(positions.net) ||
      !Array.isArray(positions.day)
    ) {
      throw invalidData("Kite positions response has an invalid shape", positions);
    }
    return positions;
  }

  async getOrders() {
    const orders = await this.#request("/orders");
    if (!Array.isArray(orders)) throw invalidData("Kite orders response has an invalid shape", orders);
    return orders;
  }

  async getGtts() {
    const triggers = await this.#request("/gtt/triggers");
    if (!Array.isArray(triggers)) throw invalidData("Kite GTT response has an invalid shape", triggers);
    return triggers;
  }

  cancelOrder(order) {
    if (!order || typeof order !== "object") {
      throw new TypeError("order must be an object");
    }

    const orderId = requiredPathPart(order.order_id, "order.order_id");
    const variety = requiredPathPart(order.variety || "regular", "order.variety");
    const params = order.parent_order_id
      ? { parent_order_id: order.parent_order_id }
      : undefined;

    return this.#request(`/orders/${variety}/${orderId}`, {
      method: "DELETE",
      params,
    });
  }

  deleteGtt(id) {
    return this.#request(`/gtt/triggers/${requiredPathPart(id, "GTT id")}`, {
      method: "DELETE",
    });
  }

  async placeExit(position, quantity, { marketProtection, tag } = {}) {
    if (!position || typeof position !== "object") {
      throw new TypeError("position must be an object");
    }

    const positionQuantity = Number(position.quantity);
    if (!Number.isFinite(positionQuantity) || positionQuantity === 0) {
      throw new TypeError("position.quantity must be non-zero");
    }

    const exitQuantity = Number(quantity);
    if (!Number.isSafeInteger(exitQuantity) || exitQuantity <= 0) {
      throw new TypeError("quantity must be a positive integer");
    }

    const params = {
      exchange: requiredValue(position.exchange, "position.exchange"),
      tradingsymbol: requiredValue(position.tradingsymbol, "position.tradingsymbol"),
      transaction_type: positionQuantity > 0 ? "SELL" : "BUY",
      quantity: exitQuantity,
      product: requiredValue(position.product, "position.product"),
      order_type: "MARKET",
      validity: "DAY",
      autoslice: true,
      market_protection: marketProtection,
      tag,
    };

    const data = await this.#request("/orders/regular", {
      method: "POST",
      params,
    });

    return normaliseOrderPlacement(data);
  }

  async calculateOrderCharges(orders) {
    if (!Array.isArray(orders)) {
      throw new TypeError("orders must be an array");
    }

    const executedOrders = orders
      .filter((order) => {
        const filledQuantity = Number(order?.filled_quantity);
        const averagePrice = Number(order?.average_price);
        return filledQuantity > 0 && Number.isFinite(averagePrice) && averagePrice > 0;
      })
      .map((order) => ({
        order_id: order.order_id,
        exchange: order.exchange,
        tradingsymbol: order.tradingsymbol,
        transaction_type: order.transaction_type,
        variety: order.variety || "regular",
        product: order.product,
        order_type: order.order_type,
        quantity: Number(order.filled_quantity),
        average_price: Number(order.average_price),
      }));

    if (executedOrders.length === 0) return 0;

    let total = 0;
    for (let index = 0; index < executedOrders.length; index += CHARGE_BATCH_SIZE) {
      const batch = executedOrders.slice(index, index + CHARGE_BATCH_SIZE);
      const data = await this.#request("/charges/orders", {
        method: "POST",
        json: batch,
      });

      if (!Array.isArray(data) || data.length !== batch.length) {
        throw invalidData("Kite charges response has an invalid shape", data);
      }

      for (const item of data) {
        const charge = Number(item?.charges?.total);
        if (!Number.isFinite(charge) || charge < 0) {
          throw invalidData("Kite charges response contains an invalid total", item);
        }
        total += charge;
      }
    }
    return total;
  }

  async #request(path, options = {}) {
    const method = options.method || "GET";
    const maxAttempts = method === "GET" ? 2 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.#requestOnce(path, { ...options, method });
      } catch (error) {
        const normalisedError = normaliseThrownError(error);
        const canRetry =
          attempt + 1 < maxAttempts &&
          normalisedError.errorType !== "TokenException" &&
          (normalisedError.isNetworkError ||
            normalisedError.status >= 500 ||
            RETRYABLE_STATUS_CODES.has(normalisedError.status));

        if (!canRetry) throw normalisedError;
        if (this.retryDelayMs > 0) {
          await this.delayImpl(this.retryDelayMs);
        }
      }
    }

    throw new KiteApiError("Kite request failed", { errorType: "NetworkException" });
  }

  async #requestOnce(path, options) {
    const headers = { "X-Kite-Version": "3" };
    if (options.auth !== false) {
      const accessToken = await this.getAccessToken();
      if (typeof accessToken !== "string" || accessToken.length === 0) {
        throw new KiteApiError("Kite access token is not available", {
          errorType: "TokenException",
        });
      }
      headers.Authorization = `token ${this.apiKey}:${accessToken}`;
    }

    let url = `${this.baseUrl}${path}`;
    const request = { method: options.method, headers };

    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(options.json);
    } else if (options.params) {
      const encoded = new URLSearchParams(cleanParams(options.params)).toString();
      if (options.method === "GET") {
        if (encoded) url += `${url.includes("?") ? "&" : "?"}${encoded}`;
      } else {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        request.body = encoded;
      }
    }

    const { response, payload } = await this.#fetchJsonWithTimeout(url, request);

    const isPayloadObject = payload !== null && typeof payload === "object" && !Array.isArray(payload);
    const isSuccess =
      response.ok === true &&
      isPayloadObject &&
      payload.status === "success" &&
      Object.prototype.hasOwnProperty.call(payload, "data");

    if (!isSuccess) {
      const errorType = isPayloadObject && typeof payload.error_type === "string"
        ? payload.error_type
        : "KiteApiError";
      const message = isPayloadObject && typeof payload.message === "string" && payload.message.length > 0
        ? payload.message
        : `Kite API request failed with HTTP ${response.status}`;
      const apiError = new KiteApiError(message, {
        status: response.status,
        errorType,
        data: isPayloadObject && Object.prototype.hasOwnProperty.call(payload, "data")
          ? payload.data
          : null,
      });

      // A TokenException while exchanging a short-lived request_token says
      // nothing about the currently installed access token. Invalidating the
      // live guard session here would let a bad login attempt disable it.
      if (errorType === "TokenException" && options.auth !== false) {
        try {
          await this.onTokenError(apiError);
        } catch {
          // Session cleanup must never hide the broker's original token error.
        }
      }
      throw apiError;
    }

    return payload.data;
  }

  async #fetchJsonWithTimeout(url, request) {
    const controller = new AbortController();
    let timer;
    let didTimeout = false;
    let response;

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        didTimeout = true;
        controller.abort();
        reject(new KiteApiError(`Kite API request timed out after ${this.timeoutMs}ms`, {
          errorType: "TimeoutException",
          code: "ETIMEDOUT",
          isNetworkError: true,
        }));
      }, this.timeoutMs);
    });

    try {
      const fetchAndRead = Promise.resolve().then(async () => {
        response = await this.fetchImpl(url, {
          ...request,
          signal: controller.signal,
        });
        const payload = await response.json();
        return { response, payload };
      });
      return await Promise.race([fetchAndRead, timeout]);
    } catch (error) {
      if (error instanceof KiteApiError) throw error;
      if (didTimeout || error?.name === "AbortError") {
        throw new KiteApiError(`Kite API request timed out after ${this.timeoutMs}ms`, {
          errorType: "TimeoutException",
          code: "ETIMEDOUT",
          isNetworkError: true,
          cause: error,
        });
      }
      if (response) {
        throw new KiteApiError("Kite API returned invalid JSON", {
          status: response.status,
          errorType: "DataException",
          cause: error,
        });
      }
      throw new KiteApiError(`Kite API network failure: ${safeErrorMessage(error)}`, {
        errorType: "NetworkException",
        code: error?.code,
        isNetworkError: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function invalidData(message, data) {
  return new KiteApiError(message, { errorType: "DataException", data });
}

function cleanParams(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

function normaliseOrderPlacement(data) {
  const orderIds = [];
  const errors = [];
  const entries = Array.isArray(data) ? data : [data];

  if (entries.length === 0) {
    throw new KiteApiError("Kite order response did not contain any orders", {
      errorType: "DataException",
      data,
    });
  }

  const visit = (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new KiteApiError("Kite order response has an invalid shape", {
        errorType: "DataException",
        data: entry,
      });
    }

    if (typeof entry.order_id === "string" && entry.order_id.length > 0) {
      orderIds.push(entry.order_id);
    }
    if (entry.error && typeof entry.error === "object") {
      errors.push(entry.error);
    }
    if (Array.isArray(entry.children)) {
      for (const child of entry.children) visit(child);
    }

    if (!("order_id" in entry) && !("error" in entry) && !Array.isArray(entry.children)) {
      throw new KiteApiError("Kite order response has an invalid shape", {
        errorType: "DataException",
        data: entry,
      });
    }
  };

  for (const entry of entries) visit(entry);
  return { orderIds: [...new Set(orderIds)], errors };
}

function requiredPathPart(value, name) {
  const stringValue = String(value ?? "").trim();
  if (!stringValue) throw new TypeError(`${name} is required`);
  return encodeURIComponent(stringValue);
}

function requiredValue(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function normaliseThrownError(error) {
  if (error instanceof KiteApiError) return error;
  return new KiteApiError(safeErrorMessage(error), {
    errorType: "NetworkException",
    isNetworkError: true,
    cause: error,
  });
}

function safeErrorMessage(error) {
  return typeof error?.message === "string" && error.message.length > 0
    ? error.message
    : "Unknown error";
}

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
