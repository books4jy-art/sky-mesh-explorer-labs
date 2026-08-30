# AGENTS.md

## Project Context

Sky Mesh Explorer is a self-hosted app: a React/Vite frontend and a small Express backend (`server/`) backed by Postgres and a Google Drive service account. It does not depend on Base44.

Start with `README.md` for setup, environment variables, and running locally/deploying.

## Key Files

- `src/`: frontend application source.
- `src/api/base44Client.js`: thin fetch client the frontend uses to call the backend (`base44.functions.invoke(name, body)` — name kept for minimal diff against the app's history, not a Base44 dependency).
- `server/index.js`: Express app entrypoint; mounts routes and serves the built frontend in production.
- `server/routes/`: the live HTTP endpoints the frontend calls.
- `server/scripts/`: one-off/admin data-maintenance scripts (Drive↔Postgres sync, backfills, audits) — run via `node server/scripts/<name>.js`, not exposed over HTTP.
- `server/db.js`: Postgres pool + schema creation.
- `server/drive.js`: Google service-account Drive auth.
- `.env.local`: local-only environment values (`DATABASE_URL`, `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`, etc.) — never commit secrets.

## Working Notes

- `npm run dev` runs the Vite frontend and the Express backend together (frontend proxies `/api` to the backend).
- `npm run build && npm start` is the production path — one process serves both the built frontend and the API.
- Run the relevant checks from `package.json` before finishing code changes.
