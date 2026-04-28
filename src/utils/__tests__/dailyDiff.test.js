import { describe, it, expect } from "vitest";
import { computeDailyDiff, buildAgentDigest, DIFF_CATEGORIES } from "../dailyDiff";

// ---- Helpers --------------------------------------------------------------

function makeEntry(date, agents, opts = {}) {
  const map = {};
  agents.forEach(a => { map[a.sid] = a; });
  return {
    date,
    savedAt: new Date(date).getTime(),
    agentSnapshot: {
      agents: map,
      inPipelineSids: opts.inPipelineSids ?? agents.filter(a => !a.inProduction).map(a => a.sid),
      inProductionSids: opts.inProductionSids ?? agents.filter(a => a.inProduction).map(a => a.sid),
    },
  };
}

function agent(sid, overrides = {}) {
  return {
    sid,
    name: `Agent ${sid}`,
    status: "Roster - Credentials Requested",
    litmosCount: 12,
    shyftoffPct: 75,
    bgCleared: true,
    inLitmos: false,
    isGhost: false,
    isBgMismatch: false,
    needsNestingBump: false,
    needsNavOutreach: false,
    readyStatus: "partial",
    ...overrides,
  };
}

// ---- buildAgentDigest -----------------------------------------------------

describe("buildAgentDigest", () => {
  it("builds inPipelineSids from pipeline agents", () => {
    const pipeline = [
      { sid: "S1", name: "A", status: "Roster", litmosCount: 14, shyftoffPct: 100, bgCleared: true, inLitmos: true, readyStatus: "ready" },
      { sid: "S2", name: "B", status: "Nesting", litmosCount: 5, shyftoffPct: 50, bgCleared: false, inLitmos: false, readyStatus: "partial" },
    ];
    const digest = buildAgentDigest(pipeline, []);
    expect(digest.inPipelineSids).toEqual(["S1", "S2"]);
    expect(digest.agents.S1.litmosCount).toBe(14);
    expect(digest.agents.S2.bgCleared).toBe(false);
  });

  it("builds inProductionSids from prod agents", () => {
    const prod = [{ sid: "P1", name: "X" }, { sid: "P2", name: "Y" }];
    const digest = buildAgentDigest([], prod);
    expect(digest.inProductionSids).toEqual(["P1", "P2"]);
    expect(digest.agents.P1.inProduction).toBe(true);
  });

  it("does not overwrite a pipeline entry with a production entry of the same SID", () => {
    // Cross-campaign case — an agent can be in pipeline for ENG and prod for Bilingual.
    const pipeline = [{ sid: "X1", name: "Cross", status: "Roster", litmosCount: 10, shyftoffPct: 75, bgCleared: true, inLitmos: false, readyStatus: "partial" }];
    const prod = [{ sid: "X1", name: "Cross" }];
    const digest = buildAgentDigest(pipeline, prod);
    expect(digest.agents.X1.litmosCount).toBe(10); // pipeline entry preserved
    expect(digest.agents.X1.inProduction).toBeUndefined();
  });

  it("ignores agents without a SID", () => {
    const digest = buildAgentDigest([{ name: "No SID", sid: "" }], []);
    expect(digest.inPipelineSids).toEqual([]);
    expect(Object.keys(digest.agents)).toEqual([]);
  });

  it("coerces flag fields to plain booleans", () => {
    const pipeline = [{ sid: "S1", name: "A", status: "Roster", litmosCount: 0, shyftoffPct: 0,
      bgCleared: undefined, inLitmos: null, isGhost: 0, isBgMismatch: "", needsNestingBump: 1, needsNavOutreach: "yes", readyStatus: "missing" }];
    const d = buildAgentDigest(pipeline, []);
    expect(d.agents.S1.bgCleared).toBe(false);
    expect(d.agents.S1.inLitmos).toBe(false);
    expect(d.agents.S1.isGhost).toBe(false);
    expect(d.agents.S1.isBgMismatch).toBe(false);
    expect(d.agents.S1.needsNestingBump).toBe(true);
    expect(d.agents.S1.needsNavOutreach).toBe(true);
  });
});

// ---- computeDailyDiff -----------------------------------------------------

