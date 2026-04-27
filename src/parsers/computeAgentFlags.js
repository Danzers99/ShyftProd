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
  } = context;

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
  const now = new Date();
  const daysSinceChange = changedAt ? Math.floor((now - changedAt) / 86400000) : null;
  const daysSinceCreated = createdAt ? Math.floor((now - createdAt) / 86400000) : null;

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
  // Action: in any Roster status but already has Litmos credentials. Needs manual
  // bump to "Nesting - First Call" so they can access the pre-production course.
  const needsNestingBump = isRoster && inLitmos && !hasNameCollision;

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
    needsNavOutreach, needsNestingBump,
    isStaleWaiter, isStaleInQueue, isTrulyStale, hasAccountIssue,
    credentialNote,
  };
}
