// Shared logic for interpreting a raw rota cell. Used by both the parser and the API
// so the frontend never has to guess.

// The sheet highlights certain "12.3" cells with this yellow fill for shifts that
// are actually holiday (no "HOL" text present) — treated the same as text-marked holiday.
const HOLIDAY_FILL = "FFE599";
function isHolidayColor(color) {
  return typeof color === "string" && color.toUpperCase() === HOLIDAY_FILL;
}

// Duration implied by the shift text alone, ignoring HOL/NA/COLLEGE special cases.
function rawShiftHours(s) {
  if (/^12\.3$/.test(s)) return 12.3; // shorthand for the standard 12.3h night shift
  // Minutes are optional: "9am" and "9.00am" both mean the same thing.
  const m = [...s.matchAll(/(\d{1,2})(?:\.(\d{2}))?(am|pm)/gi)];
  if (m.length < 2) return 0;
  const toMin = ([, h, mm, ap]) => {
    let hr = parseInt(h, 10) % 12;
    if (ap.toLowerCase() === "pm") hr += 12;
    return hr * 60 + (mm ? parseInt(mm, 10) : 0);
  };
  let start = toMin(m[0]);
  let end = toMin(m[m.length - 1]);
  if (end <= start) end += 24 * 60; // overnight shift
  return Math.round(((end - start) / 60) * 100) / 100;
}

export function parseHours(raw, color) {
  if (!raw) return 0;
  const s = String(raw).trim();
  if (/^NA$/i.test(s)) return 0;
  if (/^HOL/i.test(s)) {
    const m = /HOL\s*(\d+(?:\.\d+)?)/i.exec(s);
    if (m) return parseFloat(m[1]);
    return rawShiftHours(s.replace(/^HOL\s*/i, "").trim());
  }
  if (/^COLLEGE$/i.test(s)) return 7.15; // college days are paid, fixed 7.15h
  return rawShiftHours(s);
}

export function classify(raw, color) {
  const s = String(raw || "").trim();
  if (!s || /^NA$/i.test(s)) return "off";
  if (/^HOL/i.test(s)) return "hol";
  if (isHolidayColor(color)) return "hol"; // yellow-highlighted, no "HOL" text needed
  if (s === "12.3") return "night";
  const m = [...s.matchAll(/(\d{1,2})(?:\.(\d{2}))?(am|pm)/gi)];
  if (m.length >= 2) {
    const startAp = m[0][3].toLowerCase();
    const endAp = m[m.length - 1][3].toLowerCase();
    return startAp === "pm" && endAp === "am" ? "night" : "day";
  }
  return "note"; // text with no parseable time: COLLEGE, "(3 Days)", MEETING…
}

export function prettyShift(raw, color) {
  const s = String(raw || "").trim();
  if (/^HOL/i.test(s) || isHolidayColor(color)) {
    const hrs = parseHours(raw, color);
    return hrs > 0 ? `Holiday · ${hrs}h` : "Holiday";
  }
  if (s === "12.3") return "Night · 12.3h";
  if (/^COLLEGE$/i.test(s)) return "College · 7.15h";
  if (!s || /^NA$/i.test(s)) return "";
  // Cells with more than one shift squeezed in (e.g. task-code-prefixed back-to-back
  // shifts like "040:10am-4.30pm 572:4.30pm-8.30pm") get collapsed to their overall
  // span instead of showing the full messy text, which otherwise stretches the card.
  const m = [...s.matchAll(/(\d{1,2})(?:\.(\d{2}))?(am|pm)/gi)];
  if (m.length > 2) return `${m[0][0]} – ${m[m.length - 1][0]}`;
  return s.replace(/-/g, " – ");
}

// Turn a stored day record into the shape the frontend renders.
export function decorate(raw, color) {
  return {
    raw: raw || "",
    kind: classify(raw, color),
    hours: parseHours(raw, color),
    label: prettyShift(raw, color),
  };
}
