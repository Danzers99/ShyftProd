import { describe, it, expect } from "vitest";
import { dedupCipData } from "../dedupCipData";

describe("dedupCipData", () => {
  it("deduplicates by ShyftOff ID", () => {
    const rows = [
      { shyftoff_id: "S001", agent_nm: "Alice", certification_progress: "75" },
      { shyftoff_id: "S001", agent_nm: "Alice", certification_progress: "75" },
      { shyftoff_id: "S002", agent_nm: "Bob", certification_progress: "100" },
    ];
    const result = dedupCipData(rows);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.shyftoff_id).sort()).toEqual(["S001", "S002"]);
  });

  it("ignores rows without shyftoff_id", () => {
    const rows = [
      { shyftoff_id: "", agent_nm: "Anonymous" },
      { shyftoff_id: "S001", agent_nm: "Alice" },
    ];
    expect(dedupCipData(rows)).toHaveLength(1);
  });

  it("prefers Roster integer cert_progress over CIP JSON (Brittany regression)", () => {
    // Brittany's Roster has cert_progress="58" (accurate) but CIP has misleading JSON
    // with multiple campaign rows showing 0 for Pre-Prod even though she completed it.
    const rows = [
      { shyftoff_id: "S001", certification_progress: '[{"course_code":"x","progress":"0"}]' },
      { shyftoff_id: "S001", certification_progress: "58" },
    ];
    const result = dedupCipData(rows);
    expect(result[0].certification_progress).toBe("58");
  });

  it("keeps CIP JSON cert_progress when Roster integer is missing", () => {
    const rows = [
      { shyftoff_id: "S001", certification_progress: '[{"course_code":"x","progress":"1"}]' },
      { shyftoff_id: "S001" }, // no cert_progress
    ];
    const result = dedupCipData(rows);
    expect(result[0].certification_progress).toBe('[{"course_code":"x","progress":"1"}]');
  });

  it("merges BG JSON: prefers entry with non-null process_status", () => {
    // First row has CIP JSON with null process_status (stub). Second has actual data.
    const rows = [
      { shyftoff_id: "S001", background_check: '[{"process_status":null,"report_status":null}]' },
      { shyftoff_id: "S001", background_check: '[{"process_status":"IN_PROGRESS","report_status":"pending"}]' },
    ];
    const result = dedupCipData(rows);
    expect(result[0].background_check).toContain("IN_PROGRESS");
  });

  it("merges simple BG status from Roster (Charnither cross-source case)", () => {
    // Charnither: CIP has IN_PROGRESS JSON, Roster has "cleared" simple field
    const rows = [
      { shyftoff_id: "S2025418", background_check: '[{"process_status":"IN_PROGRESS","report_status":"pending"}]' },
      { shyftoff_id: "S2025418", background_check_status: "cleared" },
    ];
    const result = dedupCipData(rows);
    expect(result[0].background_check).toContain("IN_PROGRESS");
    expect(result[0].background_check_status).toBe("cleared");
  });

  it("preserves stale_level from Roster/Nesting", () => {
    const rows = [
      { shyftoff_id: "S001" },
      { shyftoff_id: "S001", stale_level: "Roster Stale" },
    ];
    expect(dedupCipData(rows)[0].stale_level).toBe("Roster Stale");
  });

  it("preserves agent_name from Roster/Nesting if CIP didn't have one", () => {
    const rows = [
      { shyftoff_id: "S001", agent_nm: "" },
      { shyftoff_id: "S001", agent_name: "Alice Smith" },
    ];
    expect(dedupCipData(rows)[0].agent_name).toBe("Alice Smith");
  });

  it("handles empty input", () => {
    expect(dedupCipData([])).toEqual([]);
    expect(dedupCipData(null)).toEqual([]);
    expect(dedupCipData(undefined)).toEqual([]);
  });
});
