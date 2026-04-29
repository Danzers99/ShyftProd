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

describe("computeAgentFlags — Phase 2 Training equivalence (Roster - Phase 2 Training = Nesting)", () => {
  it("Roster - Phase 2 Training is NOT flagged as needsNestingBump (already in nesting phase)", () => {
    // Three agents currently in this status as of 2026-04-29: Kyra Bonds,
    // Naike Gabriel, Steve Melliz. They were being incorrectly flagged for
    // a Nesting bump even though they're already in the training phase.
    const row = { status: "Roster - Phase 2 Training", certification_progress: "25" };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: true }));
    expect(flags.needsNestingBump).toBe(false);
    expect(flags.isPhase2Training).toBe(true);
    expect(flags.isRoster).toBe(false);  // refined to exclude Phase 2
    expect(flags.isNesting).toBe(true);  // expanded to include Phase 2
  });

  it("Phase 2 Training rehire does NOT get needsNewCredentials flag (already in nesting)", () => {
    // Even if a Phase 2 Training agent has all the rehire signals, the
    // needsNewCredentials flag requires isRoster=true, so it doesn't fire.
    // This is correct: they're past the Roster gate already.
    const NOW = Date.parse("2026-04-29T12:00:00Z");
    const ldata = {
      courses: { "Anti-money Laundering Awareness 4.0 (US)": { completed: true, date: new Date(NOW - 120 * 86400000).toISOString(), pct: 100 } },
    };
    const row = { status: "Roster - Phase 2 Training", certification_progress: "25" };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: true, ldata, now: NOW }));
    expect(flags.isLikelyRehire).toBe(true);  // diagnostic still set
    expect(flags.needsNestingBump).toBe(false);
    expect(flags.needsNewCredentials).toBe(false); // Phase 2 disqualifies
  });

  it("Phase 2 Training agent without Litmos IS flagged as a ghost (Nesting equivalence applies)", () => {
    // The other side of the equivalence: ghost detection (Nesting + no creds)
    // should fire for Phase 2 Training agents who lack credentials.
    const row = { status: "Roster - Phase 2 Training", certification_progress: "25" };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: false }));
    expect(flags.isGhost).toBe(true);
    expect(flags.isNesting).toBe(true);
  });

  it("Regression: 'Roster - Credentials Requested' still triggers needsNestingBump", () => {
    const row = { status: "Roster - Credentials Requested", certification_progress: "25" };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: true }));
    expect(flags.needsNestingBump).toBe(true);
    expect(flags.isPhase2Training).toBe(false);
    expect(flags.isRoster).toBe(true);
    expect(flags.isNesting).toBe(false);
  });

  it("Regression: 'Roster - Certification In-Progress' still treated as Roster", () => {
    const row = { status: "Roster - Certification In-Progress", certification_progress: "25" };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: true }));
    expect(flags.isRoster).toBe(true);
    expect(flags.isPhase2Training).toBe(false);
  });

  it("Regression: 'Pre-Roster - Phase 1 Training' is NOT mistakenly treated as Phase 2", () => {
    // Phase 1 must remain in its existing classification — only Phase 2 gets
    // the Nesting equivalence treatment.
    const row = { status: "Pre-Roster - Phase 1 Training", certification_progress: "0" };
    const flags = computeAgentFlags(row, parseCertProgress("0"), ctx({ inLitmos: false }));
    expect(flags.isPhase2Training).toBe(false);
    expect(flags.isNesting).toBe(false);
  });

  it("Regression: 'Nesting - First Call' itself unchanged", () => {
    const row = { status: "Nesting - First Call", certification_progress: "100" };
    const flags = computeAgentFlags(row, parseCertProgress("100"), ctx({ inLitmos: true }));
    expect(flags.isNesting).toBe(true);
    expect(flags.isRoster).toBe(false);
    expect(flags.isPhase2Training).toBe(false);
    expect(flags.needsNestingBump).toBe(false);
  });

  it("Case-insensitive: 'roster - phase 2 training' (lowercase) still detected", () => {
    const row = { status: "roster - phase 2 training", certification_progress: "25" };
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: true }));
    expect(flags.isPhase2Training).toBe(true);
    expect(flags.needsNestingBump).toBe(false);
  });
});

