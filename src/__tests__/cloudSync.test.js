// cloudSync interacts with fetch, so we stub global fetch per test.
//
// The module reads import.meta.env.* at import time. Vitest exposes them
// as undefined unless configured, so isCloudSyncConfigured() returns false
// in this test file — which lets us verify the no-op paths.
//
// For the active-path tests, we re-import the module after stubbing the
// env via vi.stubEnv(), then exercise fetch via vi.stubGlobal("fetch").

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---- No-config paths ------------------------------------------------------

describe("cloudSync — no-config behavior", () => {
  it("isCloudSyncConfigured returns false when env vars are unset", async () => {
    const mod = await import("../cloudSync");
    expect(mod.isCloudSyncConfigured()).toBe(false);
  });

  it("pushHistoryToCloud returns 'no-config' and never calls fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const mod = await import("../cloudSync");
    const result = await mod.pushHistoryToCloud({ date: "2026-04-29", savedAt: 0 });
    expect(result).toBe("no-config");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("listCloudSnapshots returns [] when not configured", async () => {
    const mod = await import("../cloudSync");
    expect(await mod.listCloudSnapshots()).toEqual([]);
  });

  it("fetchCloudSnapshot returns null when not configured", async () => {
    const mod = await import("../cloudSync");
    expect(await mod.fetchCloudSnapshot("2026-04-29")).toBeNull();
  });
});

// ---- Configured paths -----------------------------------------------------

describe("cloudSync — configured behavior", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SHYFTPROD_API_TOKEN", "test-token");
    vi.stubEnv("VITE_SHYFTPROD_API_BASE", "/api/snapshots");
  });

  it("pushHistoryToCloud POSTs with Authorization header and JSON body", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const mod = await import("../cloudSync");
    const entry = { date: "2026-04-29", savedAt: 1000, stats: { x: 1 } };
    const result = await mod.pushHistoryToCloud(entry);
    expect(result).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/snapshots");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer test-token");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(opts.body);
    expect(body).toEqual({ date: "2026-04-29", payload: entry });
  });

  it("pushHistoryToCloud returns 'error' on non-2xx", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 401 }));
    const mod = await import("../cloudSync");
    const result = await mod.pushHistoryToCloud({ date: "2026-04-29" });
    expect(result).toBe("error");
  });

  it("pushHistoryToCloud returns 'error' when fetch throws", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("network down"); });
    const mod = await import("../cloudSync");
    const result = await mod.pushHistoryToCloud({ date: "2026-04-29" });
    expect(result).toBe("error");
  });

  it("pushHistoryToCloud rejects entries without a date", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const mod = await import("../cloudSync");
    expect(await mod.pushHistoryToCloud({})).toBe("error");
    expect(await mod.pushHistoryToCloud(null)).toBe("error");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("listCloudSnapshots returns the entries array from the API response", async () => {
    vi.stubGlobal("fetch", async () => new Response(
      JSON.stringify({ count: 2, entries: [
        { date: "2026-04-28", savedAt: 1, stats: null },
        { date: "2026-04-27", savedAt: 0, stats: null },
      ]}),
      { status: 200 },
    ));
    const mod = await import("../cloudSync");
    const list = await mod.listCloudSnapshots();
    expect(list).toHaveLength(2);
    expect(list[0].date).toBe("2026-04-28");
  });

  it("listCloudSnapshots returns [] on API error", async () => {
    vi.stubGlobal("fetch", async () => new Response("err", { status: 500 }));
    const mod = await import("../cloudSync");
    expect(await mod.listCloudSnapshots()).toEqual([]);
  });

  it("fetchCloudSnapshot returns the snapshot body for valid date", async () => {
    const snap = { date: "2026-04-29", savedAt: 1, agentSnapshot: { agents: {} } };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(snap), { status: 200 }));
    const mod = await import("../cloudSync");
    const result = await mod.fetchCloudSnapshot("2026-04-29");
    expect(result).toEqual(snap);
  });

  it("fetchCloudSnapshot returns null on 404", async () => {
    vi.stubGlobal("fetch", async () => new Response("not found", { status: 404 }));
    const mod = await import("../cloudSync");
    expect(await mod.fetchCloudSnapshot("2026-04-29")).toBeNull();
  });

  it("fetchCloudSnapshot rejects invalid date format without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const mod = await import("../cloudSync");
    expect(await mod.fetchCloudSnapshot("not-a-date")).toBeNull();
    expect(await mod.fetchCloudSnapshot("")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pushAllLocalHistoryToCloud only pushes dates not already in cloud", async () => {
    let callIdx = 0;
    const fetchSpy = vi.fn(async (url, opts) => {
      callIdx++;
      if (callIdx === 1) {
        // GET list — cloud already has 2026-04-27
        return new Response(JSON.stringify({ count: 1, entries: [{ date: "2026-04-27" }] }), { status: 200 });
      }
      // POST — should only fire for 2026-04-28 + 2026-04-29
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const mod = await import("../cloudSync");
    const local = [
      { date: "2026-04-27", savedAt: 1 },
      { date: "2026-04-28", savedAt: 2 },
      { date: "2026-04-29", savedAt: 3 },
    ];
    const result = await mod.pushAllLocalHistoryToCloud(local);
    expect(result.pushed).toBe(2);
    expect(result.skipped).toBe(1);
    // First call is the list, then 2 POSTs
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("pullCloudHistoryToLocal only pulls dates not already local", async () => {
    let callIdx = 0;
    vi.stubGlobal("fetch", async (url) => {
      callIdx++;
      if (callIdx === 1) {
        // GET list — cloud has 3 dates
        return new Response(JSON.stringify({ count: 3, entries: [
          { date: "2026-04-27" },
          { date: "2026-04-28" },
          { date: "2026-04-29" },
        ]}), { status: 200 });
      }
      // GET specific — return a stub payload
      const date = url.split("/").pop();
      return new Response(JSON.stringify({ date, savedAt: 0, agentSnapshot: { agents: {} } }), { status: 200 });
    });
    const mod = await import("../cloudSync");
    const local = [{ date: "2026-04-27" }];
    const saved = [];
    const result = await mod.pullCloudHistoryToLocal(local, async (entry) => { saved.push(entry); });
    expect(result.pulled).toBe(2);
    expect(result.alreadyHave).toBe(1);
    expect(result.failed).toBe(0);
    expect(saved.map(s => s.date).sort()).toEqual(["2026-04-28", "2026-04-29"]);
  });

  it("pullCloudHistoryToLocal counts failures when saveLocal throws", async () => {
    let callIdx = 0;
    vi.stubGlobal("fetch", async () => {
      callIdx++;
      if (callIdx === 1) {
        return new Response(JSON.stringify({ entries: [{ date: "2026-04-29" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ date: "2026-04-29" }), { status: 200 });
    });
    const mod = await import("../cloudSync");
    const result = await mod.pullCloudHistoryToLocal([], async () => { throw new Error("disk full"); });
    expect(result.failed).toBe(1);
    expect(result.pulled).toBe(0);
  });
});
