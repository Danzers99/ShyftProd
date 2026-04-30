import { describe, it, expect } from "vitest";
import {
  buildBackupPayload,
  validateBackupPayload,
} from "../storageExtras";

describe("buildBackupPayload", () => {
  it("wraps current + history in a versioned envelope", () => {
    const snap = { savedAt: 1700000000000, parsedData: {} };
    const hist = [{ date: "2026-04-29", savedAt: 123, agentSnapshot: { agents: {} } }];
    const p = buildBackupPayload(snap, hist);
    expect(p.schema).toBe("shyftprod-backup/v1");
    expect(typeof p.exportedAt).toBe("string");
    expect(p.snapshot).toBe(snap);
    expect(p.history).toBe(hist);
  });

  it("normalizes nullish inputs", () => {
    const p = buildBackupPayload(null, null);
    expect(p.snapshot).toBeNull();
    expect(p.history).toEqual([]);
  });

  it("normalizes non-array history to empty array", () => {
    const p = buildBackupPayload(null, "not an array");
    expect(p.history).toEqual([]);
  });
});

describe("validateBackupPayload", () => {
  it("accepts a well-formed v1 payload", () => {
    expect(validateBackupPayload({
      schema: "shyftprod-backup/v1",
      exportedAt: "2026-04-29T00:00:00Z",
      snapshot: null,
      history: [],
    }).ok).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(validateBackupPayload(null).ok).toBe(false);
    expect(validateBackupPayload("hello").ok).toBe(false);
    expect(validateBackupPayload(42).ok).toBe(false);
  });

  it("rejects unknown schema versions", () => {
    const r = validateBackupPayload({ schema: "shyftprod-backup/v2" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("v2");
  });

  it("rejects payloads where history isn't an array", () => {
    const r = validateBackupPayload({
      schema: "shyftprod-backup/v1",
      history: { not: "an array" },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("array");
  });

  it("accepts payload with only snapshot (no history field)", () => {
    expect(validateBackupPayload({
      schema: "shyftprod-backup/v1",
      snapshot: { savedAt: 0 },
    }).ok).toBe(true);
  });
});

describe("buildBackupPayload + validateBackupPayload roundtrip", () => {
  it("validate accepts whatever buildBackupPayload produces", () => {
    const built = buildBackupPayload(
      { savedAt: 1, parsedData: { litmosData: [] } },
      [
        { date: "2026-04-27", savedAt: 1, agentSnapshot: { agents: {} } },
        { date: "2026-04-28", savedAt: 2, agentSnapshot: { agents: {} } },
      ],
    );
    expect(validateBackupPayload(built).ok).toBe(true);
  });
});
