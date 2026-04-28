import { describe, it, expect } from "vitest";
import { identifyFile, validateSlot } from "../schemaValidation";

describe("identifyFile", () => {
  it("identifies Litmos Course Data", () => {
    const headers = ["People.First Name", "People.Last Name", "Course.Title", "Course User Results.Completed", "People.Email"];
    expect(identifyFile(headers, {}).kind).toBe("litmos-course");
  });

  it("identifies Litmos People Report (no Course.Title column)", () => {
    const headers = ["People.First Name", "People.Last Name", "People.Username", "People.Created Date"];
    expect(identifyFile(headers, {}).kind).toBe("litmos-people");
  });

  it("identifies Roster export by status", () => {
    const headers = ["shyftoff_id", "agent_name", "background_check_status", "certification_progress"];
    const firstRow = { status: "Roster - Credentials Requested" };
    expect(identifyFile(headers, firstRow).kind).toBe("roster");
  });

  it("identifies Nesting export by status", () => {
    const headers = ["shyftoff_id", "agent_name", "background_check_status", "certification_progress"];
    const firstRow = { status: "Nesting - First Call" };
    expect(identifyFile(headers, firstRow).kind).toBe("nesting");
  });

  it("identifies CIP export", () => {
    const headers = ["shyftoff_id", "campaign_application_id", "background_check", "certification_progress", "agent_nm"];
    const firstRow = { status: "Roster - Credentials Requested" };
    expect(identifyFile(headers, firstRow).kind).toBe("cip");
  });

  it("identifies production-export (CIP-format with status=Production)", () => {
    const headers = ["shyftoff_id", "campaign_application_id", "background_check", "certification_progress", "agent_nm"];
    const firstRow = { status: "Production" };
    expect(identifyFile(headers, firstRow).kind).toBe("production-export");
  });

  it("identifies simple Production agents", () => {
    const headers = ["so_agent_id", "full_name", "agent_campaign_status", "background_check_status"];
    expect(identifyFile(headers, {}).kind).toBe("production");
  });

  it("identifies ShyftNav export", () => {
    const headers = ["Meeting Date", "Agent First Name", "Agent Last Name", "Did the Agent Attend?", "Full Name"];
    expect(identifyFile(headers, {}).kind).toBe("shyftnav");
  });

  it("identifies Removed Reports export by 'Removed' status", () => {
    const headers = ["shyftoff_id", "campaign_application_id", "background_check", "certification_progress", "agent_nm"];
    expect(identifyFile(headers, { status: "Removed - Certification Stale" }).kind).toBe("removed");
    expect(identifyFile(headers, { status: "Removed - Performance" }).kind).toBe("removed");
    expect(identifyFile(headers, { status: "Removed" }).kind).toBe("removed");
  });

  it("does NOT misidentify CIP as Removed when status doesn't start with Removed", () => {
    // Regression guard: same column set, different status. CIP must still
    // resolve to "cip" (or roster/nesting where applicable).
    const headers = ["shyftoff_id", "campaign_application_id", "background_check", "certification_progress", "agent_nm"];
    expect(identifyFile(headers, { status: "Roster - Credentials Requested" }).kind).toBe("cip");
    expect(identifyFile(headers, { status: "Nesting - First Call" }).kind).toBe("cip");
    expect(identifyFile(headers, { status: "Production" }).kind).toBe("production-export");
  });

  it("returns unknown for unrecognized headers", () => {
    expect(identifyFile(["foo", "bar", "baz"], {}).kind).toBe("unknown");
  });
});

describe("validateSlot", () => {
  it("allows correct file types in their expected slots", () => {
    expect(validateSlot("litmos", "litmos-course")).toBe(null);
    expect(validateSlot("people", "litmos-people")).toBe(null);
    expect(validateSlot("nav", "shyftnav")).toBe(null);
    expect(validateSlot("cip", "cip")).toBe(null);
    expect(validateSlot("cip", "roster")).toBe(null);
    expect(validateSlot("cip", "nesting")).toBe(null);
    expect(validateSlot("prod", "production")).toBe(null);
    expect(validateSlot("prod", "production-export")).toBe(null);
    expect(validateSlot("removed", "removed")).toBe(null);
  });

  it("rejects a Removed export dropped into the CIP slot", () => {
    // Critical regression guard — if removed data leaks into the active
    // pipeline calculation, "removed" agents would re-appear as ghosts /
    // bg mismatches / etc. The schema check must catch this.
    expect(validateSlot("cip", "removed")).not.toBe(null);
  });

  it("rejects mismatched files (Litmos in Nav slot)", () => {
    expect(validateSlot("nav", "litmos-people")).not.toBe(null);
  });

  it("rejects unknown file types", () => {
    expect(validateSlot("litmos", "unknown")).not.toBe(null);
  });
});
