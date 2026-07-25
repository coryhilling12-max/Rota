import "dotenv/config";
import express from "express";
import cron from "node-cron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

import { getWeeks, getMeta } from "./db.js";
import { decorate } from "./shift-utils.js";
import { syncNow } from "./sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

initializeApp({
  credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});

// Only this Google account's sign-in token is accepted — this is a personal app,
// so anyone else who signs in with a different Google account is rejected here
// even though Firebase Auth itself would let them sign in.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  try {
    const decoded = await getAuth().verifyIdToken(token);
    if (decoded.email !== process.env.ALLOWED_EMAIL) {
      return res.status(403).json({ error: "Not authorized" });
    }
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid auth token" });
  }
}

app.use(express.static(path.join(__dirname, "..", "public")));

// Shifts, decorated for the frontend.
function decorateWeek(w) {
  const days = w.cells.map((c, i) => {
    const date = new Date(Date.UTC(...w.weekStart.split("-").map(Number).map((n, idx) => (idx === 1 ? n - 1 : n))));
    date.setUTCDate(date.getUTCDate() + i);
    return { date: date.toISOString().slice(0, 10), ...decorate(c.raw, c.color) };
  });
  const worked = days.reduce((s, d) => (d.kind === "hol" ? s : s + d.hours), 0);
  const leave = days.reduce((s, d) => (d.kind === "hol" ? s + d.hours : s), 0);
  return {
    weekStart: w.weekStart,
    cycle: w.cycle,
    role: w.role,
    days,
    worked: Math.round(worked * 100) / 100,
    leave: Math.round(leave * 100) / 100,
  };
}

app.get("/api/shifts", requireAuth, (req, res) => {
  const weeks = getWeeks("live").map(decorateWeek);
  // Archived weeks: not shown as rota cards (they've rolled off the live tab),
  // but their days are exposed so pay-period totals can still include them.
  const archiveDays = getWeeks("archive").flatMap((w) => decorateWeek(w).days);
  res.json({
    person: process.env.PERSON_NAME || "Cory",
    lastSync: getMeta("last_sync"),
    lastError: getMeta("last_error") || null,
    weeks,
    archiveDays,
  });
});

// Manual re-sync trigger.
app.post("/api/sync", requireAuth, async (req, res) => {
  try {
    const r = await syncNow();
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, async () => {
  console.log(`My Rota running at http://localhost:${PORT}`);

  // Sync once on boot (don't crash the server if Google is briefly unreachable).
  try {
    await syncNow();
  } catch (e) {
    console.error("[boot sync] " + e.message);
  }

  // Then on a schedule.
  const expr = process.env.SYNC_CRON || "0 */3 * * *";
  cron.schedule(expr, () => {
    syncNow().catch((e) => console.error("[cron sync] " + e.message));
  });
  console.log(`[cron] auto-sync scheduled: "${expr}"`);
});