describe("computeDailyDiff", () => {
  it("returns null when either snapshot is missing", () => {
    expect(computeDailyDiff(null, makeEntry("2026-04-27", []))).toBeNull();
    expect(computeDailyDiff(makeEntry("2026-04-28", []), null)).toBeNull();
  });

  it("flags newToPipeline for SIDs not seen yesterday", () => {
    const prev = makeEntry("2026-04-27", [agent("S1")]);
    const today = makeEntry("2026-04-28", [agent("S1"), agent("S2")]);
    const diff = computeDailyDiff(today, prev);
    expect(diff.newToPipeline.count).toBe(1);
    expect(diff.newToPipeline.agents[0].sid).toBe("S2");
  });

  it("flags newToProduction when an agent disappears from pipeline AND appears in production set", () => {
    const prev = makeEntry("2026-04-27", [agent("S1")]);
    const today = makeEntry("2026-04-28", [], { inProductionSids: ["S1"], inPipelineSids: [] });
    const diff = computeDailyDiff(today, prev);
    expect(diff.newToProduction.count).toBe(1);
    expect(diff.newToProduction.agents[0].sid).toBe("S1");
    expect(diff.leftPipeline.count).toBe(0); // moved to prod, not "left"
  });

  it("flags leftPipeline when an agent disappears without showing up in production", () => {
    const prev = makeEntry("2026-04-27", [agent("S1")]);
    const today = makeEntry("2026-04-28", []);
    const diff = computeDailyDiff(today, prev);
    expect(diff.leftPipeline.count).toBe(1);
    expect(diff.newToProduction.count).toBe(0);
  });

  it("flags completedLitmos when count crosses 14", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { litmosCount: 12 })]);
    const today = makeEntry("2026-04-28", [agent("S1", { litmosCount: 14 })]);
    const diff = computeDailyDiff(today, prev);
    expect(diff.completedLitmos.count).toBe(1);
    expect(diff.completedLitmos.agents[0]).toMatchObject({ sid: "S1", before: 12, after: 14 });
  });

  it("does not flag completedLitmos when already at 14 yesterday", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { litmosCount: 14 })]);
    const today = makeEntry("2026-04-28", [agent("S1", { litmosCount: 14 })]);
    expect(computeDailyDiff(today, prev).completedLitmos.count).toBe(0);
  });

  it("flags completedShyftoff when % crosses 100", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { shyftoffPct: 75 })]);
    const today = makeEntry("2026-04-28", [agent("S1", { shyftoffPct: 100 })]);
    expect(computeDailyDiff(today, prev).completedShyftoff.count).toBe(1);
  });

  it("flags gotCredentials when inLitmos toggles false → true", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { inLitmos: false })]);
    const today = makeEntry("2026-04-28", [agent("S1", { inLitmos: true })]);
    expect(computeDailyDiff(today, prev).gotCredentials.count).toBe(1);
  });

  it("flags bgCleared when bgCleared toggles false → true", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { bgCleared: false })]);
    const today = makeEntry("2026-04-28", [agent("S1", { bgCleared: true })]);
    expect(computeDailyDiff(today, prev).bgCleared.count).toBe(1);
  });

  it("flags newReady when readyStatus becomes 'ready'", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { readyStatus: "partial" })]);
    const today = makeEntry("2026-04-28", [agent("S1", { readyStatus: "ready" })]);
    expect(computeDailyDiff(today, prev).newReady.count).toBe(1);
  });

  it("flags statusChanges when status text changes", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { status: "Roster - Credentials Requested" })]);
    const today = makeEntry("2026-04-28", [agent("S1", { status: "Nesting - First Call" })]);
    const diff = computeDailyDiff(today, prev);
    expect(diff.statusChanges.count).toBe(1);
    expect(diff.statusChanges.agents[0].before).toBe("Roster - Credentials Requested");
    expect(diff.statusChanges.agents[0].after).toBe("Nesting - First Call");
  });

  it("flags newIssues when an issue flag turns on", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { isGhost: false })]);
    const today = makeEntry("2026-04-28", [agent("S1", { isGhost: true })]);
    const diff = computeDailyDiff(today, prev);
    expect(diff.newIssues.count).toBe(1);
    expect(diff.newIssues.agents[0].flag).toBe("isGhost");
  });

  it("flags resolvedIssues when an issue flag turns off", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { isBgMismatch: true })]);
    const today = makeEntry("2026-04-28", [agent("S1", { isBgMismatch: false })]);
    expect(computeDailyDiff(today, prev).resolvedIssues.count).toBe(1);
  });

  it("counts multiple flag transitions on the same agent independently", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { isGhost: true, needsNestingBump: false })]);
    const today = makeEntry("2026-04-28", [agent("S1", { isGhost: false, needsNestingBump: true })]);
    const diff = computeDailyDiff(today, prev);
    expect(diff.resolvedIssues.count).toBe(1);
    expect(diff.newIssues.count).toBe(1);
  });

  it("totalChanges sums across all categories", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { litmosCount: 12, shyftoffPct: 75, isGhost: true })]);
    const today = makeEntry("2026-04-28", [agent("S1", { litmosCount: 14, shyftoffPct: 100, isGhost: false }), agent("S2")]);
    const diff = computeDailyDiff(today, prev);
    // newToPipeline: 1 (S2), completedLitmos: 1, completedShyftoff: 1, resolvedIssues: 1
    expect(diff.totalChanges).toBeGreaterThanOrEqual(4);
  });

  it("falls back to basic SID-only diff when agents map is missing", () => {
    // Old history entry shape
    const prev = { date: "2026-04-27", agentSnapshot: { inPipelineSids: ["S1"], inProductionSids: [] } };
    const today = { date: "2026-04-28", agentSnapshot: { inPipelineSids: ["S1", "S2"], inProductionSids: [] } };
    const diff = computeDailyDiff(today, prev);
    expect(diff._basic).toBe(true);
    expect(diff.newToPipeline.count).toBe(1);
    expect(diff.completedLitmos.count).toBe(0); // can't compute from basic
  });

  it("does not flag status change when one side is empty (avoid noise)", () => {
    const prev = makeEntry("2026-04-27", [agent("S1", { status: "" })]);
    const today = makeEntry("2026-04-28", [agent("S1", { status: "Nesting - First Call" })]);
    expect(computeDailyDiff(today, prev).statusChanges.count).toBe(0);
  });
});

// ---- DIFF_CATEGORIES contract ---------------------------------------------

describe("DIFF_CATEGORIES", () => {
  it("every category key exists on the diff result shape", () => {
    const prev = makeEntry("2026-04-27", [agent("S1")]);
    const today = makeEntry("2026-04-28", [agent("S1")]);
    const diff = computeDailyDiff(today, prev);
    DIFF_CATEGORIES.forEach(cat => {
      expect(diff[cat.key]).toBeDefined();
      expect(diff[cat.key].count).toBeDefined();
      expect(Array.isArray(diff[cat.key].agents)).toBe(true);
    });
  });

  it("each category has a label, icon, and color", () => {
    DIFF_CATEGORIES.forEach(cat => {
      expect(cat.label).toBeTruthy();
      expect(cat.icon).toBeTruthy();
      expect(cat.color).toBeTruthy();
    });
  });
});
