// Parses "Removed Reports" exports — pipeline rows whose status starts with
// "Removed - …". Same 45-column schema as CIP/Roster/Nesting, distinguished by
// the status value.
//
// Goal: build a fast lookup of "what is the removal history for SID X?" so the
// dashboard can flag returning agents and surface context. We intentionally
// limit to the recent window (default 180 days) at build time — older
// removals are noise for daily ops, and the raw file is ~90 MB.
//
// Pure functions. No DOM, no React, no IndexedDB.

const MS_PER_DAY = 86400000;

/**
 * Parse a removal-status string into a clean reason label.
 * "Removed - Certification Stale" → "Certification Stale"
 * "Removed"                        → "Removed"
 * Anything not starting with "Removed" returns null (will be skipped).
 */
export function parseRemovalReason(status) {
  if (!status || typeof status !== "string") return null;
  const trimmed = status.trim();
  if (!/^removed/i.test(trimmed)) return null;
  // Strip leading "Removed -" / "Removed –" / etc., fall through to "Removed"
  const dashStripped = trimmed.replace(/^removed\s*[-–]\s*/i, "");
  return dashStripped === trimmed ? "Removed" : dashStripped;
}

/**
 * Categorize a removal reason into one of:
 *   - "performance"  (Performance, Production Stale)
 *   - "stale"        (Certification Stale — never finished training)
 *   - "voluntary"    (OptIn, Resigned)
 *   - "ops"          (ShyftOff Removal — manual ops action)
 *   - "other"        (plain "Removed" or anything unclassified)
 *
 * Categories are coarser than reasons so the dashboard can show a
 * meaningful tone (red for performance, yellow for voluntary, etc.) without
 * exploding into 7 different colors.
 */
export function categorizeRemoval(reason) {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (r.includes("performance") || r.includes("production stale")) return "performance";
  if (r.includes("certification stale")) return "stale";
  if (r.includes("optin") || r.includes("opt-in") || r.includes("resigned")) return "voluntary";
  if (r.includes("shyftoff removal")) return "ops";
  return "other";
}

/**
 * Build a lookup map from SID → array of past removals (sorted by date desc).
 * Each removal has: { date, daysAgo, reason, category, campaign }
 *
 * @param {Array} rows - parsed rows from the removed-export CSV
 * @param {object} opts
 * @param {number} opts.withinDays - only include removals within this many
 *   days (default 180). Pass 0 / Infinity to include all.
 * @param {number} opts.now - timestamp for "today" — injectable for tests.
 *   Defaults to Date.now().
 */
export function buildRemovalHistoryMap(rows, opts = {}) {
  const withinDays = opts.withinDays ?? 180;
  const now = opts.now ?? Date.now();
  const cutoff = withinDays > 0 && Number.isFinite(withinDays)
    ? now - withinDays * MS_PER_DAY
    : -Infinity;

  const bySid = new Map();
  const removedTodaySids = new Set();
  const todayDate = new Date(now).toISOString().slice(0, 10);

  for (const row of rows || []) {
    const sid = (row.shyftoff_id || "").trim();
    if (!sid) continue;

    const reason = parseRemovalReason(row.status);
    if (!reason) continue;

    const dateStr = (row.status_updated_at || "").trim();
    const ts = Date.parse(dateStr);
    if (Number.isNaN(ts)) continue;
    if (ts < cutoff) continue;

    const isoDate = new Date(ts).toISOString().slice(0, 10);
    const daysAgo = Math.floor((now - ts) / MS_PER_DAY);

    const entry = {
      date: isoDate,
      daysAgo,
      reason,
      category: categorizeRemoval(reason),
      campaign: (row.campaign_nm || "").trim() || null,
    };

    if (isoDate === todayDate) removedTodaySids.add(sid);

    if (!bySid.has(sid)) bySid.set(sid, []);
    bySid.get(sid).push(entry);
  }

  // Sort each agent's history newest-first, dedupe identical (date+reason+campaign).
  for (const [sid, list] of bySid) {
    list.sort((a, b) => b.date.localeCompare(a.date));
    const seen = new Set();
    const dedup = list.filter(e => {
      const k = `${e.date}|${e.reason}|${e.campaign}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    bySid.set(sid, dedup);
  }

  return { bySid, removedTodaySids };
}

/**
 * Compute removal annotations for a single agent given the history map.
 * Returns null if the agent has no removal history (caller can skip).
 *
 * Fields:
 *   wasRemoved          : true (always, when history exists)
 *   removalCount        : how many times this SID has been removed (in window)
 *   lastRemovalDate     : YYYY-MM-DD of most recent removal
 *   lastRemovalDaysAgo  : integer days since most recent removal
 *   lastRemovalReason   : "Certification Stale" / "Performance" / etc.
 *   lastRemovalCategory : "performance" / "stale" / "voluntary" / "ops" / "other"
 *   previouslyInProd    : at least one removal was Production Stale or Performance
 *                          (signals the agent has historically reached prod)
 *   removalHistory      : the full array of removals
 *   recencyTier         : "recent" (≤30d) / "near" (≤90d) / "older"
 */
export function annotateAgentRemoval(historyMap, sid) {
  if (!historyMap || !sid) return null;
  const list = historyMap.bySid?.get(sid);
  if (!list || !list.length) return null;

  const last = list[0]; // sorted desc
  const previouslyInProd = list.some(e =>
    /performance/i.test(e.reason) || /production stale/i.test(e.reason));

  let recencyTier;
  if (last.daysAgo <= 30) recencyTier = "recent";
  else if (last.daysAgo <= 90) recencyTier = "near";
  else recencyTier = "older";

  return {
    wasRemoved: true,
    removalCount: list.length,
    lastRemovalDate: last.date,
    lastRemovalDaysAgo: last.daysAgo,
    lastRemovalReason: last.reason,
    lastRemovalCategory: last.category,
    previouslyInProd,
    removalHistory: list,
    recencyTier,
  };
}
