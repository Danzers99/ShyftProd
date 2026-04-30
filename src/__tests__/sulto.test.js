import { describe, it, expect } from "vitest";
import {
  deriveCampaign,
  deriveStage,
  annotateAgentForSulto,
  buildIssuesPayload,
  buildSnapshotPayload,
} from "../sulto";

// ---- Helpers --------------------------------------------------------------

function pipelineAgent(overrides = {}) {
  return {
    name: "Agent A",
    sid: "S1",
    status: "Roster - Credentials Requested",
    rowCampaign: "Nations Benefits",
    isProd: false,
    isPhase2Training: false,
    isNesting: false,
    isRoster: true,
    readyStatus: "partial",
    isGhost: false,
    isBgMismatch: false,
    hasAccountIssue: false,
    isTrulyStale: false,
    isStaleInQueue: false,
    isStaleWaiter: false,
    hasNameCollision: false,
    collidingUsernames: [],
    needsNestingBump: false,
    needsNewCredentials: false,
    removedTodayInProd: false,
    bgStatus: "cleared",
    cipBgProcess: "",
    daysSinceChange: 5,
    rehireSignals: [],
    ...overrides,
  };
}

function prodAgent(overrides = {}) {
  return {
    name: "Prod B",
    sid: "P1",
    status: "Production",
    isProd: true,
    prodCampaigns: ["Nations Benefits"],
    removedTodayInProd: false,
    ...overrides,
  };
}

// ---- deriveCampaign ------------------------------------------------------

describe("deriveCampaign", () => {
  it("returns Bilingual for pipeline rows tagged as Bilingual", () => {
    expect(deriveCampaign(pipelineAgent({ rowCampaign: "Nations Benefits Bilingual" }))).toBe("Bilingual");
  });

  it("returns ENG for plain Nations Benefits", () => {
    expect(deriveCampaign(pipelineAgent({ rowCampaign: "Nations Benefits" }))).toBe("ENG");
  });

  it("uses prodCampaigns for production agents", () => {
    expect(deriveCampaign(prodAgent({ prodCampaigns: ["Nations Benefits Bilingual"] }))).toBe("Bilingual");
    expect(deriveCampaign(prodAgent({ prodCampaigns: ["Nations Benefits"] }))).toBe("ENG");
  });

  it("returns Bilingual for prod agents in BOTH campaigns (prefers Bilingual signal)", () => {
    expect(deriveCampaign(prodAgent({ prodCampaigns: ["Nations Benefits", "Nations Benefits Bilingual"] }))).toBe("Bilingual");
  });

  it("falls back to ENG when no campaign signal", () => {
    expect(deriveCampaign(pipelineAgent({ rowCampaign: "" }))).toBe("ENG");
    expect(deriveCampaign(prodAgent({ prodCampaigns: [] }))).toBe("ENG");
  });
});

// ---- deriveStage ---------------------------------------------------------

describe("deriveStage", () => {
  it("Production wins for prod agents", () => {
    expect(deriveStage(prodAgent())).toBe("Production");
  });

  it("Phase 2 Training takes precedence over generic Nesting", () => {
    // Phase 2 agents have isNesting=true (post-Sprint 7 logic) but should
    // surface as their own stage so the receiver can distinguish them.
    expect(deriveStage(pipelineAgent({ isPhase2Training: true, isNesting: true, isRoster: false }))).toBe("Phase 2 Training");
  });

  it("Nesting for plain Nesting agents", () => {
    expect(deriveStage(pipelineAgent({ isNesting: true, isRoster: false }))).toBe("Nesting");
  });

  it("Roster for plain Roster agents", () => {
    expect(deriveStage(pipelineAgent({ isRoster: true, isNesting: false }))).toBe("Roster");
  });

  it("Falls back to status string for Pre-Roster / unrecognized stages", () => {
    expect(deriveStage(pipelineAgent({
      status: "Pre-Roster - Phase 1 Training",
      isRoster: true, // matches "roster" substring
      isNesting: false,
      isPhase2Training: false,
    }))).toBe("Roster"); // current logic — Pre-Roster contains "roster"
  });
});

// ---- annotateAgentForSulto -----------------------------------------------

