/**
 * Deduplicate raw CIP/Roster/Nesting rows by ShyftOff ID.
 *
 * The user uploads multiple files into the CIP slot — typically a CIP export
 * AND Roster + Nesting exports. The same agent often appears in multiple files,
 * each with a slightly different shape:
 *
 * - CIP export: detailed BG JSON (process_status/report_status), JSON cert_progress
 * - Roster/Nesting: simple BG string ("cleared"/"pending"), integer cert_progress (more accurate)
 *
 * Merge strategy when an SID appears in multiple rows:
 * - background_check (CIP JSON): keep the one with non-null process_status
 * - background_check_status (simple): keep any non-empty value (Roster authoritative)
 * - stale_level: Roster/Nesting only
 * - certification_progress: ALWAYS prefer integer (Roster/Nesting accurate) over JSON (CIP unreliable)
 *
 * Returns a deduplicated array of merged rows.
 */
export function dedupCipData(cipData) {
  const seenSids = new Map();
  for (const row of cipData || []) {
    const sid = (row.shyftoff_id || "").trim();
    if (!sid) continue;

    if (!seenSids.has(sid)) {
      seenSids.set(sid, { ...row });
      continue;
    }

    const existing = seenSids.get(sid);

    // BG JSON: keep the one with actual process_status data
    if (row.background_check) {
      if (!existing.background_check) {
        existing.background_check = row.background_check;
      } else {
        // Both have BG JSON — prefer the one with non-null process_status
        try {
          const inArr = JSON.parse(row.background_check);
          const exArr = JSON.parse(existing.background_check);
          const inPs = inArr?.[0]?.process_status || "";
          const exPs = exArr?.[0]?.process_status || "";
          if (inPs && !exPs) existing.background_check = row.background_check;
        } catch {}
      }
    }

    // Simple BG status: keep first non-empty value (Roster source)
    if (row.background_check_status && !existing.background_check_status) {
      existing.background_check_status = row.background_check_status;
    }

    // Stale level from Roster/Nesting
    if (row.stale_level && !existing.stale_level) {
      existing.stale_level = row.stale_level;
    }

    // Cert progress: prefer Roster/Nesting integer over CIP JSON
    if (row.certification_progress) {
      const incoming = row.certification_progress.trim();
      const existingCert = (existing.certification_progress || "").trim();
      const incomingIsInteger = incoming.match(/^\d+$/);
      const existingIsInteger = existingCert.match(/^\d+$/);
      if (incomingIsInteger && !existingIsInteger) {
        existing.certification_progress = row.certification_progress;
      } else if (!existingCert) {
        existing.certification_progress = row.certification_progress;
      }
    }

    // Prefer Roster/Nesting agent_name if CIP didn't have one
    if (row.agent_name && !existing.agent_name) {
      existing.agent_name = row.agent_name;
    }
  }
  return [...seenSids.values()];
}
