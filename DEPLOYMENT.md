# Deployment and Operations

This document treats TradeGuardian as a safety-critical **reactive** service. The preferred deployment is one continuously running process on an always-on local PC with durable disk, process supervision, stable networking, and an independent readiness alert.

## The safety boundary

Zerodha's official Kill Switch disables trading segments in Zerodha's account/Kite interface. Kite Connect does not currently expose that back-office control as a dedicated API. TradeGuardian therefore cannot reject an order before Zerodha accepts it.

After a loss breach, TradeGuardian persistently does the following through normal Kite Connect trading APIs:

- attempts to persist the same-day lock and exit intent before broker mutations;
- requests cancellation of cancellable trader orders and waits for pending states to clear;
- deletes active GTT triggers when configured, without trusting a stale saved GTT snapshot as proof they are clear;
- submits reverse market orders for non-zero protected positions;
- reconciles pending guard orders and submits only uncovered quantities;
- bounds concurrent exit and background cleanup work so broker reconciliation cannot create an unbounded request burst;
- verifies orders and positions before reporting `LOCKED`;
- continues polling and reversing newly detected exposure for the rest of that day.

If a runtime state write fails, the guard marks itself critical but continues emergency flatten attempts from memory. This avoids suppressing an exit because the disk failed, but it means a subsequent process/host crash can lose the in-memory latch. A durable writable store and immediate state-error alert are therefore mandatory.

