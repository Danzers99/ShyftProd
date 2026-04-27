// Schema validation — detect what kind of CSV file the user uploaded
// based on column headers. Catches the case of dragging a Roster file
// into the Litmos slot, etc.
//
// Returns one of:
//   { kind: "litmos-course", label: "Litmos Course Data" }
//   { kind: "litmos-people", label: "Litmos People Report" }
//   { kind: "cip", label: "CIP Export" }
//   { kind: "roster", label: "Roster Agents" }
//   { kind: "nesting", label: "Nesting Agents" }
//   { kind: "production", label: "Production Agents (simple)" }
//   { kind: "production-export", label: "Production Export (JSON)" }
//   { kind: "shyftnav", label: "ShyftNav Export" }
//   { kind: "unknown", label: "Unknown format" }

const SIGNATURES = [
  {
    kind: "litmos-course",
    label: "Litmos Course Data",
    matchesAll: ["People.First Name", "People.Last Name", "Course.Title", "Course User Results.Completed"],
  },
  {
    kind: "litmos-people",
    label: "Litmos People Report",
    matchesAll: ["People.First Name", "People.Last Name", "People.Username"],
    matchesNone: ["Course.Title"],
  },
  {
    kind: "production-export",
    label: "Production Export (JSON cert progress)",
    matchesAll: ["shyftoff_id", "campaign_application_id", "background_check", "certification_progress"],
    requiresStatus: "Production",
  },
  {
    kind: "cip",
    label: "CIP Export",
    matchesAll: ["shyftoff_id", "campaign_application_id", "background_check", "certification_progress"],
  },
  {
    kind: "production",
    label: "Production Agents",
    matchesAll: ["so_agent_id", "agent_campaign_status", "background_check_status"],
  },
  {
    kind: "roster",
    label: "Roster Agents",
    matchesAll: ["shyftoff_id", "agent_name", "background_check_status", "certification_progress"],
    requiresStatusContains: "Roster",
  },
  {
    kind: "nesting",
    label: "Nesting Agents",
    matchesAll: ["shyftoff_id", "agent_name", "background_check_status", "certification_progress"],
    requiresStatusContains: "Nesting",
  },
  {
    kind: "shyftnav",
    label: "ShyftNav Export",
    matchesAny: ["Did the Agent Attend?", "Meeting Date", "Agent's Self-Reported Readiness"],
  },
];

// Slot → expected kinds map. Used to surface mismatches.
export const SLOT_EXPECTATIONS = {
  litmos: ["litmos-course"],
  people: ["litmos-people"],
  cip: ["cip", "roster", "nesting", "production-export"],
  prod: ["production", "production-export"],
  nav: ["shyftnav"],
};

/**
 * Identify a CSV file type by inspecting its headers and (optionally) first row.
 * @param {string[]} headers - Header row from parseCSV
 * @param {object} firstRow - First data row (object form)
 */
export function identifyFile(headers, firstRow) {
  const headerSet = new Set(headers.map(h => h.trim()));

  for (const sig of SIGNATURES) {
    let match = true;

    if (sig.matchesAll && !sig.matchesAll.every(c => headerSet.has(c))) match = false;
    if (sig.matchesAny && !sig.matchesAny.some(c => headerSet.has(c))) match = false;
    if (sig.matchesNone && sig.matchesNone.some(c => headerSet.has(c))) match = false;

    if (match && sig.requiresStatus && firstRow) {
      const status = (firstRow.status || firstRow.agent_campaign_status || "").trim();
      if (status !== sig.requiresStatus) match = false;
    }
    if (match && sig.requiresStatusContains && firstRow) {
      const status = (firstRow.status || "").toLowerCase();
      if (!status.includes(sig.requiresStatusContains.toLowerCase())) match = false;
    }

    if (match) return { kind: sig.kind, label: sig.label };
  }

  return { kind: "unknown", label: "Unknown format" };
}

/**
 * Check if a detected kind is compatible with a slot.
 * Returns null if compatible, error message string if not.
 */
export function validateSlot(slotKey, detectedKind) {
  const expected = SLOT_EXPECTATIONS[slotKey] || [];
  if (detectedKind === "unknown") return "Unknown format — not sure what this is";
  if (!expected.includes(detectedKind)) {
    return `Looks like a different file type than expected for this slot`;
  }
  return null;
}
