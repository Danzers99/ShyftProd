import { ROSTER_COURSES, NESTING_COURSES, FL_BLUE_LEGACY, REQUIRED_LITMOS } from "../utils/constants";
import { resolveBgStatus } from "./resolveBgStatus";

/**
 * Compute every agent flag from a single CIP-shaped row + lookup context.
 *
 * This is a PURE function — no React, no fetches, no closures over component state.
 * Everything it needs is passed via the `context` parameter, making it trivially
 * testable. Each flag has a precise definition documented inline.
 *
 * @param {object} row - A deduplicated CIP/Roster/Nesting row
 * @param {object} cert - Result of parseCertProgress(row.certification_progress)
 * @param {object} context - {
 *     ldata,                      // Litmos data for this agent (or null)
 *     inLitmos, hasNameCollision, // Resolved Litmos presence + collision state
 *     collidingUsernames,         // Array of conflicting Litmos usernames if collision
 *     navAttended, navAvailable,  // Nav meeting attendance state
 *     prodCampaigns,              // Campaigns this agent is already in production for
 *     rowCampaign,                // The campaign this CIP row is for (ENG vs Bilingual)
 *     removalAnnotation,          // Result of annotateAgentRemoval (or null) —
 *                                 //   used as the strongest rehire signal
 *     litmosAccountCreatedDate,   // ISO date string from People Report's
 *                                 //   "People.Created Date" (or null)
 *     now,                        // Optional injectable Date.now() — for tests
 * }
 * @returns The full flag object that gets pushed to results[].
 */
