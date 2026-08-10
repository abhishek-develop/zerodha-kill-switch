import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { KiteApiError, KiteClient } from "../backend/kite-client.js";

const API_KEY = "test-key";
const API_SECRET = "test-secret";
const ACCESS_TOKEN = "test-access-token";
const BASE_URL = "https://kite.test";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(fetchImpl, options = {}) {
  return new KiteClient({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    baseUrl: BASE_URL,
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl,
    retryDelayMs: 0,
    ...options,
  });
}

test("builds the v3 login URL and signs the session checksum without auth", async () => {
  let captured;
  const client = makeClient(async (url, request) => {
    captured = { url, request };
    return jsonResponse({ status: "success", data: { access_token: "new-token", user_id: "AB1234" } });
  });

  assert.equal(
    client.getLoginUrl(),
    "https://kite.zerodha.com/connect/login?v=3&api_key=test-key",
  );

  const session = await client.generateSession("request-token");
  assert.deepEqual(session, { access_token: "new-token", user_id: "AB1234" });
  assert.equal(captured.url, `${BASE_URL}/session/token`);
  assert.equal(captured.request.method, "POST");
  assert.equal(captured.request.headers["X-Kite-Version"], "3");
  assert.equal(captured.request.headers.Authorization, undefined);
  assert.equal(
    captured.request.headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );

  const body = new URLSearchParams(captured.request.body);
  const expectedChecksum = createHash("sha256")
    .update(`${API_KEY}request-token${API_SECRET}`)
    .digest("hex");
  assert.equal(body.get("api_key"), API_KEY);
  assert.equal(body.get("request_token"), "request-token");
  assert.equal(body.get("checksum"), expectedChecksum);
});

test("authenticates signed requests using the current access token", async () => {
  let request;
  const client = makeClient(async (_url, options) => {
    request = options;
    return jsonResponse({ status: "success", data: { net: [], day: [] } });
  });

  assert.deepEqual(await client.getPositions(), { net: [], day: [] });
  assert.equal(request.headers.Authorization, `token ${API_KEY}:${ACCESS_TOKEN}`);
  assert.equal(request.headers["X-Kite-Version"], "3");
});

test("aborts requests at the configured deadline", async () => {
  let calls = 0;
  const signals = [];
  const client = makeClient((_url, request) => {
    calls += 1;
    signals.push(request.signal);
    return new Promise(() => {});
  }, { timeoutMs: 10 });

  await assert.rejects(
    client.getOrders(),
    (error) => {
      assert.ok(error instanceof KiteApiError);
      assert.equal(error.errorType, "TimeoutException");
      assert.equal(error.code, "ETIMEDOUT");
      return true;
    },
  );
  assert.equal(calls, 2, "the idempotent GET gets one retry");
  assert.ok(signals.every((signal) => signal.aborted));
});

test("keeps the deadline active while a response body is stalled", async () => {
  let calls = 0;
  const signals = [];
  const client = makeClient((_url, request) => {
    calls += 1;
    signals.push(request.signal);
    return {
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    };
  }, { timeoutMs: 10 });

  await assert.rejects(
    client.getOrders(),
    (error) => error instanceof KiteApiError && error.errorType === "TimeoutException",
  );
  assert.equal(calls, 2);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("notifies the session owner only for a Kite TokenException", async () => {
  const tokenErrors = [];
  const client = makeClient(
    async () => jsonResponse({
      status: "error",
      message: "Token is invalid or has expired",
      error_type: "TokenException",
      data: null,
    }, 403),
    { onTokenError: (error) => tokenErrors.push(error) },
  );

  await assert.rejects(
    client.getOrders(),
    (error) => {
      assert.ok(error instanceof KiteApiError);
      assert.equal(error.status, 403);
      assert.equal(error.errorType, "TokenException");
      return true;
    },
  );
  assert.equal(tokenErrors.length, 1);
  assert.equal(tokenErrors[0].message, "Token is invalid or has expired");
});

test("does not invalidate the installed session when request-token exchange fails", async () => {
  let tokenErrorCalls = 0;
  const client = makeClient(
    async () => jsonResponse({
      status: "error",
      message: "The request token is invalid or expired",
      error_type: "TokenException",
    }, 403),
    { onTokenError: () => { tokenErrorCalls += 1; } },
  );

  await assert.rejects(
    client.generateSession("expired-request-token"),
    (error) => error instanceof KiteApiError && error.errorType === "TokenException",
  );
  assert.equal(tokenErrorCalls, 0);
});

test("does not treat every HTTP 403 as a token failure", async () => {
  let tokenErrorCalls = 0;
  const client = makeClient(
    async () => jsonResponse({
      status: "error",
      message: "This app cannot access the requested resource",
      error_type: "PermissionException",
    }, 403),
    { onTokenError: () => { tokenErrorCalls += 1; } },
  );

  await assert.rejects(
    client.getGtts(),
    (error) => error instanceof KiteApiError && error.errorType === "PermissionException",
  );
  assert.equal(tokenErrorCalls, 0);
});

test("retries a GET once after a retryable server response", async () => {
  let calls = 0;
  const delays = [];
  const client = makeClient(async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({
        status: "error",
        message: "OMS temporarily unavailable",
        error_type: "NetworkException",
      }, 503);
    }
    return jsonResponse({ status: "success", data: [{ order_id: "ok" }] });
  }, {
    retryDelayMs: 7,
    delayImpl: async (ms) => { delays.push(ms); },
  });

  assert.deepEqual(await client.getOrders(), [{ order_id: "ok" }]);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [7]);
});

