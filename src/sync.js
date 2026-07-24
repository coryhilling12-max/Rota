import { downloadFileBytes } from "./google.js";
import { parseRota, parseArchiveWeeks } from "./parse.js";
import { saveWeeks, pruneOld, pruneOldArchive, setMeta } from "./db.js";

export async function syncNow() {
  const fileId = process.env.FILE_ID;
  const sheetName = process.env.SHEET_NAME || "ROTA";
  const archiveSheetName = process.env.ARCHIVE_SHEET_NAME || "2026 Archive";
  const personMatch = new RegExp(process.env.PERSON_MATCH || "^CORY\\s+[A-Z]{2,6}$", "i");
  if (!fileId) throw new Error("Missing FILE_ID in .env");

  const started = Date.now();
  const bytes = await downloadFileBytes(fileId);
  const weeks = parseRota(bytes, { sheetName, personMatch });

  if (weeks.length === 0) {
    setMeta("last_error", `No rows matching ${personMatch} found in sheet "${sheetName}"`);
    throw new Error(`No matching rows found — check PERSON_MATCH / SHEET_NAME.`);
  }

  saveWeeks(weeks, "live");
  pruneOld(14);

  // Weeks that have already rolled off the live tab (archived) but might still fall
  // inside a pay period we're showing totals for — pulled in for pay only, never
  // rendered as rota cards.
  let archiveCount = 0;
  try {
    const earliestLive = weeks[0].weekStart;
    const archiveWeeks = parseArchiveWeeks(bytes, { sheetName: archiveSheetName, personMatch, before: earliestLive });
    if (archiveWeeks.length) {
      saveWeeks(archiveWeeks, "archive");
      archiveCount = archiveWeeks.length;
    }
    pruneOldArchive(60);
  } catch (e) {
    console.error("[sync] archive lookup failed (non-fatal): " + e.message);
  }

  setMeta("last_error", "");

  const ms = Date.now() - started;
  console.log(`[sync] ${weeks.length} live week(s), ${archiveCount} archive week(s) saved in ${ms}ms`);
  return { count: weeks.length, archiveCount, ms };
}