describe("computeAgentFlags — Rehire detection (terminated Litmos credentials)", () => {
  // Fixed reference time so dates compute deterministically.
  const NOW = Date.parse("2026-04-29T12:00:00Z");
  const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

  function rehireCtx(overrides = {}) {
    return ctx({
      inLitmos: true,
      now: NOW,
      ...overrides,
    });
  }
  function rosterRow(extras = {}) {
    return {
      shyftoff_id: "S0001",
      agent_nm: "Test Agent",
      status: "Roster - Credentials Requested",
      certification_progress: "25",
      ...extras,
    };
  }

  it("Removed-list alone does NOT trigger isLikelyRehire (would mis-flag re-onboards with fresh creds)", () => {
    // Agent was removed before, but now has a fresh Litmos account / no old activity.
    // This is a legitimate re-onboarding — should be bumped, not flagged.
    const flags = computeAgentFlags(rosterRow(), parseCertProgress("25"), rehireCtx({
      removalAnnotation: { wasRemoved: true, lastRemovalReason: "Performance", lastRemovalDaysAgo: 60 },
      ldata: { courses: {} },
      litmosAccountCreatedDate: daysAgo(2),
    }));
    expect(flags.isLikelyRehire).toBe(false);
    expect(flags.isRehireFromRemovedList).toBe(true); // diagnostic still tracked
    expect(flags.needsNestingBump).toBe(true);    // bump still applies
    expect(flags.needsNewCredentials).toBe(false);
  });

  it("Removed-list PLUS old completions: rehire fires AND prior-removal appears in signals as context", () => {
    const ldata = {
      courses: { "Anti-money Laundering Awareness 4.0 (US)": { completed: true, date: daysAgo(120), pct: 100 } },
    };
    const flags = computeAgentFlags(rosterRow(), parseCertProgress("25"), rehireCtx({
      ldata,
      removalAnnotation: { wasRemoved: true, lastRemovalReason: "Production Stale", lastRemovalDaysAgo: 90 },
    }));
    expect(flags.isLikelyRehire).toBe(true);
    expect(flags.needsNestingBump).toBe(false);
    expect(flags.needsNewCredentials).toBe(true);
    // Prior removal is included as supporting context
    expect(flags.rehireSignals.some(s => s.includes("Production Stale"))).toBe(true);
    expect(flags.rehireSignals.some(s => s.includes("120d"))).toBe(true);
  });

  it("Signal 2 (behavioral): old completions (>60 days) trip isLikelyRehire", () => {
    // Build ldata with 3 completions, all 100 days ago
    const ldata = {
      email: "agent@example.com",
      courses: {
        "Anti-money Laundering Awareness 4.0 (US)": { completed: true, date: daysAgo(100), pct: 100 },
        "HIPAA Privacy and Security Basics 5.0 (US)": { completed: true, date: daysAgo(100), pct: 100 },
        "Information Security Basics 3.0": { completed: true, date: daysAgo(100), pct: 100 },
      },
    };
    const flags = computeAgentFlags(rosterRow(), parseCertProgress("25"), rehireCtx({ ldata }));
    expect(flags.isLikelyRehire).toBe(true);
    expect(flags.isRehireBehavioral).toBe(true);
    expect(flags.daysSinceLastLitmosCompletion).toBe(100);
    expect(flags.needsNestingBump).toBe(false);
    expect(flags.needsNewCredentials).toBe(true);
  });

  it("Signal 2 boundary: completion exactly 60 days ago does NOT trip behavioral signal", () => {
    const ldata = {
      courses: { "Anti-money Laundering Awareness 4.0 (US)": { completed: true, date: daysAgo(60), pct: 100 } },
    };
    const flags = computeAgentFlags(rosterRow(), parseCertProgress("25"), rehireCtx({ ldata }));
    expect(flags.isRehireBehavioral).toBe(false);
  });

  it("Signal 2: a recent completion within 60 days does NOT trip behavioral", () => {
    const ldata = {
      courses: { "Anti-money Laundering Awareness 4.0 (US)": { completed: true, date: daysAgo(15), pct: 100 } },
    };
    const flags = computeAgentFlags(rosterRow(), parseCertProgress("25"), rehireCtx({ ldata }));
    expect(flags.isRehireBehavioral).toBe(false);
    expect(flags.isLikelyRehire).toBe(false);
    expect(flags.needsNestingBump).toBe(true); // legit case
  });

  it("Signal 3 (stale account): 0 completions + Litmos account >90 days old", () => {
    const flags = computeAgentFlags(rosterRow(), parseCertProgress("25"), rehireCtx({
      ldata: { courses: {} },
      litmosAccountCreatedDate: daysAgo(150),
    }));
    expect(flags.isLikelyRehire).toBe(true);
    expect(flags.isRehireStaleAccount).toBe(true);
    expect(flags.litmosAccountAgeDays).toBe(150);
    expect(flags.needsNestingBump).toBe(false);
    expect(flags.needsNewCredentials).toBe(true);
  });

  it("Signal 3 boundary: account exactly 90 days old does NOT trip stale-account signal", () => {
    const flags = computeAgentFlags(rosterRow(), parseCertProgress("25"), rehireCtx({
      ldata: { courses: {} },
      litmosAccountCreatedDate: daysAgo(90),
    }));
    expect(flags.isRehireStaleAccount).toBe(false);
  });

  it("New hire (legit): no signals fire — needsNestingBump remains true", () => {
    // Brand new account, no completions yet, not in removed-export
    const flags = computeAgentFlags(rosterRow(), parseCertProgress("25"), rehireCtx({
      ldata: { courses: {} },
      litmosAccountCreatedDate: daysAgo(5),
    }));
    expect(flags.isLikelyRehire).toBe(false);
    expect(flags.needsNestingBump).toBe(true);
    expect(flags.needsNewCredentials).toBe(false);
  });

  it("Backward compatible: missing rehire context does NOT change existing behavior", () => {
    // The original test from the existing suite — should still pass with new code
    const row = rosterRow();
    const flags = computeAgentFlags(row, parseCertProgress("25"), ctx({ inLitmos: true }));
    expect(flags.needsNestingBump).toBe(true);
    expect(flags.isLikelyRehire).toBe(false);
    expect(flags.needsNewCredentials).toBe(false);
  });

  it("Multiple signals + prior removal context populates rehireSignals", () => {
    const ldata = {
      courses: { "Anti-money Laundering Awareness 4.0 (US)": { completed: true, date: daysAgo(120), pct: 100 } },
    };
    const flags = computeAgentFlags(rosterRow(), parseCertProgress("25"), rehireCtx({
      ldata,
      removalAnnotation: { wasRemoved: true, lastRemovalReason: "Production Stale", lastRemovalDaysAgo: 30 },
    }));
    // Behavioral signal triggers; removed-list adds context
    expect(flags.rehireSignals.length).toBeGreaterThanOrEqual(2);
    expect(flags.rehireSignals.some(s => s.includes("120d ago"))).toBe(true);
    expect(flags.rehireSignals.some(s => s.includes("Production Stale"))).toBe(true);
  });

  it("Nesting agent with rehire signals: not bumped (already there) and not flagged for new creds", () => {
    // Rehire who's already in Nesting (the user's current 32 agents) — needsNestingBump
    // and needsNewCredentials both require isRoster, so neither fires.
    const ldata = {
      courses: { "Anti-money Laundering Awareness 4.0 (US)": { completed: true, date: daysAgo(120), pct: 100 } },
    };
    const flags = computeAgentFlags({ ...rosterRow(), status: "Nesting - First Call" }, parseCertProgress("25"), rehireCtx({
      ldata,
    }));
    expect(flags.isLikelyRehire).toBe(true); // diagnostic still set
    expect(flags.needsNestingBump).toBe(false);
    expect(flags.needsNewCredentials).toBe(false); // not in Roster
  });

  it("Name collision agent: still excluded from both bump and new-creds (preserves existing safety)", () => {
    const ldata = {
      courses: { "Anti-money Laundering Awareness 4.0 (US)": { completed: true, date: daysAgo(120), pct: 100 } },
    };
    const flags = computeAgentFlags(rosterRow(), parseCertProgress("25"), rehireCtx({
      hasNameCollision: true,
      ldata,
    }));
    expect(flags.needsNestingBump).toBe(false);
    expect(flags.needsNewCredentials).toBe(false); // collision overrides
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
