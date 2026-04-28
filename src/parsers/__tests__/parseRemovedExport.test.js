import { describe, it, expect } from "vitest";
import {
  parseRemovalReason,
  categorizeRemoval,
  buildRemovalHistoryMap,
  annotateAgentRemoval,
} from "../parseRemovedExport";

// Fixed "today" for deterministic tests
const TODAY = Date.parse("2026-04-28T12:00:00Z");

function row(sid, status, dateOffset, campaign = "Nations Benefits") {
  // dateOffset is days ago — negative for past
  const date = new Date(TODAY + dateOffset * 86400000).toISOString();
  return {
    shyftoff_id: sid,
    status,
    status_updated_at: date,
    campaign_nm: campaign,
  };
}

// ---- parseRemovalReason ---------------------------------------------------

describe("parseRemovalReason", () => {
  it("strips 'Removed - ' prefix", () => {
    expect(parseRemovalReason("Removed - Certification Stale")).toBe("Certification Stale");
    expect(parseRemovalReason("Removed - Performance")).toBe("Performance");
    expect(parseRemovalReason("Removed - OptIn")).toBe("OptIn");
  });

  it("returns 'Removed' for plain Removed status", () => {
    expect(parseRemovalReason("Removed")).toBe("Removed");
  });

  it("handles em-dash variant", () => {
    expect(parseRemovalReason("Removed – Performance")).toBe("Performance");
  });

  it("is case-insensitive at the prefix", () => {
    expect(parseRemovalReason("removed - resigned")).toBe("resigned");
    expect(parseRemovalReason("REMOVED - PERFORMANCE")).toBe("PERFORMANCE");
  });

  it("returns null for non-removal statuses", () => {
    expect(parseRemovalReason("Roster - Credentials Requested")).toBeNull();
    expect(parseRemovalReason("Production")).toBeNull();
    expect(parseRemovalReason("")).toBeNull();
    expect(parseRemovalReason(null)).toBeNull();
    expect(parseRemovalReason(undefined)).toBeNull();
  });
});

// ---- categorizeRemoval ----------------------------------------------------

describe("categorizeRemoval", () => {
  it("buckets Performance and Production Stale as 'performance'", () => {
    expect(categorizeRemoval("Performance")).toBe("performance");
    expect(categorizeRemoval("Production Stale")).toBe("performance");
  });

  it("buckets Certification Stale as 'stale'", () => {
    expect(categorizeRemoval("Certification Stale")).toBe("stale");
  });

  it("buckets OptIn / Resigned as 'voluntary'", () => {
    expect(categorizeRemoval("OptIn")).toBe("voluntary");
    expect(categorizeRemoval("Opt-In")).toBe("voluntary");
    expect(categorizeRemoval("Resigned")).toBe("voluntary");
  });

  it("buckets ShyftOff Removal as 'ops'", () => {
    expect(categorizeRemoval("ShyftOff Removal")).toBe("ops");
  });

  it("unknown / plain Removed → 'other'", () => {
    expect(categorizeRemoval("Removed")).toBe("other");
    expect(categorizeRemoval("Some Future Reason")).toBe("other");
  });

  it("null → null (not 'other')", () => {
    expect(categorizeRemoval(null)).toBeNull();
    expect(categorizeRemoval("")).toBeNull();
  });
});

// ---- buildRemovalHistoryMap ----------------------------------------------

