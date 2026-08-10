# TradeGuardian

TradeGuardian is a personal, reactive daily-loss guard for Zerodha Kite Connect. It watches the account's daily position P&L and, after the configured loss limit is crossed, persistently works to cancel pending exposure and flatten protected positions for the rest of the trading day.

> **This is not Zerodha's broker-level Kill Switch.** Kite Connect does not expose an API that rejects every future order at the broker. TradeGuardian can only detect and react. A new order placed in Kite may create exposure for roughly a polling interval—or longer during API, network, exchange, or execution problems—before the guard cancels or reverses it.

Do not treat this app as a guarantee of profitability, a stop-loss, or a substitute for Zerodha's official segment Kill Switch. Test it carefully before allowing it to place live orders.

## What happens when the limit is breached

The loss calculation requires Kite's daily net-position `m2m` values, then subtracts estimated order charges and the configured charge buffer. A malformed or ambiguous snapshot—including an invalid `m2m` value or duplicate net-position instrument key—is rejected and degrades/stales readiness instead of being treated as trustworthy P&L. It does not itself trigger an automatic flatten, and the guard will not construct exits or certify clear from ambiguous position data. This is a best-effort intraday trigger, not the final contract-note or Console ledger P&L, and broker data or charge estimates can be delayed or incomplete. When `total <= -MAX_LOSS`, the guard:

1. Attempts to save the same-day kill latch to encrypted durable state **before** sending any broker request.
2. Reads the order book and net positions together.
3. Prioritises reverse `MARKET` orders, with autoslicing, for uncovered quantities in `FLATTEN_PRODUCTS`.
4. Starts tracked, bounded-concurrency cleanup to cancel cancellable non-guard orders and delete active GTT triggers when `CANCEL_GTT_ON_KILL=true`; remaining pending states prevent verification.
5. Re-reads orders and positions and reports `LOCKED` only after the protected account state is verified clear. A stale saved GTT snapshot cannot verify this state.
6. Keeps polling after verification. If a trader opens a new protected position later that day, it attempts to flatten that exposure too.

If a runtime state write fails, the engine marks health `CRITICAL` but continues attempting to flatten from memory rather than withholding an emergency exit. Until persistence recovers, a process/host crash can lose that in-memory latch. Treat any state error as an incident and establish broker-side safety immediately.

Guard exit orders are tagged `KSGUARD`. Reconciliation preserves valid pending guard exits and sends only the uncovered quantity, reducing duplicate-order risk. An exit grace window reserves at most the same-direction quantity already attempted: increased exposure remains uncovered, and a position that flips direction is exited immediately in its new direction. Order submission still does not guarantee an exchange fill; the UI and `/api/readiness` must be monitored.

The same-day latch is bound to the Zerodha user ID and cannot be reset from the API or moved to a different account. A persisted Kite session that does not match an active lock is invalidated at startup and protection becomes critical until the locked account reconnects. While the latch is active, risk settings cannot be changed and monitoring or the Kite session cannot be stopped through the app. On a later India calendar date, the guard can be re-armed only after its configured position/order/GTT scope is verified clear.

While unlocked, connecting a different Zerodha account is allowed, but the guard first resets the prior account's daily P&L, estimated charges, charge fingerprint, and position/order/GTT snapshots. Verify the new account identity and its fresh snapshot before trading. This is not tamper-proof: someone who controls the PC or Zerodha account can still terminate the process, cut its network, invalidate the token, or trade an excluded product/account.

## Recommended runtime

Run the built app on an always-on local PC with stable power, internet, and durable disk. Use an OS service manager so the process restarts after a crash or reboot, and use a separate watchdog to alert on `/api/readiness` failures.

Render Free is unsuitable for live protection. Render documents that Free web services spin down after 15 minutes without inbound traffic, take about a minute to wake, lose filesystem changes on spin-down/restart/redeploy, and cannot attach a persistent disk. The included Render blueprint therefore uses a paid service and persistent disk. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the production checklist.

## Local setup

Requirements:

- Node.js 20.9.0 or newer, as required by this Next.js 16 build (Node.js 22 is used by the container)
- a Zerodha Kite Connect app and its API key/secret
- a machine that stays awake and connected throughout the trading session

Install and configure:

```bash
npm ci
cp .env.example .env
openssl rand -base64 48
```

Put the generated value in `APP_SECRET`, choose a unique `APP_PASSWORD`, and add the Kite credentials to `.env`. Keep `APP_SECRET` stable: it encrypts the saved guard state, so rotating or losing it makes that state unreadable.

Register this exact redirect URL in the Kite developer console for local use:

