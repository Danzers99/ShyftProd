import { ROSTER_COURSES, NESTING_COURSES, FL_BLUE_LEGACY, SHYFTOFF_COURSES } from "../utils/constants";

/**
 * Fuzzy-match a course_code or course_name from CIP/production data
 * to our canonical ShyftOff course names.
 *
 * The CIP export uses codes like "nations-flblue2026" while our constants
 * use display names like "NationsBenefits - Florida Blue 2026 Uptraining".
 */
export function matchShyftoffCourse(code) {
  const lc = (code || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (lc.includes("certification") || lc.includes("certcourse")) return ROSTER_COURSES[0];
  if (lc.includes("floridablue") || lc.includes("fiblue") || lc.includes("flblue") || lc.includes("uptraining")) return FL_BLUE_LEGACY;
  if (lc.includes("preproduction") || lc.includes("preprod")) return NESTING_COURSES[0];
  if (lc.includes("navigation") || lc.includes("navmeeting") || lc.includes("selfguided")) return NESTING_COURSES[1];
  return code; // return raw if no match
}

/**
 * Parse certification_progress from CIP/Roster/Nesting/Production exports.
 *
 * Two formats are supported:
 *
 * 1. Integer percentage (Roster/Nesting/simple Production CSVs):
 *    "75" → estimated per-course completion across SHYFTOFF_COURSES
 *
 * 2. JSON array (CIP exports + production-export format):
 *    [{ "course_code": "...", "progress": "0.75", "updated_at": "..." }]
 *    → exact per-course progress
 *
 * Returns: { pct: number|null, map: object, courseMap: object }
 *   - pct: overall percentage 0-100 (or null if unparseable)
 *   - map: raw course_code → progress mapping (JSON format only)
 *   - courseMap: matched-name → percentage 0-100
 */
export function parseCertProgress(raw) {
  if (!raw || raw === "") return { pct: null, map: {}, courseMap: {} };

  // Format 1: plain integer percentage
  const asNum = Number(raw);
  if (!isNaN(asNum) && raw.trim().match(/^\d+$/)) {
    // Estimate per-course completion from overall percentage.
    // Courses unlock in order: NB Cert → FL Blue → Pre-Prod → Nav.
    // 4 courses, each worth 25%. (FL Blue is folded into Pre-Prod content
    // but legacy data still treats it as 4 separate courses.)
    const courseMap = {};
    const perCourse = 100 / SHYFTOFF_COURSES.length;
    let remaining = asNum;
    SHYFTOFF_COURSES.forEach(c => {
      if (remaining >= perCourse) {
        courseMap[c] = 100;
        remaining -= perCourse;
      } else if (remaining > 0) {
        courseMap[c] = Math.round((remaining / perCourse) * 100);
        remaining = 0;
      } else {
        courseMap[c] = 0;
      }
    });
    return { pct: asNum, map: {}, courseMap };
  }

  // Format 2: JSON array with per-course progress
  try {
    const arr = JSON.parse(raw.replace(/""/g, '"'));
    const map = {};
    const courseMap = {};
    arr.forEach(item => {
      const rawCode = item.course_code || item.course_name || "";
      const pct = parseFloat(item.progress) || 0;
      map[rawCode] = pct;
      const matched = matchShyftoffCourse(rawCode);
      // Multiple campaign rows can reference the same course code with progress=0.
      // Keep the highest progress value to avoid losing legitimate completions.
      const newPct = pct * 100;
      if (!(matched in courseMap) || newPct > courseMap[matched]) {
        courseMap[matched] = newPct;
      }
    });
    const values = Object.values(map);
    const pct = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) : 0;
    return { pct, map, courseMap };
  } catch {
    return { pct: null, map: {}, courseMap: {} };
  }
}