describe("buildRemovalHistoryMap", () => {
  it("returns empty map for no rows", () => {
    const r = buildRemovalHistoryMap([]);
    expect(r.bySid.size).toBe(0);
    expect(r.removedTodaySids.size).toBe(0);
  });

  it("returns empty map for null rows", () => {
    const r = buildRemovalHistoryMap(null);
    expect(r.bySid.size).toBe(0);
  });

  it("groups multiple removals under the same SID", () => {
    const rows = [
      row("S1", "Removed - OptIn", -10),
      row("S1", "Removed - Performance", -100),
      row("S2", "Removed - Resigned", -5),
    ];
    const r = buildRemovalHistoryMap(rows, { now: TODAY });
    expect(r.bySid.size).toBe(2);
    expect(r.bySid.get("S1")).toHaveLength(2);
    expect(r.bySid.get("S2")).toHaveLength(1);
  });

  it("sorts each SID's history newest-first", () => {
    const rows = [
      row("S1", "Removed - Performance", -200),  // older
      row("S1", "Removed - OptIn", -10),         // newer
      row("S1", "Removed - Resigned", -50),      // middle
    ];
    const r = buildRemovalHistoryMap(rows, { now: TODAY, withinDays: 365 });
    const list = r.bySid.get("S1");
    expect(list[0].reason).toBe("OptIn");
    expect(list[1].reason).toBe("Resigned");
    expect(list[2].reason).toBe("Performance");
  });

  it("filters to last 180 days by default", () => {
    const rows = [
      row("S1", "Removed - Performance", -10),    // recent
      row("S2", "Removed - Performance", -181),   // just over the line
      row("S3", "Removed - Performance", -179),   // just under the line
    ];
    const r = buildRemovalHistoryMap(rows, { now: TODAY });
    expect(r.bySid.has("S1")).toBe(true);
    expect(r.bySid.has("S2")).toBe(false);
    expect(r.bySid.has("S3")).toBe(true);
  });

  it("respects custom withinDays", () => {
    const rows = [
      row("S1", "Removed - Performance", -10),
      row("S2", "Removed - Performance", -45),
    ];
    const r = buildRemovalHistoryMap(rows, { now: TODAY, withinDays: 30 });
    expect(r.bySid.has("S1")).toBe(true);
    expect(r.bySid.has("S2")).toBe(false);
  });

  it("includes everything when withinDays is 0 or Infinity", () => {
    const rows = [
      row("S1", "Removed - Performance", -10),
      row("S2", "Removed - Performance", -2000),
    ];
    expect(buildRemovalHistoryMap(rows, { now: TODAY, withinDays: 0 }).bySid.size).toBe(2);
    expect(buildRemovalHistoryMap(rows, { now: TODAY, withinDays: Infinity }).bySid.size).toBe(2);
  });

  it("skips rows missing SID, status, or date", () => {
    const rows = [
      { shyftoff_id: "", status: "Removed - X", status_updated_at: new Date(TODAY).toISOString() },
      { shyftoff_id: "S1", status: "", status_updated_at: new Date(TODAY).toISOString() },
      { shyftoff_id: "S2", status: "Removed - Performance", status_updated_at: "not a date" },
    ];
    const r = buildRemovalHistoryMap(rows, { now: TODAY });
    expect(r.bySid.size).toBe(0);
  });

  it("ignores non-Removed statuses (defensive — caller may dump CIP data)", () => {
    const rows = [
      row("S1", "Roster - Credentials Requested", -10),
      row("S2", "Nesting - First Call", -10),
      row("S3", "Removed - Performance", -10),
    ];
    const r = buildRemovalHistoryMap(rows, { now: TODAY });
    expect(r.bySid.size).toBe(1);
    expect(r.bySid.has("S3")).toBe(true);
  });

  it("deduplicates identical removal events (same date + reason + campaign)", () => {
    const rows = [
      row("S1", "Removed - Performance", -10, "Nations Benefits"),
      row("S1", "Removed - Performance", -10, "Nations Benefits"), // dup
      row("S1", "Removed - Performance", -10, "Nations Benefits Bilingual"), // different campaign
    ];
    const r = buildRemovalHistoryMap(rows, { now: TODAY });
    expect(r.bySid.get("S1")).toHaveLength(2);
  });

  it("flags removedTodaySids when date matches today", () => {
    const rows = [
      row("S1", "Removed - Performance", 0),    // today
      row("S2", "Removed - OptIn", -1),         // yesterday
    ];
    const r = buildRemovalHistoryMap(rows, { now: TODAY });
    expect(r.removedTodaySids.has("S1")).toBe(true);
    expect(r.removedTodaySids.has("S2")).toBe(false);
  });

  it("preserves campaign on each entry", () => {
    const rows = [row("S1", "Removed - Performance", -10, "Nations Benefits Bilingual")];
    const r = buildRemovalHistoryMap(rows, { now: TODAY });
    expect(r.bySid.get("S1")[0].campaign).toBe("Nations Benefits Bilingual");
  });

  it("computes daysAgo correctly", () => {
    const rows = [row("S1", "Removed - Performance", -7)];
    const r = buildRemovalHistoryMap(rows, { now: TODAY });
    expect(r.bySid.get("S1")[0].daysAgo).toBe(7);
  });
});