```text
http://localhost:3000/
```

For development:

```bash
npm run dev
```

Development mode orchestrates the Next UI at `http://localhost:3000` and the backend API at `http://localhost:3001`. The UI is configured to call that API; the Kite redirect remains the UI URL on port 3000.

For the production-style local process:

```bash
npm run build
npm start
```

Open `http://localhost:3000`, sign in with `APP_PASSWORD`, and select **Connect Kite**. The UI reads the short-lived `request_token` from Zerodha's redirect and exchanges it on the backend; neither the Kite API secret nor access token is exposed to browser JavaScript.

Command summary:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the development UI on 3000 and backend on 3001. |
| `npm run build` | Build and statically export the Next.js UI to `out/`. |
| `npm start` | Run the production backend on `PORT` and serve `out/`. |
| `npm run server` | Alias for running the backend directly. |
| `npm test` | Run the Node test suite with fake broker/state dependencies. |
| `npm run typecheck` | Run TypeScript checking without emitting files. |
| `npm run lint` | Run ESLint across the project. |
| `npm run check` | Run backend syntax checks, TypeScript, tests, ESLint, and the production Next build/export. |

## Daily operating routine

Kite access tokens normally expire at 6:00 AM the next day unless they are invalidated earlier. Before placing the first trade each day:

1. Confirm the computer, process, internet connection, and external watchdog are running.
2. Open the dashboard and complete the Kite login for the day.
3. Confirm **Connected**, **Monitoring**, and **Healthy**, then refresh the snapshot.
4. Review `MAX_LOSS`, protected products, estimated charges, and the charge buffer.
5. Check that `/api/readiness` returns HTTP 200. `/api/health` alone is not enough.

If the guard becomes `DEGRADED` or readiness fails while exposure exists, immediately inspect Kite, cancel/flatten manually as needed, and use Zerodha's official segment Kill Switch when appropriate.

While unlocked, saving tighter settings on a connected, monitoring guard immediately refreshes and evaluates the account. Lowering `MAX_LOSS` or increasing `CHARGE_BUFFER` can therefore activate the lock and place exits immediately; make deliberate risk changes while flat whenever possible.

## Product scope matters

`.env.example` starts with:

```text
FLATTEN_PRODUCTS=ALL
```

This matches the requested policy: reverse every non-zero position returned by Kite, including products such as `MIS`, `NRML`, `CNC`, and `MTF`. Review that consequence carefully—`NRML` can include overnight derivatives, and the guard can reverse any product present in the positions response. The engine acts on Kite **positions**, not the separate holdings book.

Advanced users can narrow `FLATTEN_PRODUCTS`, but that intentionally weakens the all-position policy: an excluded product can contribute to the loss breach and remain open. `LOCKED`/`verifiedFlat` always means the configured product scope and pending-order checks are clear; active GTTs are also required clear from a fresh broker snapshot only when `CANCEL_GTT_ON_KILL=true`. It does not certify the separate holdings book or deliberately excluded positions.

## Health endpoints

- `GET /api/health` — process liveness and configuration status. It may return 200 even when live protection is unavailable.
- `GET /api/readiness` — HTTP 200 only when the Kite session is usable, monitoring/kill enforcement is active, the relevant loop is fresh, and health is `HEALTHY`. It returns HTTP 503 for `DEGRADED`, `CRITICAL`, disconnected, stale, or unconfigured protection.

Both endpoints are intentionally unauthenticated so a local or external watchdog can call them. All state-changing and account-detail API routes require the signed, HttpOnly application session cookie.

Any `DEGRADED` state makes readiness return HTTP 503. Still inspect the returned `status` and dashboard alerts because they explain the failure; the daily operating target is `HEALTHY`.

## Verify before live use

```bash
npm run check
```

Then follow the staged shadow/live drill in [DEPLOYMENT.md](./DEPLOYMENT.md#verification-and-shadow-live-checklist). There is no dry-run switch in the live backend: pressing manual kill while positions exist can place real orders.

## Official references

- [Zerodha's official segment Kill Switch](https://support.zerodha.com/category/console/segments/killswitch/articles/what-is-the-kill-switch)
- [Kite Connect forum: no dedicated Kill Switch API](https://kite.trade/forum/discussion/15829/kill-switch-api-not-available)
- [Kite order lifecycle and execution caveats](https://kite.trade/docs/connect/v3/orders/)
- [Kite login and access-token lifecycle](https://kite.trade/docs/connect/v3/user/)
- [Render Free limitations](https://render.com/docs/free)
- [Render persistent disks](https://render.com/docs/disks)
