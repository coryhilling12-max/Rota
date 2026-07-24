import * as XLSX from "xlsx";

// First three letters -> month index. Covers full names, abbreviations
// (Sept, Aug, Jan…) and common misspellings ("Janurary").
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const cell = (v) => (v == null ? "" : String(v).trim());

// Fill color of a specific cell, e.g. "FFE599", or null if unstyled.
function fillColor(ws, r, c) {
  const addr = XLSX.utils.encode_cell({ r, c });
  return ws[addr]?.s?.fgColor?.rgb || null;
}

// "20th July 2026" / "3rd August" / "7th Sept" -> ISO date (yyyy-mm-dd). Year
// defaults to the current year, rolling forward if that would put it in the past.
function parseDateHeader(s) {
  if (!/\d{1,2}(st|nd|rd|th)/.test(s)) return null;
  const m = /(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)(?:\s+(\d{4}))?/.exec(s);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (month == null) return null;
  let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  let d = new Date(Date.UTC(year, month, day));
  if (!m[3] && d < new Date(Date.now() - 45 * 864e5)) {
    d = new Date(Date.UTC(year + 1, month, day));
  }
  return d.toISOString().slice(0, 10);
}

const DAY_HEADER = /^(Mon|Monw\d)$/i;

// Default: match "CORY HVCA", "CORY SVN", "CORY NVCA", "CORY RVN", etc.
// (a role acronym), but not free-text like "CORY MEET JODIE".
const DEFAULT_MATCH = /^CORY\s+[A-Z]{2,6}$/i;

// Single forward pass: track the most recent date + day headers, and attach each
// of the person's rows to that week. Robust to large, multi-section week blocks.
// Returns [{ weekStart, cycle, role, cells: [Mon..Sun] }]
export function parseRota(xlsxBuffer, { sheetName = "ROTA", personMatch = DEFAULT_MATCH } = {}) {
  const matcher = personMatch instanceof RegExp ? personMatch : new RegExp(personMatch, "i");

  const wb = XLSX.read(xlsxBuffer, { type: "buffer", cellStyles: true });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found. Tabs: ${wb.SheetNames.join(", ")}`);

  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: "" });

  const results = [];
  const seen = new Set();
  let curWeekStart = null;
  let curCycle = "";

  for (let i = 0; i < grid.length; i++) {
    const row = grid[i];
    const first = cell(row[0]);

    // Update the running week context.
    const asDate = parseDateHeader(first);
    if (asDate) curWeekStart = asDate;

    const rowVals = row.map(cell);
    if (rowVals.some((x) => DAY_HEADER.test(x)) && rowVals.includes("Tue")) {
      const wk = rowVals.find((x) => /^Week/i.test(x));
      if (wk) curCycle = wk;
    }

    // Is this one of the person's rows?
    if (!matcher.test(first)) continue;
    if (!curWeekStart || seen.has(curWeekStart)) continue; // one row per week
    seen.add(curWeekStart);

    const role = first.replace(/^CORY\s+/i, "").trim(); // e.g. "HVCA" / "SVN"
    const cells = [];
    for (let d = 1; d <= 7; d++) cells.push({ raw: cell(row[d]), color: fillColor(ws, i, d) });
    results.push({ weekStart: curWeekStart, cycle: curCycle, role, cells });
  }

  results.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return results;
}

// Like parseDateHeader, but refuses to guess a year: archive tabs hold genuinely
// past dates, so the live-rota trick of "roll forward if >45 days old" would push
// them a year into the future instead. Only headers that spell out the year count.
function parseDateHeaderWithExplicitYear(s) {
  const m = /(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)\s+(\d{4})/.exec(s);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (month == null) return null;
  return new Date(Date.UTC(parseInt(m[3], 10), month, day)).toISOString().slice(0, 10);
}

// Parse an archive tab for a person's past weeks, e.g. weeks that have rolled off
// the live ROTA tab but still fall inside a pay period. Only trusts date headers
// that explicitly state a year; any date-shaped header without one invalidates the
// running week context instead of guessing, so rows never get misattributed.
export function parseArchiveWeeks(xlsxBuffer, { sheetName, personMatch = DEFAULT_MATCH, before } = {}) {
  const matcher = personMatch instanceof RegExp ? personMatch : new RegExp(personMatch, "i");

  const wb = XLSX.read(xlsxBuffer, { type: "buffer", cellStyles: true });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found. Tabs: ${wb.SheetNames.join(", ")}`);

  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: "" });

  const results = [];
  const seen = new Set();
  let curWeekStart = null;
  let curCycle = "";

  for (let i = 0; i < grid.length; i++) {
    const row = grid[i];
    const first = cell(row[0]);

    const asDate = parseDateHeaderWithExplicitYear(first);
    if (asDate) {
      curWeekStart = asDate;
    } else if (/\d{1,2}(st|nd|rd|th)/.test(first)) {
      curWeekStart = null; // date-shaped header with no explicit year: don't guess
    }

    const rowVals = row.map(cell);
    if (rowVals.some((x) => DAY_HEADER.test(x)) && rowVals.includes("Tue")) {
      const wk = rowVals.find((x) => /^Week/i.test(x));
      if (wk) curCycle = wk;
    }

    if (!matcher.test(first)) continue;
    if (!curWeekStart || seen.has(curWeekStart)) continue;
    if (before && curWeekStart >= before) continue;
    seen.add(curWeekStart);

    const role = first.replace(/^CORY\s+/i, "").trim();
    const cells = [];
    for (let d = 1; d <= 7; d++) cells.push({ raw: cell(row[d]), color: fillColor(ws, i, d) });
    results.push({ weekStart: curWeekStart, cycle: curCycle, role, cells });
  }

  results.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return results;
}
