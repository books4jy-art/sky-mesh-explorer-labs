# Sky Mesh Explorer

A self-hosted toolkit for browsing and dressing up *Sky: Children of the Light* assets: a **Mesh Viewer** that decodes the game's proprietary `.mesh` format client-side and exports to `.obj`, and an **Outfit Maker** for mixing cataloged outfit pieces into a combined 3D preview/export.

This app runs entirely on infrastructure you control — a Node/Express backend, a Postgres database, and your own Google Drive service account. It no longer depends on Base44.

**Live demo:** https://sky-mesh-explorer-labs.onrender.com/

## Architecture

- **Frontend** — React + Vite, served as static files.
- **Backend** — `server/index.js`, a small Express app exposing the same handful of endpoints the frontend calls (`/api/functions/*`).
- **Database** — Postgres (e.g. a free Supabase project). Three tables: `mesh_files`, `outfit_icons`, `library_sync_status`.
- **Asset source** — a Google Drive folder tree with your extracted `.obj` meshes and `.png` outfit icons, read via a Google Cloud service account (read-only Drive scope).

## Prerequisites

1. **Postgres database** — easiest option is a free [Supabase](https://supabase.com) project. Grab the connection string from Project Settings → Database → Connection string (URI form).
2. **Google Cloud service account** with Drive API access:
   - Create a project at [console.cloud.google.com](https://console.cloud.google.com), enable the **Google Drive API**.
   - Create a service account, download its JSON key, save it as `service-account.json` in the project root (already `.gitignore`'d).
   - Share your mesh/icon Drive folders with the service account's `client_email` (Viewer access is enough).
3. Node.js 18+.

## Setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`:

```bash
DATABASE_URL=postgresql://...           # your Postgres connection string
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account.json
```

(Optional overrides for `DRIVE_FOLDER_ID` / `OUTFIT_ICON_FOLDER_ID` / `OUTFIT_MESH_FOLDER_ID` / `PLACEHOLDER_DRIVE_FILE_ID` — see `.env.example` — only needed if you're not using the original curated Drive folders.)

The database tables are created automatically the first time the server starts.

## Run locally

```bash
npm run dev
```

Starts Vite (frontend, with HMR) and the Express backend together; open the URL Vite prints. The frontend proxies `/api/*` to the backend.

## Seed the data

The Mesh Viewer's library and the Outfit Maker's catalog are empty until you sync them from Drive:

```bash
# Mesh Viewer library
node server/scripts/listDriveObjFiles.js     # optional sanity check of what's in Drive
# (or just click "Sync Library" in the Viewer UI — calls the same syncDriveLibrary endpoint)

# Outfit Maker catalog
node server/scripts/syncOutfitIcons.js
node server/scripts/syncOutfitMeshes.js --dry-run          # review the plan first
node server/scripts/syncOutfitMeshes.js --dry-run=false    # then write it
```

A handful of other scripts under `server/scripts/` exist for one-off data cleanup that the original curated dataset needed (mismatched naming, duplicate placeholder rows, etc.) — see the comment at the top of each file for what it does and when you'd need it: `auditIconSource.js`, `auditOutfitIcons.js`, `backfillNeckDragonIcons.js`, `backfillOutfitImageUrls.js`, `backfillTailMeshes.js`, `deleteDuplicatePlaceholders.js`, `mergeOutfitStragglers.js`.

## Deploy (self-hosted)

Build the frontend, then run the server in production mode — it serves the built frontend and the API from a single process/port:

```bash
npm run build
npm start
```

### Docker

```bash
docker build -t sky-mesh-explorer .
docker run -p 3001:3001 \
  --env-file .env.local \
  -v $(pwd)/service-account.json:/app/service-account.json:ro \
  sky-mesh-explorer
```

Point `DATABASE_URL` at your Supabase (or any reachable) Postgres instance — the container itself doesn't run a database.

## Project layout

- `src/` — frontend (React Router pages, Three.js mesh viewer, outfit maker UI).
- `server/` — Express backend: live routes under `server/routes/`, one-off/admin data scripts under `server/scripts/`.
- `server/db.js` — Postgres pool + schema creation.
- `server/drive.js` — Google service-account Drive auth.