test("never retries an order placement POST", async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls += 1;
    return jsonResponse({
      status: "error",
      message: "Gateway unavailable after submission",
      error_type: "NetworkException",
    }, 503);
  });

  await assert.rejects(
    client.placeExit({
      exchange: "NFO",
      tradingsymbol: "NIFTY26AUGFUT",
      product: "MIS",
      quantity: 75,
    }, 75, { marketProtection: -1, tag: "KSGUARD" }),
    (error) => error instanceof KiteApiError && error.status === 503,
  );
  assert.equal(calls, 1);
});

test("places the opposite MARKET exit with DAY validity and autoslicing", async () => {
  let captured;
  const client = makeClient(async (url, request) => {
    captured = { url, request };
    return jsonResponse({ status: "success", data: { order_id: "exit-1" } });
  });

  const result = await client.placeExit({
    exchange: "NFO",
    tradingsymbol: "NIFTY26AUGFUT",
    product: "NRML",
    quantity: -150,
  }, 150, { marketProtection: 5, tag: "KSGUARD" });

  assert.deepEqual(result, { orderIds: ["exit-1"], errors: [] });
  assert.equal(captured.url, `${BASE_URL}/orders/regular`);
  assert.equal(captured.request.method, "POST");
  const body = new URLSearchParams(captured.request.body);
  assert.deepEqual(Object.fromEntries(body), {
    exchange: "NFO",
    tradingsymbol: "NIFTY26AUGFUT",
    transaction_type: "BUY",
    quantity: "150",
    product: "NRML",
    order_type: "MARKET",
    validity: "DAY",
    autoslice: "true",
    market_protection: "5",
    tag: "KSGUARD",
  });
});

test("normalises partially successful autoslice responses", async () => {
  const sliceError = {
    code: 400,
    error_type: "MarginException",
    message: "Insufficient funds for this slice",
    data: null,
  };
  const client = makeClient(async () => jsonResponse({
    status: "success",
    data: [
      { order_id: "slice-1" },
      { error: sliceError },
      { order_id: "slice-3" },
    ],
  }));

  assert.deepEqual(
    await client.placeExit({
      exchange: "NFO",
      tradingsymbol: "BANKNIFTY26AUGFUT",
      product: "MIS",
      quantity: 3_000,
    }, 3_000, { tag: "KSGUARD" }),
    { orderIds: ["slice-1", "slice-3"], errors: [sliceError] },
  );
});

test("calculates charges only from actually filled quantities and prices", async () => {
  let request;
  const client = makeClient(async (_url, options) => {
    request = options;
    return jsonResponse({
      status: "success",
      data: [
        { charges: { total: 12.25 } },
        { charges: { total: 4.75 } },
      ],
    });
  });

  const orders = [
    {
      order_id: "complete",
      status: "COMPLETE",
      exchange: "NSE",
      tradingsymbol: "SBIN",
      transaction_type: "BUY",
      variety: "regular",
      product: "MIS",
      order_type: "MARKET",
      quantity: 10,
      filled_quantity: 10,
      average_price: 600.5,
    },
    {
      order_id: "partial",
      status: "OPEN",
      exchange: "NFO",
      tradingsymbol: "NIFTY26AUGFUT",
      transaction_type: "SELL",
      variety: "regular",
      product: "NRML",
      order_type: "LIMIT",
      quantity: 75,
      filled_quantity: 25,
      average_price: 24_500,
    },
    {
      order_id: "unfilled",
      status: "REJECTED",
      filled_quantity: 0,
      average_price: 0,
    },
  ];

  assert.equal(await client.calculateOrderCharges(orders), 17);
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.body), [
    {
      order_id: "complete",
      exchange: "NSE",
      tradingsymbol: "SBIN",
      transaction_type: "BUY",
      variety: "regular",
      product: "MIS",
      order_type: "MARKET",
      quantity: 10,
      average_price: 600.5,
    },
    {
      order_id: "partial",
      exchange: "NFO",
      tradingsymbol: "NIFTY26AUGFUT",
      transaction_type: "SELL",
      variety: "regular",
      product: "NRML",
      order_type: "LIMIT",
      quantity: 25,
      average_price: 24_500,
    },
  ]);
});

test("returns zero charges without an API call when nothing has filled", async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls += 1;
    return jsonResponse({ status: "success", data: [] });
  });

  assert.equal(await client.calculateOrderCharges([]), 0);
  assert.equal(await client.calculateOrderCharges([
    { status: "OPEN", filled_quantity: 0, average_price: 0 },
  ]), 0);
  assert.equal(calls, 0);
});

test("batches charge estimates to Kite's ten-order request limit", async () => {
  const batchSizes = [];
  const client = makeClient(async (_url, request) => {
    const batch = JSON.parse(request.body);
    batchSizes.push(batch.length);
    return jsonResponse({
      status: "success",
      data: batch.map(() => ({ charges: { total: 1 } })),
    });
  });
  const orders = Array.from({ length: 11 }, (_, index) => ({
    order_id: `filled-${index}`,
    exchange: "NSE",
    tradingsymbol: "SBIN",
    transaction_type: "BUY",
    variety: "regular",
    product: "MIS",
    order_type: "MARKET",
    filled_quantity: 1,
    average_price: 600,
  }));

  assert.equal(await client.calculateOrderCharges(orders), 11);
  assert.deepEqual(batchSizes, [10, 1]);
});

test("rejects malformed successful broker payloads", async () => {
  const client = makeClient(async () => jsonResponse({ status: "success", data: null }));
  await assert.rejects(
    client.getPositions(),
    (error) => error instanceof KiteApiError && error.errorType === "DataException",
  );
});
