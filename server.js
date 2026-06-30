/**
 * MailFlow Tracking Server
 * Handles email open pixels and click redirects, stores events in SQLite.
 * Deploy to Railway / Render / Fly.io — needs a public HTTPS URL.
 */

const express = require("express");
const cors    = require("cors");
const Database = require("better-sqlite3");
const path    = require("path");
const crypto  = require("crypto");

const app  = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "tracking.db");

// ── 1×1 transparent GIF (hard-coded bytes, no file needed) ───────
const PIXEL = Buffer.from(
  "47494638396101000100800000ffffff00000021f90400000000002c00000000" +
  "010001000002024401003b",
  "hex"
);

// ── Database setup ────────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS opens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    email       TEXT,
    opened_at   TEXT NOT NULL DEFAULT (datetime('now')),
    user_agent  TEXT,
    ip          TEXT
  );

  CREATE TABLE IF NOT EXISTS clicks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    email       TEXT,
    url         TEXT NOT NULL,
    clicked_at  TEXT NOT NULL DEFAULT (datetime('now')),
    user_agent  TEXT,
    ip          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_opens_campaign  ON opens(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_opens_contact   ON opens(contact_id);
  CREATE INDEX IF NOT EXISTS idx_clicks_campaign ON clicks(campaign_id);
`);

const insertOpen  = db.prepare(`INSERT INTO opens  (campaign_id, contact_id, email, user_agent, ip) VALUES (?,?,?,?,?)`);
const insertClick = db.prepare(`INSERT INTO clicks (campaign_id, contact_id, email, url, user_agent, ip) VALUES (?,?,?,?,?,?)`);

// ── Middleware ────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

// ── Open pixel ────────────────────────────────────────────────────
// Embed in email: <img src="TRACKING_URL/track/open?cid=CAMPAIGN_ID&uid=CONTACT_ID&em=EMAIL" width="1" height="1" />
app.get("/track/open", (req, res) => {
  const { cid, uid, em } = req.query;
  if (cid && uid) {
    try {
      insertOpen.run(cid, uid, em || null, req.headers["user-agent"] || null, getIp(req));
    } catch (e) {
      console.error("Open insert error:", e.message);
    }
  }
  res.set({
    "Content-Type":  "image/gif",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma":        "no-cache",
    "Expires":       "0",
  });
  res.send(PIXEL);
});

// ── Click redirect ────────────────────────────────────────────────
// Wrap links: TRACKING_URL/track/click?cid=CAMPAIGN_ID&uid=CONTACT_ID&em=EMAIL&url=ENCODED_URL
app.get("/track/click", (req, res) => {
  const { cid, uid, em, url } = req.query;
  if (cid && uid && url) {
    try {
      insertClick.run(cid, uid, em || null, url, req.headers["user-agent"] || null, getIp(req));
    } catch (e) {
      console.error("Click insert error:", e.message);
    }
  }
  const dest = url ? decodeURIComponent(url) : "/";
  res.redirect(302, dest);
});

// ── Stats API ─────────────────────────────────────────────────────
// GET /stats/campaign/:cid → opens, clicks, unique openers (with per-contact open counts)
app.get("/stats/campaign/:cid", (req, res) => {
  const { cid } = req.params;
  const opens      = db.prepare(`SELECT COUNT(*) as n FROM opens  WHERE campaign_id=?`).get(cid);
  const uniqueOpen = db.prepare(`SELECT COUNT(DISTINCT contact_id) as n FROM opens WHERE campaign_id=?`).get(cid);
  const clicks     = db.prepare(`SELECT COUNT(*) as n FROM clicks WHERE campaign_id=?`).get(cid);
  const uniqueClick= db.prepare(`SELECT COUNT(DISTINCT contact_id) as n FROM clicks WHERE campaign_id=?`).get(cid);
  const recentOpens= db.prepare(`SELECT contact_id, email, opened_at FROM opens WHERE campaign_id=? ORDER BY opened_at DESC LIMIT 50`).all(cid);
  const recentClicks=db.prepare(`SELECT contact_id, email, url, clicked_at FROM clicks WHERE campaign_id=? ORDER BY clicked_at DESC LIMIT 50`).all(cid);

  // Full unique-opener list, grouped server-side — not capped, accurate for any list size
  const uniqueOpeners = db.prepare(`
    SELECT contact_id, email,
      COUNT(*) as open_count,
      MIN(opened_at) as first_open,
      MAX(opened_at) as last_open
    FROM opens
    WHERE campaign_id = ?
    GROUP BY contact_id
    ORDER BY last_open DESC
  `).all(cid);

  res.json({
    campaign_id: cid,
    opens: opens.n,
    unique_opens: uniqueOpen.n,
    clicks: clicks.n,
    unique_clicks: uniqueClick.n,
    recent_opens: recentOpens,
    recent_clicks: recentClicks,
    unique_openers: uniqueOpeners,
  });
});

// GET /stats/all → summary across all campaigns
app.get("/stats/all", (req, res) => {
  const campaigns = db.prepare(`
    SELECT campaign_id,
      COUNT(DISTINCT contact_id) as unique_opens,
      COUNT(*) as total_opens,
      MIN(opened_at) as first_open,
      MAX(opened_at) as last_open
    FROM opens GROUP BY campaign_id
  `).all();
  res.json({ campaigns });
});

// DELETE /stats/campaign/:cid → wipe tracking data for a campaign
app.delete("/stats/campaign/:cid", (req, res) => {
  const { cid } = req.params;
  db.prepare(`DELETE FROM opens  WHERE campaign_id=?`).run(cid);
  db.prepare(`DELETE FROM clicks WHERE campaign_id=?`).run(cid);
  res.json({ ok: true });
});

// ── Health check ──────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`MailFlow Tracking Server running on port ${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});

