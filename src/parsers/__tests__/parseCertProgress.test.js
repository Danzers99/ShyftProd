import { describe, it, expect } from "vitest";
import { parseCertProgress, matchShyftoffCourse } from "../parseCertProgress";
import { ROSTER_COURSES, NESTING_COURSES, FL_BLUE_LEGACY } from "../../utils/constants";

describe("matchShyftoffCourse", () => {
  it("matches NB Certification Course", () => {
    expect(matchShyftoffCourse("Nations Benefits Certification")).toBe(ROSTER_COURSES[0]);
    expect(matchShyftoffCourse("NationsBenefits Certification Course")).toBe(ROSTER_COURSES[0]);
  });

  it("matches FL Blue (legacy course code)", () => {
    expect(matchShyftoffCourse("nations-flblue2026")).toBe(FL_BLUE_LEGACY);
    expect(matchShyftoffCourse("Nations - Florida Blue 2026 Uptraining")).toBe(FL_BLUE_LEGACY);
  });

  it("matches Pre-Production", () => {
    expect(matchShyftoffCourse("Nations Benefits Pre-Production")).toBe(NESTING_COURSES[0]);
  });

  it("matches Navigation Meeting", () => {
    expect(matchShyftoffCourse("Nations Benefits Navigation Meeting Self-Guided")).toBe(NESTING_COURSES[1]);
  });

  it("returns raw code if no match", () => {
    expect(matchShyftoffCourse("Some Other Course")).toBe("Some Other Course");
  });
});

describe("parseCertProgress — integer format", () => {
  it("returns null pct for empty input", () => {
    expect(parseCertProgress("").pct).toBe(null);
    expect(parseCertProgress(null).pct).toBe(null);
  });

  it("parses 100% as all 4 courses done", () => {
    const result = parseCertProgress("100");
    expect(result.pct).toBe(100);
    expect(result.courseMap[ROSTER_COURSES[0]]).toBe(100);
    expect(result.courseMap[FL_BLUE_LEGACY]).toBe(100);
    expect(result.courseMap[NESTING_COURSES[0]]).toBe(100);
    expect(result.courseMap[NESTING_COURSES[1]]).toBe(100);
  });

  it("parses 75% as 3 of 4 courses (Nav Meeting unfinished)", () => {
    const result = parseCertProgress("75");
    expect(result.pct).toBe(75);
    expect(result.courseMap[ROSTER_COURSES[0]]).toBe(100);
    expect(result.courseMap[FL_BLUE_LEGACY]).toBe(100);
    expect(result.courseMap[NESTING_COURSES[0]]).toBe(100);
    expect(result.courseMap[NESTING_COURSES[1]]).toBe(0);
  });

  it("parses 25% as just NB Cert done", () => {
    const result = parseCertProgress("25");
    expect(result.courseMap[ROSTER_COURSES[0]]).toBe(100);
    expect(result.courseMap[FL_BLUE_LEGACY]).toBe(0);
  });
});

describe("parseCertProgress — JSON format", () => {
  it("parses CIP-style JSON with per-course progress", () => {
    const json = JSON.stringify([
      { course_code: "Nations Benefits Certification", progress: "1.0", updated_at: "2026-04-01" },
      { course_code: "nations-flblue2026", progress: "1.0", updated_at: "2026-04-02" },
      { course_code: "Nations Benefits Pre-Production", progress: "0.5", updated_at: "2026-04-03" },
    ]);
    const result = parseCertProgress(json);
    expect(result.courseMap[ROSTER_COURSES[0]]).toBe(100);
    expect(result.courseMap[FL_BLUE_LEGACY]).toBe(100);
    expect(result.courseMap[NESTING_COURSES[0]]).toBe(50);
  });

  it("keeps the MAX progress when multiple campaign rows reference same course", () => {
    // Critical regression: CIP JSON has the same course_code for multiple campaigns,
    // some with progress 0 (not enrolled in that campaign). Without max-pick, the
    // 0 from a later campaign overwrites the legitimate 1.0 completion.
    const json = JSON.stringify([
      { course_code: "Nations Benefits Certification", progress: "1.0", campaign_id: null },
      { course_code: "Nations Benefits Pre-Production", progress: "1.0", campaign_id: null },
      { course_code: "Nations Benefits Pre-Production", progress: "0", campaign_id: "20" },
      { course_code: "Nations Benefits Pre-Production", progress: "0", campaign_id: "28" },
    ]);
    const result = parseCertProgress(json);
    // Should be 100, NOT 0
    expect(result.courseMap[NESTING_COURSES[0]]).toBe(100);
  });

  it("handles malformed JSON gracefully", () => {
    const result = parseCertProgress("[invalid json");
    expect(result.pct).toBe(null);
    expect(result.courseMap).toEqual({});
  });

  it("handles double-quoted JSON (CSV-encoded)", () => {
    // CSV escapes quotes as ""
    const json = '[{""course_code"": ""Nations Benefits Certification"", ""progress"": ""1.0""}]';
    const result = parseCertProgress(json);
    expect(result.courseMap[ROSTER_COURSES[0]]).toBe(100);
  });
});
