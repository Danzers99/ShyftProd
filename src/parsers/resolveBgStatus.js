/**
 * Resolve background check status from a CIP/Roster row.
 *
 * Two formats coexist in our data:
 *
 * 1. Simple string field `background_check_status` (Roster/Nesting exports):
 *    "cleared", "pending", "created", etc.
 *
 * 2. JSON array field `background_check` (CIP/production-export):
 *    [{ "process_status": "PASSED|IN_PROGRESS|FAILED_FORBIDDEN_TO_RESTART",
 *       "report_status": "clear|proceed|pending|processing|consider|created|final_adverse" }]
 *
 * The challenge: these sources can DISAGREE. Roster says "cleared" but CIP shows
 * IN_PROGRESS — that's the cross-source mismatch we need to surface.
 *
 * BG is considered cleared if ANY of:
 *   - CIP process_status === "PASSED"
 *   - CIP report_status is "clear" or "proceed" (the actual BG result)
 *   - Simple status is "cleared" AND CIP doesn't contradict it
 *
 * BG mismatch is detected when:
 *   - Simple status says "cleared" AND CIP shows IN_PROGRESS with non-clear report
 *   - This catches the systemic data sync issue between Roster and CIP
 *
 * @returns { bgStatus, bgCleared, cipBgProcess, cipBgReport, isBgMismatch, hasAccountIssue }
 */
export function resolveBgStatus(row) {
  let bgStatus = (row.background_check_status || "").trim().toLowerCase();
  let cipBgProcess = "";
  let cipBgReport = "";

  const bgJson = (row.background_check || "").trim();
  if (bgJson.startsWith("[")) {
    try {
      const arr = JSON.parse(bgJson);
      if (arr.length > 0) {
        cipBgProcess = (arr[0].process_status || "").toUpperCase();
        cipBgReport = (arr[0].report_status || "").toLowerCase();
      }
    } catch {
      // Malformed JSON — leave fields empty
    }
  }

  // If no simple status but CIP JSON exists, derive a status string from it
  if (!bgStatus && cipBgProcess) {
    bgStatus = cipBgProcess === "PASSED" ? "cleared" : cipBgReport || cipBgProcess.toLowerCase();
  }

  const bgReportClear = cipBgReport === "clear" || cipBgReport === "proceed";
  const cipContradicts = cipBgProcess === "IN_PROGRESS" && !bgReportClear && cipBgProcess !== "";
  const bgCleared =
    cipBgProcess === "PASSED" ||
    bgReportClear ||
    (bgStatus === "cleared" && !cipContradicts);

  // Cross-source mismatch: Roster's simple field says cleared but CIP JSON contradicts
  const simpleBgClearedRaw = (row.background_check_status || "").trim().toLowerCase() === "cleared";
  const cipBgNotCleared = cipBgProcess === "IN_PROGRESS" && !bgReportClear;
  const isBgMismatch = simpleBgClearedRaw && cipBgNotCleared;

  // Genuine account issue: BG not cleared by ANY source AND not a known mismatch
  const hasAccountIssue = !bgCleared && bgStatus !== "" && !isBgMismatch;

  return { bgStatus, bgCleared, cipBgProcess, cipBgReport, isBgMismatch, hasAccountIssue };
}
