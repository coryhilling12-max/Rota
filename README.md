# My Rota — self-hosted, auto-syncing personal rota

Reads the shared master rota from Google Drive, extracts **only your** shifts
(`CORY HVCA`), stores them in a database, and serves a clean personal view.
It re-syncs itself on a schedule, so you never touch it after setup.

```
Google Drive (master .xlsx)
        │  drive.readonly, downloaded on a schedule
        ▼
   parse.js  ── finds your rows, maps Mon→Sun
        ▼
   SQLite DB  (data/rota.db)
        ▼
   Express API  →  /public/index.html  (the view you see)
```

## What you need
- **Node 18+**
- A free **Google Cloud** project (5 minutes) so the app can read the sheet as you.

## 1. Google setup (one time)
1. Go to <https://console.cloud.google.com/> → create a project.
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen:** choose **External**, fill the
   basics, and under **Test users** add your own Google address (the one that can
   see the rota). Add the scope `.../auth/drive.readonly`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Application type: Desktop app.** Copy the **Client ID** and **Client secret**.

## 2. Install & configure
```bash
npm install
cp .env.example .env
# edit .env: paste GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
```
`FILE_ID`, `SHEET_NAME`, and `PERSON_LABEL` are already filled in for your rota.

## 3. Authorize (one time)
```bash
npm run auth
```
Open the printed URL, sign in with the account that can see the rota, approve
(you'll see an "unverified app" warning because it's your own project — click
**Advanced → continue**). It prints a line like:
```
GOOGLE_REFRESH_TOKEN=1//0abc...
```
Paste that into your `.env`.

## 4. Run
```bash
npm start
```
Open <http://localhost:8080>. It syncs on boot, then every 3 hours
(`SYNC_CRON` in `.env`). There's also a **Refresh now** button, and:
```bash
npm run sync      # force a one-off sync from the terminal
```

## Deploying (so it runs 24/7 without your laptop)
Any host that runs Node works. Easiest options:
- **Railway / Render / Fly.io:** push this repo, set the same env vars in their
  dashboard, and add a persistent disk mounted where `DB_PATH` points
  (e.g. `/data`) so the database survives restarts.
- **A VPS or Raspberry Pi:** `npm install && npm start`, kept alive with
  `pm2 start src/server.js --name rota` (`npm i -g pm2`).

Set the env vars from your `.env` in the host's dashboard rather than committing
`.env`.

## Switching SQLite → Postgres (optional, later)
SQLite is a real database and is plenty for one person. If you'd rather use
Postgres (e.g. a managed one on Railway/Neon), only `src/db.js` changes: swap
`better-sqlite3` for `pg`, keep the same two tables (`weeks`, `meta`) and the
same function names (`saveWeeks`, `getWeeks`, `pruneOld`, `getMeta`, `setMeta`).
Nothing else in the app needs to change.

## If it ever stops finding shifts
You appear under more than one label — `CORY HVCA` for nights now, `CORY SVN`
further ahead once you're on student-nurse shifts — so matching is by pattern,
not one fixed label. Knobs in `.env`:
- `SHEET_NAME` — the tab that holds the live weeks (currently `ROTA`).
- `PERSON_MATCH` — a regex over the name column (default `^CORY\s+[A-Z]{2,6}$`,
  which catches CORY + any role code: HVCA, SVN, NVCA, VCA, RVN…). It reads the
  first column only, so it never picks up meeting notes like "CORY MEET JODIE".
- `PERSON_NAME` — just the name shown in the app.
The homepage shows the last sync time and any error, so you'll see it there.

## Security notes
- The app only ever requests **read-only** Drive access.
- Your refresh token is a credential — keep `.env` private, don't commit it.
- Nothing is shared publicly; the server only exposes your own shifts.
```
