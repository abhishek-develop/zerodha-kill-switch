# Deployment

## Recommended First Deployment

Deploy the backend and UI together as one Node web service. This is simpler and avoids CORS issues:

```text
https://your-app-host/
  serves frontend UI
  serves backend API under /api/*
```

Use Render, Railway, Fly.io, or any Node host. The included `render.yaml` and `Dockerfile` are enough for common hosts.

## Required Environment Variables

Set these on the backend host:

```bash
KITE_API_KEY=your_kite_api_key
KITE_API_SECRET=your_kite_api_secret
KITE_REDIRECT_URL=https://your-deployed-app-url/
APP_ORIGIN=https://your-deployed-app-url
MAX_LOSS=10000
PNL_POLL_MS=5000
GUARD_POLL_MS=1500
MARKET_PROTECTION=5
FLATTEN_PRODUCTS=MIS,NRML
STATE_FILE=.data/state.json
```

Then set the same redirect URL in the Kite developer console.

## Render

1. Push this repo to GitHub.
2. In Render, create a new Web Service from that repo.
3. Use:

```text
Build command: empty
Start command: node backend/server.js
```

4. Add the environment variables above.
5. Deploy.
6. Update `KITE_REDIRECT_URL` and `APP_ORIGIN` to the final Render URL, then redeploy.

## Railway

1. Push this repo to GitHub.
2. Create a Railway project from the repo.
3. Railway should detect Node.
4. Set the environment variables above.
5. Use this start command:

```bash
node backend/server.js
```

## Docker Hosts

Build and run:

```bash
docker build -t zerodha-kill-switch .
docker run --env-file .env -p 3000:3000 zerodha-kill-switch
```

## GitHub Pages UI Separately

You can host `frontend/` on GitHub Pages and backend elsewhere, but then set the backend URL before `app.js` loads:

```html
<script>
  window.KILL_SWITCH_API_BASE = "https://your-backend-url";
</script>
<script src="./app.js"></script>
```

For the first version, serving UI and API together is better.

## Important Production Notes

- Use HTTPS in production.
- Do not put `KITE_API_SECRET` in frontend files.
- Keep `FLATTEN_PRODUCTS=MIS,NRML` until you intentionally want to include other product types.
- Free hosting may sleep. If the service sleeps during market hours, the guard is not protecting you. Use an always-on host or paid tier before relying on it with real money.