describe("annotateAgentForSulto", () => {
  it("emits the canonical fields", () => {
    const a = annotateAgentForSulto(pipelineAgent({ readyStatus: "ready", rowCampaign: "Nations Benefits Bilingual" }));
    expect(a).toMatchObject({
      name: "Agent A",
      sid: "S1",
      campaign: "Bilingual",
      stage: "Roster",
      readyEng: false,
      readyBi: true,
    });
  });

  it("readyEng is mutually exclusive with readyBi", () => {
    const eng = annotateAgentForSulto(pipelineAgent({ readyStatus: "ready" }));
    expect(eng.readyEng).toBe(true);
    expect(eng.readyBi).toBe(false);
  });

  it("production agents are never readyEng/readyBi (they're already past ready)", () => {
    const a = annotateAgentForSulto(prodAgent());
    expect(a.readyEng).toBe(false);
    expect(a.readyBi).toBe(false);
  });

  it("normalizes flag fields to plain booleans", () => {
    const a = annotateAgentForSulto(pipelineAgent({
      isGhost: 0,
      isBgMismatch: undefined,
      needsNestingBump: 1,
      needsNewCredentials: "yes",
    }));
    expect(a.isGhost).toBe(false);
    expect(a.hasBgMismatch).toBe(false);
    expect(a.needsNestingBump).toBe(true);
    expect(a.needsNewCredentials).toBe(true);
  });
});

// ---- buildIssuesPayload --------------------------------------------------

describe("buildIssuesPayload", () => {
  it("emits one issue per flag set on an agent", () => {
    const a = pipelineAgent({ isGhost: true, isBgMismatch: true, needsNestingBump: true, cipBgProcess: "in progress" });
    const issues = buildIssuesPayload([a]);
    expect(issues).toHaveLength(3);
    expect(issues.map(i => i.issue_type).sort()).toEqual(["BG Mismatch", "Ghost", "Needs Nesting Bump"]);
  });

  it("attaches campaign + stage to every issue row", () => {
    const a = pipelineAgent({ isGhost: true, rowCampaign: "Nations Benefits Bilingual" });
    const issues = buildIssuesPayload([a]);
    expect(issues[0]).toMatchObject({
      agent_sid: "S1",
      agent_name: "Agent A",
      campaign: "Bilingual",
      stage: "Roster",
    });
  });

  it("includes the new Needs New Credentials issue with rehireSignals detail", () => {
    const a = pipelineAgent({
      needsNewCredentials: true,
      rehireSignals: ["Old Litmos account (240d ago)", "Stuck in Roster (45d)"],
    });
    const issues = buildIssuesPayload([a]);
    expect(issues).toHaveLength(1);
    expect(issues[0].issue_type).toBe("Needs New Credentials");
    expect(issues[0].detail).toContain("Old Litmos account");
  });

  it("emits Data Conflict for production agents flagged as removed-today-in-prod", () => {
    const a = prodAgent({ removedTodayInProd: true });
    const issues = buildIssuesPayload([a]);
    expect(issues).toHaveLength(1);
    expect(issues[0].issue_type).toBe("Data Conflict");
    expect(issues[0].stage).toBe("Production");
  });

  it("returns empty array when no agents have any issue flags", () => {
    expect(buildIssuesPayload([pipelineAgent()])).toEqual([]);
  });
});

// ---- buildSnapshotPayload ------------------------------------------------

describe("buildSnapshotPayload", () => {
  it("produces the v1 schema envelope", () => {
    const p = buildSnapshotPayload([pipelineAgent()], [prodAgent()]);
    expect(p.schema).toBe("shyftprod-snapshot/v1");
    expect(p.campaign).toBe("NationsBenefits");
    expect(typeof p.ts).toBe("string");
    expect(p.agents).toHaveLength(2);
  });

  it("stats counts match agent annotations", () => {
    const agents = [
      pipelineAgent({ readyStatus: "ready", rowCampaign: "Nations Benefits" }),         // readyEng
      pipelineAgent({ readyStatus: "ready", rowCampaign: "Nations Benefits Bilingual" }), // readyBi
      pipelineAgent({ isGhost: true }),
      pipelineAgent({ needsNestingBump: true }),
      pipelineAgent({ needsNewCredentials: true }),
    ];
    const p = buildSnapshotPayload(agents, []);
    expect(p.stats.total_agents).toBe(5);
    expect(p.stats.ready_eng).toBe(1);
    expect(p.stats.ready_bi).toBe(1);
    expect(p.stats.ghosts).toBe(1);
    expect(p.stats.needs_nesting_bump).toBe(1);
    expect(p.stats.needs_new_creds).toBe(1);
  });

  it("issues array is normalized — one entry per (agent, issue)", () => {
    const a = pipelineAgent({ isGhost: true, isBgMismatch: true });
    const p = buildSnapshotPayload([a], []);
    expect(p.issues).toHaveLength(2);
    expect(new Set(p.issues.map(i => i.issue_type))).toEqual(new Set(["Ghost", "BG Mismatch"]));
  });

  it("handles empty inputs gracefully", () => {
    const p = buildSnapshotPayload([], []);
    expect(p.agents).toEqual([]);
    expect(p.issues).toEqual([]);
    expect(p.stats.total_agents).toBe(0);
  });

  it("handles null inputs gracefully (defensive)", () => {
    const p = buildSnapshotPayload(null, null);
    expect(p.agents).toEqual([]);
    expect(p.issues).toEqual([]);
  });
});
