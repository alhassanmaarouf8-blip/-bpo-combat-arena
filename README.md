# BPO Combat Arena — OMNI-PERFORM

German interview trainer for Egyptian BPO job seekers. Live voice fights, grammar coaching, and adaptive drills — built on OpenAI Realtime.

## Quick Start

### Prereqs
- Node.js 18+
- npm or yarn
- (optional) Render free Postgres — leave `DATABASE_URL` unset to use local JSON storage
- (optional) Vercel account for frontend hosting

### 1. Clone
`git clone <repo>`; `cd bpo-combat-arena`

### 2. Server
```bash
# copy env and fill in at least OPENAI_API_KEY + AUTH_SECRET + CLIENT_ORIGIN
cp server/.env.example server/.env
# edit server/.env

cd server && npm install
npm run dev           # or node server.js
```

### 3. Client
```bash
cd client && npm install
# set VITE_WS_URL in Vercel project Environment Variables, or
# create client/.env.local for dev:
echo "VITE_WS_URL=ws://localhost:3001" > .env.local
npm run dev           # starts on :5173
```

### 4. Verify
- Web UI: http://localhost:5173
- API health: http://localhost:3001/health
- Dev Router: http://localhost:3001/dev-router (mapping)

## Env Variables
See `ENV_VARS.md` for the full server + client reference.

Key ones:
- `OPENAI_API_KEY` — required
- `AUTH_SECRET` — required in production
- `CLIENT_ORIGIN` — required in production (Vercel URL)
- `DATABASE_URL` — optional (Postgres for durable storage)
- `VITE_WS_URL` — client-side (Vercel), set to `wss://bpo-combat-arena.onrender.com`

## Architecture
- `server/server.js` — Express app + WebSocket
- `server/websocketManager.js` — live Realtime sessions
- `server/scoring/` — panel scorer + router
- `server/trainingslagerContent.js` — quiz content (edit freely)
- `client/src/App.jsx` — main SPA
- `client/vite.config.js` — VITE_WS_URL injected at build

## Deployment
- **Frontend**: Vercel (set `VITE_WS_URL` env var and redeploy)
- **Backend**: Render (set env vars, connect Postgres, port auto-injected)

## Observability
- `/api/clienterror` crashes are posted by the browser
- Use `server/logger.js` (`safeHandler`) to wrap routes; logs go to Render stdout.
- `/health` returns `{ status: 'ok', uptime, ts }`.
