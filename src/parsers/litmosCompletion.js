// Derive how many of the required Litmos courses an agent has completed,
// using a fallback chain so we don't show "0/14" for agents who actually
// have done their courses but happen to be missing from the per-course
// Course Data export.
//
// Priority (most → least authoritative):
//   1. Course Data per-course records (exact, preferred)
//   2. People Report "Is All Courses Complete" boolean (authoritative
//      yes/no answer when Course Data is missing)
//   3. People Report aggregate "% Assigned Courses Complete" (estimate
//      derived as round(pct/100 × total) — caveat: the %'s denominator
//      is total assigned courses, which may be different from our 14
//      required ones)
//   4. Nothing — return 0 with source = "missing"
//
// The `source` field travels with the count so the UI can mark estimates
// distinctly (e.g. "~13/14*" vs "13/14") and the user knows when a
// number is exact vs. derived.

/**
 * @param {object|null} ldata - per-course Litmos data (has `courses` map)
 * @param {object|null} peopleCompletion - { pct, allComplete } from People Report
 * @param {string[]} requiredCourses - the canonical list (REQUIRED_LITMOS)
 * @returns {{ count: number, total: number, source: string, estimated: boolean }}
 */
export function deriveLitmosCount(ldata, peopleCompletion, requiredCourses) {
  const total = requiredCourses?.length || 0;

  // 1. Course Data per-course (preferred — exact, by course name)
  if (ldata && ldata.courses) {
    const count = requiredCourses.filter(c => ldata.courses[c]?.completed).length;
    return { count, total, source: "course-data", estimated: false };
  }

  // 2/3. People Report fallback (only if account is in Litmos at all)
  if (peopleCompletion) {
    // 2. Is All Courses Complete = true → authoritative "yes, all done"
    if (peopleCompletion.allComplete === true) {
      return { count: total, total, source: "people-report", estimated: false };
    }
    // 3. % Assigned Courses Complete → estimate. Clamp to [0, total].
    // Explicitly check for null/undefined before coercing — Number(null) is 0
    // and would silently produce a "0% estimate" instead of falling through.
    if (peopleCompletion.pct != null) {
      const pct = Number(peopleCompletion.pct);
      if (Number.isFinite(pct) && pct >= 0) {
        const estimate = Math.max(0, Math.min(total, Math.round((pct / 100) * total)));
        return { count: estimate, total, source: "people-report-estimate", estimated: true };
      }
    }
  }

  // 4. No data anywhere
  return { count: 0, total, source: "missing", estimated: false };
}

/**
 * Build a lookup of per-username completion data from the People Report.
 * Returns a Map keyed by lowercase username (the email) → { pct, allComplete }.
 *
 * Tolerates rows where the metric fields are blank or missing — those
 * usernames simply have no completion entry, which falls through to the
 * "missing" source in deriveLitmosCount.
 */
export function buildPeopleCompletionMap(peopleRows) {
  const out = new Map();
  for (const r of peopleRows || []) {
    const username = (r["People.Username"] || "").toLowerCase().trim();
    if (!username) continue;

    const pctRaw = r["People Metrics.% Assigned Courses Complete"];
    const allRaw = (r["People Metrics.Is All Courses Complete"] || "").trim().toUpperCase();

    const pct = pctRaw === "" || pctRaw == null ? null : Number(pctRaw);
    // Litmos exports the boolean as the literal string "TRUE" / "FALSE"
    const allComplete = allRaw === "TRUE" ? true : allRaw === "FALSE" ? false : null;

    // Skip empty entries entirely — no signal to record
    if (pct === null && allComplete === null) continue;

    out.set(username, {
      pct: Number.isFinite(pct) ? pct : null,
      allComplete,
    });
  }
  return out;
}
