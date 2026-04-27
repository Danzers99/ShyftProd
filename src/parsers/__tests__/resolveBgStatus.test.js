import { describe, it, expect } from "vitest";
import { resolveBgStatus } from "../resolveBgStatus";

describe("resolveBgStatus", () => {
  describe("simple field only (Roster/Nesting)", () => {
    it("returns cleared=true when simple field is 'cleared'", () => {
      const r = resolveBgStatus({ background_check_status: "cleared" });
      expect(r.bgCleared).toBe(true);
      expect(r.bgStatus).toBe("cleared");
      expect(r.isBgMismatch).toBe(false);
      expect(r.hasAccountIssue).toBe(false);
    });

    it("flags account issue when status is pending", () => {
      const r = resolveBgStatus({ background_check_status: "pending" });
      expect(r.bgCleared).toBe(false);
      expect(r.hasAccountIssue).toBe(true);
    });

    it("flags account issue when status is created", () => {
      const r = resolveBgStatus({ background_check_status: "created" });
      expect(r.bgCleared).toBe(false);
      expect(r.hasAccountIssue).toBe(true);
    });

    it("returns no account issue for empty status", () => {
      const r = resolveBgStatus({ background_check_status: "" });
      expect(r.bgCleared).toBe(false);
      expect(r.hasAccountIssue).toBe(false);
    });
  });

  describe("CIP JSON only", () => {
    it("PASSED → cleared", () => {
      const json = '[{"process_status":"PASSED","report_status":"clear"}]';
      const r = resolveBgStatus({ background_check: json });
      expect(r.bgCleared).toBe(true);
      expect(r.cipBgProcess).toBe("PASSED");
      expect(r.cipBgReport).toBe("clear");
    });

    it("IN_PROGRESS + report=clear → cleared (report wins)", () => {
      // Edge case: process is still IN_PROGRESS but the BG report itself came back clear.
      // This means the BG IS done, just not fully synced in the system.
      const json = '[{"process_status":"IN_PROGRESS","report_status":"clear"}]';
      const r = resolveBgStatus({ background_check: json });
      expect(r.bgCleared).toBe(true);
    });

    it("IN_PROGRESS + report=proceed → cleared", () => {
      const json = '[{"process_status":"IN_PROGRESS","report_status":"proceed"}]';
      expect(resolveBgStatus({ background_check: json }).bgCleared).toBe(true);
    });

    it("IN_PROGRESS + report=pending → not cleared, account issue", () => {
      const json = '[{"process_status":"IN_PROGRESS","report_status":"pending"}]';
      const r = resolveBgStatus({ background_check: json });
      expect(r.bgCleared).toBe(false);
      expect(r.hasAccountIssue).toBe(true);
    });

    it("FAILED → not cleared, account issue", () => {
      const json = '[{"process_status":"FAILED_FORBIDDEN_TO_RESTART","report_status":"final_adverse"}]';
      const r = resolveBgStatus({ background_check: json });
      expect(r.bgCleared).toBe(false);
      expect(r.hasAccountIssue).toBe(true);
    });

    it("malformed JSON falls back gracefully", () => {
      const r = resolveBgStatus({ background_check: "[not valid json" });
      expect(r.bgCleared).toBe(false);
      expect(r.cipBgProcess).toBe("");
    });
  });

  describe("CROSS-SOURCE MISMATCH (Charnither / 101 agents regression)", () => {
    it("Roster=cleared + CIP=IN_PROGRESS/pending → isBgMismatch=true, NOT cleared", () => {
      // The classic Charnither pattern: Roster says cleared, CIP says still in progress.
      // CIP wins for cleared determination, but we surface the mismatch separately.
      const r = resolveBgStatus({
        background_check_status: "cleared",
        background_check: '[{"process_status":"IN_PROGRESS","report_status":"pending"}]',
      });
      expect(r.isBgMismatch).toBe(true);
      expect(r.bgCleared).toBe(false); // CIP contradicts Roster
      expect(r.hasAccountIssue).toBe(false); // mismatch gets its own bucket
    });

    it("Roster=cleared + CIP=IN_PROGRESS/processing → isBgMismatch", () => {
      const r = resolveBgStatus({
        background_check_status: "cleared",
        background_check: '[{"process_status":"IN_PROGRESS","report_status":"processing"}]',
      });
      expect(r.isBgMismatch).toBe(true);
    });

    it("Roster=cleared + CIP=PASSED → no mismatch (sources agree)", () => {
      const r = resolveBgStatus({
        background_check_status: "cleared",
        background_check: '[{"process_status":"PASSED","report_status":"clear"}]',
      });
      expect(r.isBgMismatch).toBe(false);
      expect(r.bgCleared).toBe(true);
    });

    it("Roster=cleared + CIP=IN_PROGRESS but report=clear → no mismatch (CIP report agrees)", () => {
      const r = resolveBgStatus({
        background_check_status: "cleared",
        background_check: '[{"process_status":"IN_PROGRESS","report_status":"clear"}]',
      });
      expect(r.isBgMismatch).toBe(false);
      expect(r.bgCleared).toBe(true);
    });

    it("Roster=pending + CIP=PASSED → no mismatch (sources eventually agree, CIP is right)", () => {
      const r = resolveBgStatus({
        background_check_status: "pending",
        background_check: '[{"process_status":"PASSED","report_status":"clear"}]',
      });
      expect(r.bgCleared).toBe(true); // PASSED wins
      expect(r.isBgMismatch).toBe(false);
    });
  });
});