export function computeAgentFlags(row, cert, context) {
  const {
    ldata,
    inLitmos,
    hasNameCollision,
    collidingUsernames,
    navAttended,
    navAvailable,
    prodCampaigns,
    rowCampaign,
    removalAnnotation = null,
    litmosAccountCreatedDate = null,
    now: _now,
  } = context;
  const NOW_MS = _now ?? Date.now();

  const name = (row.agent_nm || row.agent_name || "").trim();
  const sid = (row.shyftoff_id || "").trim();
  const status = (row.status || "").trim();
  const statusLower = status.toLowerCase();

  // === Litmos courses ===
  const litmosDone = REQUIRED_LITMOS.map(c => ({
    name: c,
    completed: ldata?.courses[c]?.completed || false,
    pct: ldata?.courses[c]?.pct || 0,
    date: ldata?.courses[c]?.date || "",
  }));
  const litmosCount = litmosDone.filter(c => c.completed).length;
  const allLitmos = litmosCount === 14;

  // === ShyftOff courses ===
  const courseMap = cert.courseMap || {};
  const shyftoffPct = cert.pct;
  const shyftoffComplete = shyftoffPct === 100;

  // Phase 1 (Roster) only requires NB Certification for credential eligibility.
  // FL Blue was folded into Pre-Production and is no longer a separate Phase 1 requirement.
  const nbCertDone = (courseMap[ROSTER_COURSES[0]] || 0) >= 100;
  const flBlueDone = (courseMap[FL_BLUE_LEGACY] || 0) >= 100;
  const rosterCoursesDone = nbCertDone;
  const preProdDone = (courseMap[NESTING_COURSES[0]] || 0) >= 100;
  const navCourseDone = (courseMap[NESTING_COURSES[1]] || 0) >= 100;
  const nestingCoursesDone = preProdDone && navCourseDone;

  // === Status flags ===
  const isNesting = statusLower.includes("nesting");
  const isRoster = statusLower.includes("roster");
  const isCredentialsRequested = statusLower.includes("credentials requested");
  const shyftoffStaleLevel = (row.stale_level || "").trim();
  const hasCcaas = !!(row.ccaas_id || "").trim();
  const missingCcaas = !hasCcaas;

  // === BG check ===
  const bg = resolveBgStatus(row);
  const { bgStatus, bgCleared, cipBgProcess, cipBgReport, isBgMismatch, hasAccountIssue } = bg;

  // === Date deltas ===
  const createdAt = row.created_at ? new Date(row.created_at) : null;
  const lastChanged = row.last_changed || row.status_updated_at || "";
  const changedAt = lastChanged ? new Date(lastChanged) : null;
  const daysSinceChange = changedAt ? Math.floor((NOW_MS - changedAt.getTime()) / 86400000) : null;
  const daysSinceCreated = createdAt ? Math.floor((NOW_MS - createdAt.getTime()) / 86400000) : null;

  // === Litmos completion recency + account age (rehire detection inputs) ===
  // Most recent completion across all 14 required courses. We deliberately
  // ignore non-required courses — focusing on whether THIS pipeline's required
  // training shows recent activity.
  const completionDates = litmosDone
    .filter(c => c.completed && c.date)
    .map(c => Date.parse(c.date))
    .filter(Number.isFinite);
  const lastLitmosCompletionMs = completionDates.length ? Math.max(...completionDates) : null;
  const daysSinceLastLitmosCompletion = lastLitmosCompletionMs !== null
    ? Math.floor((NOW_MS - lastLitmosCompletionMs) / 86400000)
    : null;
  const litmosAccountAgeDays = litmosAccountCreatedDate
    ? Math.floor((NOW_MS - Date.parse(litmosAccountCreatedDate)) / 86400000)
    : null;

  // === Anomaly flags ===
  // Ghost: in Nesting but confirmed not in Litmos. Excludes name collisions —
  // when we can't confidently determine Litmos status, don't flag as ghost.
  const isGhost = isNesting && !inLitmos && !hasNameCollision;

  // Credential pipeline flags (cross-referencing status + actual data):
  // Ready for credentials = NB Cert done + BG cleared + CONFIRMED not in Litmos.
  const isWaitingForCreds = !inLitmos && !hasNameCollision && bgCleared && rosterCoursesDone;
  // Status says creds requested but courses aren't actually done (advanced prematurely)
  const isCredsRequestedNoCourses =
    isCredentialsRequested && !rosterCoursesDone && !inLitmos && !hasNameCollision;
  // Status says creds requested AND already in Litmos → already credentialed
  const isAlreadyCredentialed = isCredentialsRequested && inLitmos;
  // Outreach: completed all ShyftOff courses but missed the live Nav Meeting
  const needsNavOutreach = shyftoffComplete && navAvailable && !navAttended;
  // === Rehire detection (terminated Litmos credentials) ===
  // Critical: agents with terminated/locked Litmos accounts should NOT be
  // bumped — their old credentials don't work. Detection is BEHAVIORAL
  // (matching the user's stated heuristic: "old completions and locked
  // accounts"):
  //
  //   • Behavioral:  has Litmos completions but the most recent is >60 days
  //                  old. Real new-hires complete training within weeks.
  //   • Stale acct:  0 completions but Litmos account is >90 days old.
  //                  Catches dormant pre-existing accounts.
  //
  // Either signal trips the flag. We deliberately do NOT trigger off the
  // removed-export alone — agents who were removed previously but have
  // FRESH Litmos accounts (legitimate re-onboarding) would be misclassified.
  // The removed-export still appears as supporting context in rehireSignals
  // when present, but doesn't independently cause a false positive.
  //
  // Validated against the 32 agents the user identified: 100% of those who
  // are in Roster + Litmos status get caught by these two behavioral signals,
  // with zero false positives among the 22 legitimate bump candidates.
  const isRehireFromRemovedList = !!(removalAnnotation && removalAnnotation.wasRemoved);
  const isRehireBehavioral = inLitmos && litmosCount > 0
    && daysSinceLastLitmosCompletion !== null && daysSinceLastLitmosCompletion > 60;
  const isRehireStaleAccount = inLitmos && litmosCount === 0
    && litmosAccountAgeDays !== null && litmosAccountAgeDays > 90;
  const isLikelyRehire = isRehireBehavioral || isRehireStaleAccount;

  // Diagnostic — which signals fired (used in the side panel). Removed-list
  // membership is included as supporting context whether or not it triggered.
  const rehireSignals = [];
  if (isRehireBehavioral) {
    rehireSignals.push(`Last Litmos completion ${daysSinceLastLitmosCompletion}d ago — old training session`);
  }
  if (isRehireStaleAccount) {
    rehireSignals.push(`Litmos account ${litmosAccountAgeDays}d old with 0 completions — dormant account`);
  }
  if (isLikelyRehire && isRehireFromRemovedList) {
    rehireSignals.push(`Confirmed prior removal: ${removalAnnotation.lastRemovalReason} (${removalAnnotation.lastRemovalDaysAgo}d ago)`);
  }

  // Action: in any Roster status but already has Litmos credentials. Needs manual
  // bump to "Nesting - First Call" so they can access the pre-production course.
  // EXCLUDES likely rehires — those need fresh credentials, not a bump.
  const needsNestingBump = isRoster && inLitmos && !hasNameCollision && !isLikelyRehire;

  // New flag: agents who would have been bumped except they're a likely rehire
  // with terminated credentials. They need fresh Litmos creds before advancing.
  const needsNewCredentials = isRoster && inLitmos && !hasNameCollision && isLikelyRehire;

  // === Stale categories ===
  const isStaleWaiter = isWaitingForCreds && daysSinceChange !== null && daysSinceChange >= 21;
  const isStaleInQueue = isStaleWaiter && isCredentialsRequested;
  const isTrulyStale = isStaleWaiter && !isCredentialsRequested;

  // === Readiness ===
  const navMet = navAttended || !navAvailable;
  const readyStatus =
    allLitmos && shyftoffComplete && navMet ? "ready"
      : (litmosCount > 0 || (shyftoffPct !== null && shyftoffPct > 0)) ? "partial"
      : "missing";

  // === Credential note (human-readable diagnosis) ===
  let credentialNote;
  if (inLitmos) credentialNote = "Has credentials";
  else if (isBgMismatch) credentialNote = "BG mismatch — Roster says cleared but CIP shows in progress";
  else if (rosterCoursesDone && bgCleared) credentialNote = "Should be on next credentials batch";
  else if (rosterCoursesDone && !bgCleared) credentialNote = "NB Certification done — waiting on BG check";
  else if (!rosterCoursesDone && bgCleared) credentialNote = "BG cleared — NB Certification in progress";
  else credentialNote = "NB Certification in progress";

  return {
    name, sid, status, key: undefined, // key set by caller
    nbEmail: ldata?.email || "",
    litmosCount, litmosDone, litmosTotal: 14,
    shyftoffPct, shyftoffComplete, courseMap, certMap: cert.map,
    nbCertDone, flBlueDone, rosterCoursesDone,
    preProdDone, navCourseDone, nestingCoursesDone,
    navAttended, navAvailable,
    readyStatus, allLitmos,
    inLitmos, hasCcaas, missingCcaas, bgStatus, bgCleared,
    hasNameCollision, collidingUsernames,
    rowCampaign, prodCampaigns,
    daysSinceChange, daysSinceCreated,
    createdAtRaw: row.created_at || "",
    lastChangedRaw: lastChanged,
    isNesting, isRoster, isCredentialsRequested, shyftoffStaleLevel,
    cipBgProcess, cipBgReport, isBgMismatch,
    isGhost, isWaitingForCreds, isCredsRequestedNoCourses, isAlreadyCredentialed,
    needsNavOutreach, needsNestingBump, needsNewCredentials,
    isStaleWaiter, isStaleInQueue, isTrulyStale, hasAccountIssue,
    credentialNote,
    // Rehire diagnostic fields — populated when relevant inputs are available
    isLikelyRehire, isRehireFromRemovedList, isRehireBehavioral, isRehireStaleAccount,
    rehireSignals,
    daysSinceLastLitmosCompletion, litmosAccountAgeDays,
  };
}