// ---- annotateAgentRemoval -------------------------------------------------

describe("annotateAgentRemoval", () => {
  it("returns null for SIDs not in the map", () => {
    const map = buildRemovalHistoryMap([], { now: TODAY });
    expect(annotateAgentRemoval(map, "S1")).toBeNull();
  });

  it("returns null when historyMap is missing", () => {
    expect(annotateAgentRemoval(null, "S1")).toBeNull();
    expect(annotateAgentRemoval(undefined, "S1")).toBeNull();
  });

  it("annotates with last removal data", () => {
    const map = buildRemovalHistoryMap([
      row("S1", "Removed - Certification Stale", -50),
      row("S1", "Removed - Performance", -200),
    ], { now: TODAY, withinDays: 365 });
    const ann = annotateAgentRemoval(map, "S1");
    expect(ann.wasRemoved).toBe(true);
    expect(ann.removalCount).toBe(2);
    expect(ann.lastRemovalReason).toBe("Certification Stale");
    expect(ann.lastRemovalDaysAgo).toBe(50);
    expect(ann.previouslyInProd).toBe(true); // had a Performance removal historically
  });

  it("flags previouslyInProd when any removal was Production Stale or Performance", () => {
    const map = buildRemovalHistoryMap([
      row("S1", "Removed - OptIn", -5),
      row("S1", "Removed - Production Stale", -100),
    ], { now: TODAY, withinDays: 365 });
    expect(annotateAgentRemoval(map, "S1").previouslyInProd).toBe(true);
  });

  it("does NOT flag previouslyInProd when only voluntary/stale removals exist", () => {
    const map = buildRemovalHistoryMap([
      row("S1", "Removed - OptIn", -5),
      row("S1", "Removed - Certification Stale", -100),
    ], { now: TODAY, withinDays: 365 });
    expect(annotateAgentRemoval(map, "S1").previouslyInProd).toBe(false);
  });

  it("buckets recencyTier correctly", () => {
    const r1 = buildRemovalHistoryMap([row("S1", "Removed - Performance", -10)], { now: TODAY });
    const r2 = buildRemovalHistoryMap([row("S2", "Removed - Performance", -60)], { now: TODAY });
    const r3 = buildRemovalHistoryMap([row("S3", "Removed - Performance", -150)], { now: TODAY });
    expect(annotateAgentRemoval(r1, "S1").recencyTier).toBe("recent");
    expect(annotateAgentRemoval(r2, "S2").recencyTier).toBe("near");
    expect(annotateAgentRemoval(r3, "S3").recencyTier).toBe("older");
  });

  it("removalHistory in annotation matches the map's array", () => {
    const map = buildRemovalHistoryMap([
      row("S1", "Removed - OptIn", -5),
      row("S1", "Removed - Performance", -100),
    ], { now: TODAY, withinDays: 365 });
    const ann = annotateAgentRemoval(map, "S1");
    expect(ann.removalHistory).toEqual(map.bySid.get("S1"));
  });
});
