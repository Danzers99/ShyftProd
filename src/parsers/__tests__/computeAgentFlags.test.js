import { describe, it, expect } from "vitest";
import { computeAgentFlags } from "../computeAgentFlags";
import { parseCertProgress } from "../parseCertProgress";
import { ROSTER_COURSES, NESTING_COURSES, FL_BLUE_LEGACY } from "../../utils/constants";

// Helper: build a default context with sensible defaults; tests override what they care about.
function ctx(overrides = {}) {
  return {
    ldata: null,
    inLitmos: false,
    hasNameCollision: false,
    collidingUsernames: [],
    navAttended: false,
    navAvailable: false,
    prodCampaigns: [],
    rowCampaign: "",
    ...overrides,
  };
}

describe("computeAgentFlags — Charnither regression (BG cross-source mismatch)", () => {
  it("flags Charnither's pattern as isBgMismatch and excludes from waiting-for-creds", () => {
    // Roster says cleared, CIP shows IN_PROGRESS/pending. NB Cert is done.
    const row = {
      agent_nm: "Charnither Williams",
      shyftoff_id: "S2025418",
      status: "Roster - Credentials Requested",
      background_check_status: "cleared",
      background_check: '[{"process_status":"IN_PROGRESS","report_status":"pending"}]',
      certification_progress: "25", // Just NB Cert done
      created_at: "2026-02-25",
      last_changed: "2026-02-27",
    };
    const cert = parseCertProgress(row.certification_progress);
    const flags = computeAgentFlags(row, cert, ctx());

    expect(flags.isBgMismatch).toBe(true);
    expect(flags.bgCleared).toBe(false); // CIP wins
    expect(flags.isWaitingForCreds).toBe(false); // BG not actually cleared
    expect(flags.hasAccountIssue).toBe(false); // mismatch is a separate bucket
    expect(flags.credentialNote).toContain("BG mismatch");
  });
});

describe("computeAgentFlags — Needs Nesting Bump (98 stuck agents regression)", () => {
  it("flags agent in Roster status with Litmos credentials", () => {
    const row = {
      agent_nm: "Test Agent",
      shyftoff_id: "S001",
      status: "Roster - Credentials Requested",
      background_check_status: "cleared",
      certification_progress: "25",
    };
    const cert = parseCertProgress("25");
    const flags = computeAgentFlags(row, cert, ctx({ inLitmos: true }));

    expect(flags.needsNestingBump).toBe(true);
    expect(flags.isAlreadyCredentialed).toBe(true);
  });

  it("does NOT flag if not in Roster status (e.g. Nesting)", () => {
    const row = { status: "Nesting - First Call", certification_progress: "100" };
    const flags = computeAgentFlags(row, parseCertProgress("100"), ctx({ inLitmos: true }));
    expect(flags.needsNestingBump).toBe(false);
  });

  it("does NOT flag if not in Litmos", () => {
    const row = { status: "Roster - Credentials Requested", certification_progress: "25" };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: false }));
    expect(flags.needsNestingBump).toBe(false);
  });

  it("does NOT flag if name collision detected", () => {
    const row = { status: "Roster - Credentials Requested", certification_progress: "25" };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: true, hasNameCollision: true }));
    expect(flags.needsNestingBump).toBe(false);
  });
});

describe("computeAgentFlags — Needs Nav Outreach", () => {
  it("flags agent who completed all ShyftOff but missed Nav meeting", () => {
    const row = { status: "Nesting - First Call", certification_progress: "100" };
    const cert = parseCertProgress("100");
    const flags = computeAgentFlags(row, cert, ctx({
      navAvailable: true,
      navAttended: false,
    }));
    expect(flags.shyftoffComplete).toBe(true);
    expect(flags.needsNavOutreach).toBe(true);
  });

  it("does NOT flag when Nav data not uploaded (navAvailable=false)", () => {
    const cert = parseCertProgress("100");
    const flags = computeAgentFlags({ status: "Nesting - First Call", certification_progress: "100" }, cert, ctx({
      navAvailable: false,
      navAttended: false,
    }));
    expect(flags.needsNavOutreach).toBe(false);
  });

  it("does NOT flag when Nav was attended", () => {
    const cert = parseCertProgress("100");
    const flags = computeAgentFlags({ certification_progress: "100" }, cert, ctx({
      navAvailable: true, navAttended: true,
    }));
    expect(flags.needsNavOutreach).toBe(false);
  });

  it("does NOT flag when ShyftOff isn't 100%", () => {
    const cert = parseCertProgress("75");
    const flags = computeAgentFlags({ certification_progress: "75" }, cert, ctx({
      navAvailable: true, navAttended: false,
    }));
    expect(flags.needsNavOutreach).toBe(false);
  });
});

