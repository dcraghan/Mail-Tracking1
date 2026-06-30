# MailFlow Tracking Server

Lightweight open-pixel & click-redirect tracking server for the MailFlow email marketing app.
Uses Express + SQLite (via better-sqlite3). No external services needed.

---

## Deploy to Railway (recommended — free tier works fine)

1. Push this folder to a GitHub repo (or upload via Railway CLI).
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub.
3. Select your repo — Railway auto-detects Node.js via `railway.toml`.
4. Once deployed, copy your public URL (e.g. `https://mailflow-tracking.up.railway.app`).
5. Paste that URL into the MailFlow app's **Tracking URL** setting.

## Deploy to Render (alternative)

1. Push to GitHub.
2. Render → New Web Service → connect repo.
3. Build command: `npm install`
4. Start command: `node server.js`
5. Free instance type is fine for <10k emails/month.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/track/open?cid=&uid=&em=` | Returns 1×1 pixel, logs open |
| GET | `/track/click?cid=&uid=&em=&url=` | Logs click, redirects to `url` |
| GET | `/stats/campaign/:cid` | Opens + clicks for a campaign |
| GET | `/stats/all` | Summary across all campaigns |
| DELETE | `/stats/campaign/:cid` | Clear tracking data |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Port to listen on |
| `DB_PATH` | `./tracking.db` | SQLite database file path |

---

## Apple Mail Privacy note

Apple Mail (iOS 15+ / macOS Monterey+) pre-loads all images via Apple proxy servers,
which means every Apple Mail user will appear as "opened" immediately on send.
MailFlow flags these as "MPP suspected" when the open timestamp is within 5 seconds
of the send time and the user-agent contains "Apple".
