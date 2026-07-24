import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/rota.db";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS weeks (
    week_start TEXT PRIMARY KEY,   -- ISO date of the Monday
    cycle      TEXT,               -- e.g. "Week 4"
    role       TEXT,               -- e.g. "HVCA" / "SVN"
    cells      TEXT NOT NULL,      -- JSON array of 7 raw cell strings (Mon..Sun)
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Add columns to databases created before they existed (safe no-op otherwise).
try { db.exec("ALTER TABLE weeks ADD COLUMN role TEXT"); } catch (_) {}
// "live" = currently on the ROTA tab, shown as week cards. "archive" = rolled off
// the live tab but still counted toward pay for periods that cover them.
try { db.exec("ALTER TABLE weeks ADD COLUMN source TEXT NOT NULL DEFAULT 'live'"); } catch (_) {}

const upsertStmt = db.prepare(`
  INSERT INTO weeks (week_start, cycle, role, cells, source, updated_at)
  VALUES (@week_start, @cycle, @role, @cells, @source, @updated_at)
  ON CONFLICT(week_start) DO UPDATE SET
    cycle = excluded.cycle,
    role = excluded.role,
    cells = excluded.cells,
    source = excluded.source,
    updated_at = excluded.updated_at
`);

export function saveWeeks(weeks, source = "live") {
  const now = new Date().toISOString();
  const tx = db.transaction((rows) => {
    for (const w of rows) {
      upsertStmt.run({
        week_start: w.weekStart,
        cycle: w.cycle || "",
        role: w.role || "",
        cells: JSON.stringify(w.cells),
        source,
        updated_at: now,
      });
    }
    if (source === "live") {
      setMeta("last_sync", now);
      setMeta("last_sync_count", String(rows.length));
    }
  });
  tx(weeks);
}

// Keep the table lean: drop *live* weeks that ended more than `days` ago.
export function pruneOld(days = 14) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  db.prepare("DELETE FROM weeks WHERE source = 'live' AND date(week_start, '+6 days') < ?").run(cutoff);
}

// Archive weeks only need to stick around long enough to cover a pay period
// (28 days) that overlaps them — anything older than that is dead weight.
export function pruneOldArchive(days = 60) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  db.prepare("DELETE FROM weeks WHERE source = 'archive' AND date(week_start, '+6 days') < ?").run(cutoff);
}

export function getWeeks(source = "live") {
  return db
    .prepare("SELECT week_start, cycle, role, cells FROM weeks WHERE source = ? ORDER BY week_start")
    .all(source)
    .map((r) => ({ weekStart: r.week_start, cycle: r.cycle, role: r.role || "", cells: JSON.parse(r.cells) }));
}

export function setMeta(key, value) {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function getMeta(key) {
  const r = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return r ? r.value : null;
}

export default db;