describe("computeAgentFlags — Ghost (Nesting without credentials)", () => {
  it("flags agent in Nesting status who isn't in Litmos", () => {
    const row = { status: "Nesting - First Call", certification_progress: "75" };
    const flags = computeAgentFlags(row, parseCertProgress("75"), ctx({ inLitmos: false }));
    expect(flags.isGhost).toBe(true);
  });

  it("does NOT flag if name collision (we can't be sure they lack creds)", () => {
    const row = { status: "Nesting - First Call", certification_progress: "75" };
    const flags = computeAgentFlags(row, parseCertProgress("75"), ctx({
      inLitmos: false, hasNameCollision: true,
    }));
    expect(flags.isGhost).toBe(false);
  });

  it("does NOT flag agents in Roster status", () => {
    const row = { status: "Roster - Credentials Requested", certification_progress: "25" };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: false }));
    expect(flags.isGhost).toBe(false);
  });
});

describe("computeAgentFlags — Waiting for Credentials", () => {
  it("flags agent with NB Cert + BG cleared + not in Litmos", () => {
    const row = {
      status: "Roster - Certification In-Progress",
      background_check_status: "cleared",
      certification_progress: "25", // NB Cert done
    };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: false }));
    expect(flags.rosterCoursesDone).toBe(true);
    expect(flags.isWaitingForCreds).toBe(true);
  });

  it("does NOT flag if BG not cleared", () => {
    const row = {
      background_check_status: "pending",
      certification_progress: "25",
    };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: false }));
    expect(flags.isWaitingForCreds).toBe(false);
  });

  it("does NOT flag if NB Cert not done (cert < 25%)", () => {
    const row = {
      background_check_status: "cleared",
      certification_progress: "0",
    };
    const flags = computeAgentFlags(row, parseCertProgress("0"), ctx({ inLitmos: false }));
    expect(flags.isWaitingForCreds).toBe(false);
  });
});

describe("computeAgentFlags — Stale categorization", () => {
  it("flags agent waiting 21+ days as stale", () => {
    const row = {
      status: "Roster - Credentials Requested",
      background_check_status: "cleared",
      certification_progress: "25",
      last_changed: new Date(Date.now() - 25 * 86400000).toISOString(),
    };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: false }));
    expect(flags.isStaleWaiter).toBe(true);
    expect(flags.daysSinceChange).toBeGreaterThanOrEqual(25);
  });

  it("splits stale into in-queue (Credentials Requested) vs truly stale", () => {
    const baseRow = {
      background_check_status: "cleared",
      certification_progress: "25",
      last_changed: new Date(Date.now() - 30 * 86400000).toISOString(),
    };
    const inQueueFlags = computeAgentFlags(
      { ...baseRow, status: "Roster - Credentials Requested" },
      parseCertProgress("25"),
      ctx({ inLitmos: false })
    );
    expect(inQueueFlags.isStaleInQueue).toBe(true);
    expect(inQueueFlags.isTrulyStale).toBe(false);

    const trulyStaleFlags = computeAgentFlags(
      { ...baseRow, status: "Roster - Certification In-Progress" },
      parseCertProgress("25"),
      ctx({ inLitmos: false })
    );
    expect(trulyStaleFlags.isStaleInQueue).toBe(false);
    expect(trulyStaleFlags.isTrulyStale).toBe(true);
  });

  it("doesn't flag stale if waited less than 21 days", () => {
    const row = {
      status: "Roster - Credentials Requested",
      background_check_status: "cleared",
      certification_progress: "25",
      last_changed: new Date(Date.now() - 10 * 86400000).toISOString(),
    };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: false }));
    expect(flags.isStaleWaiter).toBe(false);
  });
});

