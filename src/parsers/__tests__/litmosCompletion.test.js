import { describe, it, expect } from "vitest";
import { deriveLitmosCount, buildPeopleCompletionMap } from "../litmosCompletion";

const REQUIRED = [
  "AML 4.0", "Cyber Sec", "HIPAA", "HRAs", "ID Theft", "Info Sec", "PCI-DSS",
  "FWA", "Cultural", "Compliance", "Stars", "Sexual Harass", "Triple-S", "UDAAP",
];

function ldataWith(completed) {
  // completed: array of course names that are done
  const courses = {};
  for (const c of completed) courses[c] = { completed: true, pct: 100, date: "2026-04-01" };
  return { courses };
}

// ---- deriveLitmosCount ---------------------------------------------------

describe("deriveLitmosCount — Course Data path (exact, preferred)", () => {
  it("counts only the courses that are in REQUIRED and completed", () => {
    const ldata = ldataWith(["AML 4.0", "HIPAA", "Triple-S"]);
    const r = deriveLitmosCount(ldata, null, REQUIRED);
    expect(r).toEqual({ count: 3, total: 14, source: "course-data", estimated: false });
  });

  it("returns 14/14 when all required courses are complete in Course Data", () => {
    const r = deriveLitmosCount(ldataWith(REQUIRED), null, REQUIRED);
    expect(r.count).toBe(14);
    expect(r.source).toBe("course-data");
    expect(r.estimated).toBe(false);
  });

  it("ignores Course Data entries that aren't in REQUIRED", () => {
    const ldata = ldataWith(["AML 4.0", "Some Random Course"]);
    expect(deriveLitmosCount(ldata, null, REQUIRED).count).toBe(1);
  });

  it("Course Data wins even when People Report disagrees", () => {
    // Course Data shows 2 done; People Report says all complete. Course wins.
    const r = deriveLitmosCount(ldataWith(["AML 4.0", "HIPAA"]), { pct: 100, allComplete: true }, REQUIRED);
    expect(r.count).toBe(2);
    expect(r.source).toBe("course-data");
  });
});

describe("deriveLitmosCount — People Report fallback", () => {
  it("uses allComplete=true to return total/total (authoritative)", () => {
    const r = deriveLitmosCount(null, { pct: null, allComplete: true }, REQUIRED);
    expect(r).toEqual({ count: 14, total: 14, source: "people-report", estimated: false });
  });

  it("uses % to estimate when allComplete is false", () => {
    // Steve Melliz case: 94.117647% → round(94.117647/100 × 14) = 13
    const r = deriveLitmosCount(null, { pct: 94.117647, allComplete: false }, REQUIRED);
    expect(r.count).toBe(13);
    expect(r.source).toBe("people-report-estimate");
    expect(r.estimated).toBe(true);
  });

  it("estimates 0 from 0% (still better than 'missing')", () => {
    const r = deriveLitmosCount(null, { pct: 0, allComplete: false }, REQUIRED);
    expect(r.count).toBe(0);
    expect(r.source).toBe("people-report-estimate");
  });

  it("clamps estimate to total when % > 100 (defensive)", () => {
    const r = deriveLitmosCount(null, { pct: 150, allComplete: false }, REQUIRED);
    expect(r.count).toBe(14);
  });

  it("falls back to missing when peopleCompletion has only nulls", () => {
    const r = deriveLitmosCount(null, { pct: null, allComplete: null }, REQUIRED);
    expect(r.source).toBe("missing");
  });
});

describe("deriveLitmosCount — missing data", () => {
  it("returns count=0 source=missing when no data at all", () => {
    expect(deriveLitmosCount(null, null, REQUIRED)).toEqual({
      count: 0, total: 14, source: "missing", estimated: false,
    });
  });

  it("ldata without courses map falls through to People Report", () => {
    const r = deriveLitmosCount({}, { pct: 50, allComplete: false }, REQUIRED);
    expect(r.source).toBe("people-report-estimate");
    expect(r.count).toBe(7);
  });
});

// ---- buildPeopleCompletionMap --------------------------------------------

describe("buildPeopleCompletionMap", () => {
  function row(username, pct, allComplete) {
    return {
      "People.Username": username,
      "People Metrics.% Assigned Courses Complete": pct,
      "People Metrics.Is All Courses Complete": allComplete,
    };
  }

  it("indexes rows by lowercase username", () => {
    const m = buildPeopleCompletionMap([row("Steve.Melliz@nationsbenefits.com", "94.117647", "FALSE")]);
    expect(m.has("steve.melliz@nationsbenefits.com")).toBe(true);
    expect(m.get("steve.melliz@nationsbenefits.com")).toEqual({ pct: 94.117647, allComplete: false });
  });

  it("parses the boolean field literally (TRUE/FALSE strings)", () => {
    const m = buildPeopleCompletionMap([
      row("a@b.com", "100", "TRUE"),
      row("c@d.com", "0", "FALSE"),
    ]);
    expect(m.get("a@b.com").allComplete).toBe(true);
    expect(m.get("c@d.com").allComplete).toBe(false);
  });

  it("tolerates blank metric fields by recording null", () => {
    const m = buildPeopleCompletionMap([row("a@b.com", "", "TRUE")]);
    expect(m.get("a@b.com")).toEqual({ pct: null, allComplete: true });
  });

  it("skips rows with no username", () => {
    const m = buildPeopleCompletionMap([row("", "100", "TRUE")]);
    expect(m.size).toBe(0);
  });

  it("skips rows with no completion data at all (no signal to record)", () => {
    const m = buildPeopleCompletionMap([row("a@b.com", "", "")]);
    expect(m.size).toBe(0);
  });

  it("handles null/undefined input gracefully", () => {
    expect(buildPeopleCompletionMap(null).size).toBe(0);
    expect(buildPeopleCompletionMap(undefined).size).toBe(0);
    expect(buildPeopleCompletionMap([]).size).toBe(0);
  });

  it("treats numeric 0% as a valid signal (not skipped)", () => {
    const m = buildPeopleCompletionMap([row("a@b.com", "0", "FALSE")]);
    expect(m.size).toBe(1);
    expect(m.get("a@b.com")).toEqual({ pct: 0, allComplete: false });
  });
});

// ---- Steve Melliz regression test ---------------------------------------

describe("Steve Melliz regression — the bug that prompted this fix", () => {
  it("an agent in the People Report at 94% but missing from Course Data shows ~13/14", () => {
    // Real production data: People Report has 94.117647% complete, Course
    // Data export doesn't include him. Tool was showing 0/14.
    const peopleMap = buildPeopleCompletionMap([{
      "People.Username": "Steve.Melliz@nationsbenefits.com",
      "People Metrics.% Assigned Courses Complete": "94.117647",
      "People Metrics.Is All Courses Complete": "FALSE",
    }]);
    const completion = peopleMap.get("steve.melliz@nationsbenefits.com");
    const r = deriveLitmosCount(null, completion, REQUIRED);
    expect(r.count).toBe(13);
    expect(r.estimated).toBe(true);
    expect(r.source).toBe("people-report-estimate");
  });
});