This leaves unavoidable failure windows. Polling is not instantaneous, and a submitted order is not necessarily filled. Illiquidity, circuits, market protection, closed markets, freezes, authorisation requirements, margin/RMS checks, a stale token, API rate limits, network loss, machine failure, and Zerodha/exchange incidents can all delay or prevent flattening. [Kite's own order documentation](https://kite.trade/docs/connect/v3/orders/) explicitly says successful placement does not imply successful execution.

The same-day API invariants are a behavioural guard, not tamper resistance. A person who controls the host or Zerodha account can still stop the process, remove its network/power, invalidate its access token, alter deployment secrets/state, or trade through a different account or excluded product. Only a broker-side control can reject orders independently of this runtime.

The trigger P&L is also operational rather than an audited ledger figure: it requires the current Kite daily net-position `m2m` snapshot, subtracts estimated charges from filled orders, and applies the configured buffer. A malformed or ambiguous snapshot—including duplicate instrument keys—is rejected and degrades/stales readiness rather than using untrustworthy data. It does not itself trigger an automatic flatten, and an active guard will not build exits or certify clear from ambiguous position data. Data or charge-refresh delays can still make the result differ from the final contract note or Console P&L. Use a conservative limit/buffer and compare it with Kite during staged testing.

Use [Zerodha's official segment Kill Switch](https://support.zerodha.com/category/console/segments/killswitch/articles/what-is-the-kill-switch) when a broker-side segment block is required. Zerodha advises clearing open orders and positions first, and says segment deactivation can take up to five minutes.

## Required production shape

```text
Dashboard browser ──HTTPS/same origin──> one TradeGuardian process ──> Kite API
                                              │
                                              └──> encrypted state on durable disk

Independent watchdog ──> /api/health and /api/readiness ──> operator alert
```

Production requirements:

- **Exactly one guard process and state store per Zerodha account.** Multiple active instances can race and submit duplicate exits. The same-day latch is bound to its Zerodha user ID and rejects switching accounts while active. At startup, a persisted session for another user is invalidated and health becomes critical instead of applying the lock to that account. While unlocked, an account switch is allowed but first resets account-scoped daily P&L, charges/fingerprint, and broker snapshots. Verify the connected user and fresh snapshot. Do not horizontally scale it.
- **Durable, writable state.** The kill latch and token are stored in an encrypted file. The state directory must survive process/host restarts, and write failures must alert immediately.
- **Process supervision.** Use launchd, systemd, Docker restart policy, or the host's equivalent.
- **External readiness monitoring.** Process uptime is not the same as active protection.
- **Stable power and networking.** Prevent sleep during trading hours; use a UPS and backup connection if the risk justifies it.
- **Correct system time.** Keep network time synchronisation enabled. Latch/rollover decisions use the Asia/Kolkata calendar date; the app does not consult an exchange holiday calendar, and an inaccurate host clock is dangerous.
- **Operator fallback.** Keep Kite access on another device and know how to cancel/flatten and apply Zerodha's official Kill Switch manually.

## Environment variables

Start with `.env.example`. The server loads `.env` from the repository working directory.

This Next.js 16 project requires Node.js 20.9.0 or newer. The provided Docker image uses Node.js 22.

| Variable | Required/default | Purpose |
| --- | --- | --- |
| `APP_PASSWORD` | required, 10+ characters | Password for the dashboard/API session. Use a unique, high-entropy value. |
| `APP_SECRET` | required, 32+ characters | Encrypts/authenticates guard state and signs login cookies. Never rotate it without a planned state migration. |
| `KITE_API_KEY` | required | Kite Connect app API key; server-side only. |
| `KITE_API_SECRET` | required | Kite Connect app secret; server-side only. Never use a `NEXT_PUBLIC_` variable for it. |
| `KITE_REDIRECT_URL` | `http://localhost:$PORT/` | Exact URL registered for the Kite Connect app. Use HTTPS in hosted production. |
| `KITE_BASE_URL` | `https://api.kite.trade` | Kite API base. Do not change for live use. |
| `PORT` | `3000` | HTTP listening port. |
| `HOST` | `127.0.0.1` | Listen address. Keep loopback for local use; set `0.0.0.0` only inside a container or trusted hosted platform. |
| `APP_ORIGIN` | same-origin accepted automatically | Comma-separated exact browser origins. `*` is rejected. Set the production HTTPS origin explicitly. |
| `COOKIE_SECURE` | true in production/with HTTPS redirect | Requires HTTPS before the authentication cookie is sent. Use `false` only for local HTTP. |
| `TRUST_PROXY` | `false` | Trusts the proxy-provided client IP for login rate limiting. Enable only when directly behind a trusted reverse proxy such as Render; leave false on a directly exposed/local process. |
| `AUTH_COOKIE_NAME` | `tradeguardian_session` | Application login cookie name. |
| `AUTH_TTL_MS` | `43200000` (12 hours) | Application login lifetime; accepted range is 1 minute to 7 days. |
| `ALERT_WEBHOOK_URL` | optional | HTTPS JSON webhook for kill activation, critical failures, recovery, and verified-flat events. The body contains `text` and structured `event` fields. This complements, but does not replace, an external readiness monitor. |
| `ALERT_WEBHOOK_TIMEOUT_MS` | `3000` | Non-blocking alert delivery deadline; accepted range 500–15000 ms. |
| `STATE_FILE` | `.data/state.json` | Encrypted state path. The historical `.json` name is retained for in-place migration; its parent must be durable and writable by the service user. |
| `MAX_LOSS` | `10000` | Positive INR loss magnitude. The guard trips when adjusted P&L is less than or equal to its negative. |
| `PNL_POLL_MS` | `2000` | Armed-state risk polling interval; accepted range 1000–60000 ms. |
| `GUARD_POLL_MS` | `1000` | Tripped-state reconciliation interval; accepted range 750–30000 ms. |
| `MARKET_PROTECTION` | `-1` | Kite market protection: `-1` automatic, `0` disabled, or an integer percentage 1–100. Protection can turn a market order into a limit order, so it can remain unfilled. |
| `FLATTEN_PRODUCTS` | `ALL` | `ALL` reverses every non-zero Kite position, matching the normal safety policy. Advanced users can provide Kite products (`MIS`, `NRML`, `CNC`, `MTF`, `CO`, `BO`) to deliberately exclude exposure. |
| `CANCEL_GTT_ON_KILL` | `true` | Deletes active GTT triggers during reconciliation. |
| `CHARGE_BUFFER` | `0` | Additional INR safety reserve subtracted from adjusted P&L. This effectively makes the trigger more conservative. |
| `KITE_REQUEST_TIMEOUT_MS` | `5000` | Kite request deadline; accepted range 1000–30000 ms. |
| `EXIT_ORDER_MAX_AGE_MS` | `15000` | Grace/age window used before replacing uncertain or stale guard exits; accepted range 5000–120000 ms. |
| `SETTLEMENT_GRACE_MS` | `4000` | Wait after a terminal order observation before another exit decision; accepted range 1000–30000 ms. |

Generate `APP_SECRET` once:

```bash
openssl rand -base64 48
```

Store the result in a password manager or secret manager and in `.env`/the host secret store. Do not commit `.env`. On a local machine, restrict it to the service user:

```bash
chmod 600 .env
```

`APP_PASSWORD` and `APP_SECRET` serve different purposes and should not be the same value.

### Product-scope warning

The application, `.env.example`, and `render.yaml` all default to `ALL`, because the requested policy is to flatten every open position returned by Kite. This can include `NRML` overnight derivatives as well as `CNC` or `MTF` positions. The engine acts on the Kite positions response, not the separate holdings book. Confirm that consequence before the first live session.

Narrow product lists are an advanced opt-out from all-position protection. The trigger P&L still includes all net positions returned by Kite, but reversal is restricted to the configured list. An excluded product can therefore contribute to a breach and remain open. `LOCKED`/`verifiedFlat` certifies only the protected product scope and pending-order checks; it additionally requires active GTTs clear in a fresh broker snapshot only when `CANCEL_GTT_ON_KILL=true`. A stale persisted GTT view cannot satisfy that check. It does not certify the separate holdings book or excluded positions.

## Recommended: always-on local PC

### Install and build

```bash
npm ci
cp .env.example .env
npm run check
npm start
```

Set both `KITE_REDIRECT_URL` and the Kite developer-console redirect to `http://localhost:3000/`. Set `APP_ORIGIN=http://localhost:3000` and `COOKIE_SECURE=false` only for local HTTP.

The production start command serves the exported UI and `/api/*` from one Node process. Keep the UI and backend on the same origin; the authentication cookie is `SameSite=Strict`, and a separate unrelated frontend origin is intentionally not a supported production topology.

Do not use `npm run dev` as the always-on trading service. Development mode is useful for editing but is not a supervised, immutable production runtime.

### macOS launchd

The repository contains `ops/com.tradeguardian.guard.plist.example`.

1. Run `command -v node` and replace `/absolute/path/to/node` in the plist.
2. Replace every repository/log placeholder with a real absolute path. Create the restricted log directory and arrange log rotation so it cannot fill the state disk.
3. Create `.data`, build the UI, and confirm a foreground `npm start` works.
4. Copy the edited plist to `~/Library/LaunchAgents/com.tradeguardian.guard.plist`.
5. Validate and load it:

```bash
plutil -lint ~/Library/LaunchAgents/com.tradeguardian.guard.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tradeguardian.guard.plist
launchctl kickstart -k gui/$(id -u)/com.tradeguardian.guard
```

The example reads secrets through the repository `.env`; it does not copy them into the plist. `KeepAlive` restarts a crashed process, but it cannot restore power, internet, a valid Kite token, or a corrupt state file. Monitor readiness separately.

### Linux systemd

`ops/tradeguardian.service.example` assumes the app is installed at `/opt/tradeguardian`, owned by a dedicated `tradeguardian` user, with writable state under `/opt/tradeguardian/.data`. Adjust paths and the Node binary, then:

```bash
sudo cp ops/tradeguardian.service.example /etc/systemd/system/tradeguardian.service
sudo systemctl daemon-reload
sudo systemctl enable --now tradeguardian
sudo systemctl status tradeguardian
```

Build and test before starting the restricted service. The sample's filesystem hardening permits writes only to `.data`.

## Docker

The Dockerfile builds the static UI in one stage and runs the dependency-free Node backend as a non-root user. It deliberately copies explicit build inputs, not `.env`.

Build and run with a persistent volume:

```bash
docker build -t tradeguardian:local .
docker volume create tradeguardian-state
docker run -d \
  --name tradeguardian \
  --restart unless-stopped \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -p 127.0.0.1:3000:3000 \
  -v tradeguardian-state:/app/.data \
  tradeguardian:local
```

Binding to `127.0.0.1` avoids exposing local HTTP to the LAN. Use a TLS reverse proxy if remote access is necessary. A bind-mounted host directory can replace the named volume when direct, offline backup access is preferred.

Never run the container without `/app/.data` on persistent storage. Recreating a container with ephemeral state can discard the same-day latch.

## Render: paid service only

Do not use Render Free for live protection. Render's [Free instance documentation](https://render.com/docs/free) says:

- a Free web service spins down after 15 minutes without inbound HTTP or WebSocket traffic;
- waking it takes about one minute;
- filesystem changes are lost on spin-down, restart, and redeploy;
- Free web services cannot attach persistent disks and may be restarted at any time;
- Render explicitly says Free instances should not be used for production applications.

Pinging a Free service is not a safety design. It does not fix arbitrary restarts, usage suspension, ephemeral state, network failure, or the lack of a broker-side order block.

The included `render.yaml` instead declares:

- a paid `starter` web service;
- a 1 GB persistent disk mounted at `/opt/render/project/src/.data`;
- `STATE_FILE` inside that mount;
- manual deploys (`autoDeployTrigger: off`);
- a liveness health check;
- no checked-in secrets.

Deployment steps:

1. Push the repository to a private remote and create a Render Blueprint.
2. Review/change the declared region before creation if needed.
3. Generate and securely record `APP_SECRET`, then set it together with `APP_PASSWORD`, `KITE_API_KEY`, `KITE_API_SECRET`, `KITE_REDIRECT_URL`, and `APP_ORIGIN` in Render.
4. Use the final HTTPS service URL exactly, for example:

   ```text
   KITE_REDIRECT_URL=https://tradeguardian.example.com/
   APP_ORIGIN=https://tradeguardian.example.com
   ```

5. Register the same redirect URL in the Kite developer console.
6. Confirm the separately recorded `APP_SECRET` matches the deployed value. The encrypted state cannot be recovered without it.
7. Deploy outside market hours, sign in, complete Kite login, and verify readiness.
8. Configure an independent HTTPS monitor for `/api/readiness` during the trading window.

Only files below the disk mount survive. [Render's persistent-disk documentation](https://render.com/docs/disks) also notes that disks attach to one service instance and prevent zero-downtime deploys. That single-instance property suits this guard, but it means deployments introduce downtime: keep automatic deploys off and deploy only when there is no exposure and protection is not needed.

A newly attached disk is empty. When moving an existing guard, first stop trading and verify the broker account flat, stop the old instance, then transfer the matched `state.json`/`.initialized` pair and keep the identical `APP_SECRET`. Never run old and new instances concurrently. If the old free/ephemeral state has already disappeared, treat the latch as unknown and establish broker-side safety before deliberately initialising the new store.

The current build supports its encrypted filesystem store. An external durable database/state service is a possible future alternative, but it requires a deliberately implemented atomic state-store adapter and single-leader enforcement; merely setting a database URL does nothing. Whether using disk or an external store, retain an external watchdog.

## Authentication and network security

- Serve hosted deployments only through HTTPS and set `COOKIE_SECURE=true`.
- Set `APP_ORIGIN` to exact trusted HTTPS origins. Wildcard CORS is rejected.
- Keep the UI and API on the same origin unless you intentionally redesign the strict-cookie authentication model.
- Never expose `KITE_API_SECRET`, `APP_SECRET`, or the access token in frontend files, build variables prefixed `NEXT_PUBLIC_`, logs, screenshots, or support tickets.
- Protect `.env`, state backups, and the persistent disk. The state includes the Kite session token even though it is encrypted at rest.
- Use a private repository and limit host/Render account access with MFA.
- Do not expose local port 3000 beyond the loopback interface without an authenticated TLS reverse proxy and firewall controls.
- Application logout clears only the dashboard cookie; an already active guard continues. Kite session logout is a separate operation and is refused while the same-day lock is active.

## Daily Kite login lifecycle

Kite's [authentication documentation](https://kite.trade/docs/connect/v3/user/) states that:

- the redirect `request_token` lasts only a few minutes and should be exchanged immediately;
- the resulting access token expires at 6:00 AM the next day unless invalidated earlier;
- a Kite master logout can invalidate it early;
- API secrets and access tokens must not be exposed publicly.

There is no normal long-lived refresh token for an individual app. Complete the interactive Kite login each trading day before relying on the guard.

Recommended pre-market routine:

1. Check the host is awake, online, time-synchronised, and supervised.
2. Confirm `GET /api/health` returns 200.
3. Log into TradeGuardian with `APP_PASSWORD`.
4. Select **Connect Kite** and complete Zerodha authentication.
5. Confirm the dashboard shows Connected, Monitoring, and Healthy.
6. Refresh the snapshot and compare P&L/positions with Kite.
7. Confirm `GET /api/readiness` returns 200.
8. Review the daily limit, charge buffer, protected products, GTT behaviour, and emergency manual procedure.

If the previous day's latch remains active, connecting the new Kite session first lets the guard reconcile it. Only after the old India date has passed and the configured position/order/GTT scope is verified clear can **Arm next day** clear the prior latch.

Saving settings while unlocked does not create a grace period. When the guard is connected and monitoring, it immediately refreshes and evaluates P&L; lowering `MAX_LOSS` or increasing `CHARGE_BUFFER` can latch and start live exit work during the save request. Prefer deliberate settings changes while the account is flat.

## Liveness, readiness, and alerts

`GET /api/health` returns process/configuration liveness. It deliberately returns HTTP 200 even when the guard has no usable Kite session or state recovery failed. Use it for Docker/host process checks, not as proof of protection.

`GET /api/readiness` returns:

- HTTP 200 only when the Kite session is usable, monitoring or kill enforcement is active, the relevant polling loop is fresh, and health is `HEALTHY`;
- HTTP 503 when health is `DEGRADED` or `CRITICAL`, or protection is disconnected, stale, or unconfigured.

Both routes are unauthenticated and reveal limited operational status so a watchdog can use them. Account state and mutations remain authenticated.

`DEGRADED` is intentionally not ready and returns HTTP 503. Parse the response body as well as the HTTP code so alerts explain whether the failure is degraded health, critical health, disconnection, staleness, or missing configuration.

Configure an independent monitor to check readiness at least once per minute during the trading window and alert by a channel that does not depend on this host. Overnight 503 responses may be expected after the Kite token expires; require both HTTP 200 and `status: HEALTHY` before any order is placed. Do not configure an automatic restart loop solely on readiness failures—a missing daily token or state recovery problem requires operator action.

With the default loopback binding, a second device cannot call the endpoint directly. Either have a supervised local checker send a heartbeat to an external dead-man monitor, or deliberately bind the service to a private interface and restrict access with a LAN firewall/private VPN. The local-checker design still needs an independent host-down signal. Do not make port 3000 publicly reachable over plain HTTP merely to enable monitoring.

Also alert on:

- a process restart during market hours;
- state/disk capacity or mount failure;
- repeated `DEGRADED`/`CRITICAL` status;
- exit rejection, uncertainty, or unresolved exposure;
- host power, sleep, or internet loss.

## State, backup, and fail-closed recovery

`STATE_FILE` is an AES-256-GCM authenticated-encryption envelope written atomically. The store also creates a marker beside it:

```text
.data/state.json
.data/state.json.initialized
```

Despite the historical filename, `state.json` contains an encrypted envelope after initialisation. The state contains the kill latch, daily settings/snapshots, reconciliation attempts, action history, and Kite access token. File permissions are restricted, but backups remain sensitive.

An existing pre-encryption plaintext JSON object at this path is migrated in place on first load, but only when no initialisation marker exists. Back up the old file before that first upgraded start. After migration, never delete `.data/state.json.initialized` independently; the marker is part of the fail-closed recovery contract.

On first-ever startup, absence of both files creates fresh state. After initialisation, a missing state file, malformed/corrupt ciphertext, wrong `APP_SECRET`, or failed authentication causes state recovery to fail. The engine does **not** silently create a fresh unlocked state. `/api/readiness` remains 503. This is intentional fail-closed **startup recovery** behaviour.

Runtime write failure has a different tradeoff: broker exit attempts continue from memory while health becomes critical. If the process then dies before a successful write, recovery can only load the last durable state. Never ignore a state-write alert, even if the broker position appears to be flattening.

### Backup

1. Schedule backups outside market hours and only after verifying the account flat.
2. Stop the process cleanly so the two files form a consistent pair.
3. Back up both the state file and its `.initialized` marker together.
4. Keep the matching `APP_SECRET` in a separate secret manager/password manager.
5. Encrypt backups and restrict their access; they contain a Kite token and trading history.
6. Restart the service and verify health, then verify readiness after completing any required Kite login.
7. Periodically test restoration in an isolated copy that cannot call the live Kite API.

Render persistent disks receive platform snapshots, but a snapshot restore loses changes made after that snapshot. Keep an independent record of `APP_SECRET` and understand the snapshot's recovery point.

### Recovery

If recovery fails:

1. Treat protection as unavailable. Do not trade.
2. Inspect Kite from a separate device; cancel open orders, flatten positions as necessary, and apply Zerodha's official Kill Switch.
3. Stop the TradeGuardian process.
4. Preserve the failed state and marker for diagnosis.
5. Restore a matched state/marker backup and the exact original `APP_SECRET`.
6. Restart, complete Kite login if required, and verify the latch and account state before re-enabling trading.

Do not “fix” recovery by deleting the marker or changing `STATE_FILE` during a trading session. If no backup exists, establish broker-side safety and verify the entire account flat first. Only then, outside market hours, may an operator archive both old files and initialise a deliberately fresh installation. That emergency action discards the persisted latch and audit history.

## Safe upgrades

Do not redeploy or rebuild the live guard while it is responsible for exposure. Schedule upgrades outside market hours, verify positions/orders/GTTs directly in Kite, and establish broker-side safety first. Then:

1. Back up the matched state/marker files and confirm the `APP_SECRET` recovery copy.
2. Run `npm ci` and `npm run check` against the new code. The aggregate check includes the production build/export.
3. Stop the old supervised process and ensure no second instance remains.
4. Start the new process with the same state path and secret.
5. Inspect `/api/health`, logs, and migrated state.
6. Complete the next required Kite login and require `/api/readiness` to return HTTP 200 with `status: HEALTHY` before trading.

Rollback must preserve the state written by the newest process unless that older code cannot read it. Never roll back by restoring an older unlocked snapshot while a newer same-day latch may have been activated; use broker-side safety and reconcile the state deliberately.

## Verification and shadow-live checklist

There is no live dry-run mode. Any manual kill with real positions can place real orders and generate slippage, brokerage, fees, and taxes. Move through these stages in order.

### Stage 1 — automated and build checks

```bash
npm run check
```

The automated suite uses fake broker responses. It should cover encrypted/atomic state, fail-closed recovery, token and retry handling, account-scoped resets, daily P&L, immediate evaluation of tighter settings, latch-before-exit ordering, order cancellation, uncovered-quantity growth and sign flips, duplicate position-key rejection, fresh-GTT verification, same-day account invariants, `DEGRADED` readiness, and re-flattening after `LOCKED`.

### Stage 2 — configuration and access checks

- Start with no live Kite session and confirm `/api/health` is 200 while `/api/readiness` is 503.
- Confirm a wrong application password is rejected and repeated failures are rate-limited.
- Confirm the valid password produces an HttpOnly, SameSite=Strict cookie.
- Confirm an untrusted browser `Origin` cannot perform API mutations.
- Confirm no secret or access token appears in `/api/status`, browser storage, page source, or logs.
- Restart the process and verify the encrypted state loads with the same `APP_SECRET`.
- In an isolated copy, verify a wrong secret or corrupt/missing initialised state produces readiness 503 rather than a new unlocked state.

### Stage 3 — zero-exposure live connection drill

- Use the real Kite account only when positions and pending orders are zero. Remove or explicitly account for active GTTs because the default kill action deletes them.
- Complete the daily Kite login and compare the dashboard snapshot with Kite.
- Activate manual kill while flat. Confirm the persisted phase progresses to `LOCKED` with `verifiedFlat=true` and no exit order is placed.
- Confirm stop monitoring, settings changes, Kite disconnect, and same-day reset are rejected while latched.
- Restart the process and confirm the same-day latch survives and reconciliation resumes.
- On the following day, reconnect Kite, confirm flatness, and exercise **Arm next day**.

### Stage 4 — shadow monitoring

- Choose a deliberately unreachable test loss threshold for the account and keep `CHARGE_BUFFER` understood. This reduces, but does not eliminate, the chance of a real automatic trigger.
- Monitor for several sessions without intentional exposure changes from the guard.
- Compare adjusted P&L, positions, orders, charge estimates, and timestamps with Kite throughout the day.
- Verify readiness remains HTTP 200 with `status: HEALTHY` while the dashboard is closed; browser polling must not be required for backend protection.
- Verify the process survives a normal supervised restart while there is no exposure.
- Test network/API-failure alerts only while the account is flat.

### Stage 5 — controlled live flatten drill (optional and real)

Only proceed if you accept real execution risk and costs. Use the smallest permissible quantity in a liquid instrument and a product included in `FLATTEN_PRODUCTS`, during normal market hours, with Kite open on a second device.

- Create one small position and activate manual kill.
- Verify the latch and exit intent are durably written before cancel/exit actions under normal storage conditions.
- Verify the reverse order uses the same exchange, symbol, and product, is tagged `KSGUARD`, and has the correct side/quantity.
- Verify the order actually reaches `COMPLETE` and the position reaches zero; an order ID alone is not success.
- Confirm `LOCKED` appears only after the protected broker position is zero and pending orders/GTTs are clear.
- Optionally, with the same emergency precautions, open one new minimum-size protected position after `LOCKED` and measure detection/flattening. This intentionally creates real exposure and is not an order-block test.
- Stop immediately and flatten manually if quantities grow, an exit duplicates, readiness fails, or state becomes `DEGRADED`.

Record observed worst-case detection and flatten times. They are properties of that test under those market/network conditions, not guarantees for future sessions.

## Incident runbook

### Readiness is 503 or health is critical

1. Stop placing trades.
2. Inspect positions, open orders, GTTs, and fills directly in Kite.
3. Manually cancel/flatten as needed; do not assume a submitted guard order filled.
4. Apply Zerodha's official Kill Switch if a segment-level block is needed.
5. Restore power/network/process or complete a fresh Kite login.
6. Do not resume until TradeGuardian and Kite agree and readiness is HTTP 200 with `status: HEALTHY`.

### Exit is rejected, partial, stale, or uncertain

Review all `KSGUARD` orders and their filled/pending quantities in Kite before placing another manual exit. The guard deliberately waits around uncertain requests to reduce duplicates, but it cannot eliminate ambiguity after a timeout. That grace reserves only the same-direction quantity previously attempted: added exposure remains uncovered, and a sign flip causes a new reverse attempt in the new direction. Manual orders can therefore race the guard. Use the broker order book as the source of truth and flatten the **remaining** net quantity.

### Kite token becomes invalid

A token error marks the guard critical and stops useful API protection. Complete the interactive Kite login again. If the same-day latch is active, the new session retains that latch and reconciliation should resume; confirm this in the dashboard and Kite.

### Connected account does not match an active lock

Startup invalidates a persisted Kite session whose user ID differs from the account-bound same-day lock; health becomes `CRITICAL` and readiness returns 503. Do not delete state or connect an unrelated account to bypass the latch. Reconnect the locked account, confirm its user ID and broker exposure, and verify `HEALTHY` readiness before relying on protection. A deliberate account switch is supported only while unlocked and resets account-scoped daily metrics and broker snapshots before polling the new account.

### Host or service restarts during a lock

The supervisor should restart the single process. With the durable state and original `APP_SECRET`, startup retains the active latch and immediately resumes the guard loop while the saved Kite session remains usable. Confirm readiness and broker state; do not infer success from process liveness.

If a state-write error preceded the restart, assume the last latch/action might not have reached disk. Establish broker-side safety and inspect the persisted action history plus Kite before trusting recovery.

## Official sources

- [Zerodha Support: What is Kill Switch?](https://support.zerodha.com/category/console/segments/killswitch/articles/what-is-the-kill-switch)
- [Kite Connect developer forum: dedicated Kill Switch API is not available](https://kite.trade/forum/discussion/15829/kill-switch-api-not-available)
- [Kite Connect user/login documentation](https://kite.trade/docs/connect/v3/user/)
- [Kite Connect orders documentation](https://kite.trade/docs/connect/v3/orders/)
- [Kite Connect GTT documentation](https://kite.trade/docs/connect/v3/gtt/)
- [Kite Connect order postbacks/WebSocket guidance](https://kite.trade/docs/connect/v3/postbacks/)
- [Render Free instance limitations](https://render.com/docs/free)
- [Render persistent disk behaviour and limitations](https://render.com/docs/disks)