describe("computeAgentFlags — Account Issues vs Mismatch", () => {
  it("BG pending alone → hasAccountIssue", () => {
    const row = { background_check_status: "pending", certification_progress: "0" };
    const flags = computeAgentFlags(row, parseCertProgress("0"), ctx());
    expect(flags.hasAccountIssue).toBe(true);
    expect(flags.isBgMismatch).toBe(false);
  });

  it("BG mismatch → NOT hasAccountIssue (separate bucket)", () => {
    const row = {
      background_check_status: "cleared",
      background_check: '[{"process_status":"IN_PROGRESS","report_status":"pending"}]',
      certification_progress: "0",
    };
    const flags = computeAgentFlags(row, parseCertProgress("0"), ctx());
    expect(flags.isBgMismatch).toBe(true);
    expect(flags.hasAccountIssue).toBe(false);
  });
});

describe("computeAgentFlags — Readiness status", () => {
  it("ready when all 3 pillars complete (Litmos + ShyftOff + Nav)", () => {
    const row = { certification_progress: "100" };
    const ldata = {
      email: "test@nationsbenefits.com",
      courses: Object.fromEntries(
        ["Anti-money Laundering Awareness 4.0 (US)","Cyber Security Overview 2.0","HIPAA Privacy and Security Basics 5.0 (US)","Health Risk Assessments (HRAs)","Identity Theft Training 2026","Information Security Basics 3.0","Leading Learning - Payment Card Industry Data Security Standards (PCI-DSS) 2.0","Medicare Parts C & D - Combating Fraud, Waste & Abuse 2026","Medicare Parts C & D - Cultural Competency 2026","Medicare Parts C & D - General Compliance 2026","Nations of the Stars - Journey into 2026","Sexual Harassment Prevention 3.0 (US)","Triple-S Introduction","UDAAP Training 2026"].map(c => [c, { completed: true, pct: 100, date: "2026-04-01" }])
      ),
    };
    const flags = computeAgentFlags(row, parseCertProgress("100"), ctx({
      ldata, inLitmos: true, navAvailable: true, navAttended: true,
    }));
    expect(flags.readyStatus).toBe("ready");
    expect(flags.allLitmos).toBe(true);
  });

  it("partial when in progress on at least one pillar", () => {
    const flags = computeAgentFlags({ certification_progress: "50" }, parseCertProgress("50"), ctx());
    expect(flags.readyStatus).toBe("partial");
  });

  it("missing when nothing started", () => {
    const flags = computeAgentFlags({ certification_progress: "0" }, parseCertProgress("0"), ctx());
    expect(flags.readyStatus).toBe("missing");
  });

  it("ready when no Nav data uploaded (navMet defaults true)", () => {
    // If nav data isn't uploaded at all, nav check should not block readiness
    const ldata = {
      email: "x",
      courses: Object.fromEntries(
        ["Anti-money Laundering Awareness 4.0 (US)","Cyber Security Overview 2.0","HIPAA Privacy and Security Basics 5.0 (US)","Health Risk Assessments (HRAs)","Identity Theft Training 2026","Information Security Basics 3.0","Leading Learning - Payment Card Industry Data Security Standards (PCI-DSS) 2.0","Medicare Parts C & D - Combating Fraud, Waste & Abuse 2026","Medicare Parts C & D - Cultural Competency 2026","Medicare Parts C & D - General Compliance 2026","Nations of the Stars - Journey into 2026","Sexual Harassment Prevention 3.0 (US)","Triple-S Introduction","UDAAP Training 2026"].map(c => [c, { completed: true, pct: 100, date: "" }])
      ),
    };
    const flags = computeAgentFlags({ certification_progress: "100" }, parseCertProgress("100"), ctx({
      ldata, inLitmos: true, navAvailable: false, navAttended: false,
    }));
    expect(flags.readyStatus).toBe("ready");
  });
});

