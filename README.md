# Zerodha Kill Switch Guard

A personal risk-management app for Zerodha Kite. It monitors account P&L, activates a kill state when the configured loss is breached, cancels pending orders, squares off open positions, and keeps enforcing the kill state by cancelling or flattening any new exposure detected later in the day.

## Important

This app does not toggle Zerodha's official broker-level kill switch. It uses Kite Connect APIs to enforce a practical guard:

- cancel open/pending orders
- place reverse market orders to flatten positions
- keep watching orders and positions while kill state is active

There can still be a small execution window between a new manual order and the guard detecting it.

## Run Locally

```bash
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

Configure your Kite app redirect URL to the same URL you use for the frontend. After Zerodha redirects back with `request_token`, paste or keep the token in the login form and connect.

By default, the guard only auto-flattens `MIS` and `NRML` positions. This avoids accidentally selling long-term `CNC` holdings. Change `FLATTEN_PRODUCTS` only if you really want broader flattening.

## Deployment Shape

- Frontend: can be hosted on GitHub Pages, or served by this Node app.
- Backend: deploy this repo to Render, Railway, Fly.io, or another Node host.
- Secrets: set `KITE_API_KEY` and `KITE_API_SECRET` only on the backend host.

If hosting the frontend separately, set `window.KILL_SWITCH_API_BASE` before loading `app.js`, or edit `frontend/app.js` to point at your backend URL.