describe("computeAgentFlags — Per-course completion (FL Blue folded into Pre-Prod)", () => {
  it("nbCertDone = true when NB Cert course is at 100%", () => {
    const cert = parseCertProgress("25"); // 25% = first course done
    const flags = computeAgentFlags({ certification_progress: "25" }, cert, ctx());
    expect(flags.nbCertDone).toBe(true);
    expect(flags.flBlueDone).toBe(false);
  });

  it("flBlueDone tracked separately from rosterCoursesDone", () => {
    // FL Blue is no longer required for credential eligibility, but we still
    // track it from legacy data for visibility.
    const cert = parseCertProgress("50"); // First 2 courses done = NB Cert + FL Blue
    const flags = computeAgentFlags({ certification_progress: "50" }, cert, ctx());
    expect(flags.nbCertDone).toBe(true);
    expect(flags.flBlueDone).toBe(true);
    expect(flags.rosterCoursesDone).toBe(true); // Roster phase only requires NB Cert
  });

  it("rosterCoursesDone = nbCertDone (FL Blue NOT required)", () => {
    // 25% = NB Cert done but FL Blue not done → rosterCoursesDone should still be true
    const cert = parseCertProgress("25");
    const flags = computeAgentFlags({ certification_progress: "25" }, cert, ctx());
    expect(flags.rosterCoursesDone).toBe(true);
    expect(flags.flBlueDone).toBe(false);
  });
});

describe("computeAgentFlags — Credentials Requested but Courses Not Done", () => {
  it("flags status-advanced-prematurely case", () => {
    // System moved them to "Credentials Requested" but NB Cert isn't actually done
    const row = {
      status: "Roster - Credentials Requested",
      certification_progress: "0",
    };
    const flags = computeAgentFlags(row, parseCertProgress("0"), ctx({ inLitmos: false }));
    expect(flags.isCredsRequestedNoCourses).toBe(true);
    expect(flags.rosterCoursesDone).toBe(false);
  });

  it("does NOT flag when courses ARE done", () => {
    const row = {
      status: "Roster - Credentials Requested",
      certification_progress: "25",
    };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: false }));
    expect(flags.isCredsRequestedNoCourses).toBe(false);
  });

  it("does NOT flag if name collision (uncertain)", () => {
    const row = {
      status: "Roster - Credentials Requested",
      certification_progress: "0",
    };
    const flags = computeAgentFlags(row, parseCertProgress("0"), ctx({
      inLitmos: false, hasNameCollision: true,
    }));
    expect(flags.isCredsRequestedNoCourses).toBe(false);
  });
});

describe("computeAgentFlags — Credential note (human-readable diagnosis)", () => {
  it("'Has credentials' for inLitmos agents", () => {
    const flags = computeAgentFlags({ certification_progress: "0" }, parseCertProgress("0"), ctx({
      inLitmos: true,
    }));
    expect(flags.credentialNote).toBe("Has credentials");
  });

  it("'Should be on next credentials batch' when ready", () => {
    const flags = computeAgentFlags(
      { background_check_status: "cleared", certification_progress: "25" },
      parseCertProgress("25"),
      ctx({ inLitmos: false })
    );
    expect(flags.credentialNote).toBe("Should be on next credentials batch");
  });

  it("'NB Certification done — waiting on BG check' when courses done but BG pending", () => {
    const flags = computeAgentFlags(
      { background_check_status: "pending", certification_progress: "25" },
      parseCertProgress("25"),
      ctx({ inLitmos: false })
    );
    expect(flags.credentialNote).toContain("waiting on BG check");
  });

  it("'BG cleared — NB Certification in progress' when BG OK but cert not done", () => {
    const flags = computeAgentFlags(
      { background_check_status: "cleared", certification_progress: "0" },
      parseCertProgress("0"),
      ctx({ inLitmos: false })
    );
    expect(flags.credentialNote).toContain("NB Certification in progress");
  });
});
