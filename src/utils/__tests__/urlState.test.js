import { describe, it, expect, beforeEach, vi } from "vitest";
import { readUrlState, writeUrlState } from "../urlState";

// Tiny window stub — the urlState module only touches window.location +
// window.history.replaceState. No need for a full DOM.
function makeWindowStub(initialUrl = "/") {
  const url = new URL("http://localhost" + initialUrl);
  const stub = {
    location: {
      get pathname() { return url.pathname; },
      get search() { return url.search; },
      get href() { return url.href; },
    },
    history: {
      replaceState: vi.fn((_state, _title, newUrl) => {
        // Match browser behavior: relative URLs resolve against current
        const next = new URL(newUrl, url);
        url.pathname = next.pathname;
        url.search = next.search;
      }),
    },
  };
  return stub;
}

beforeEach(() => {
  vi.stubGlobal("window", makeWindowStub("/"));
});

describe("readUrlState", () => {
  it("returns defaults when URL is empty", () => {
    const s = readUrlState();
    expect(s.filter).toBe("all");
    expect(s.search).toBe("");
    expect(s.sections.has("diff")).toBe(true);
    expect(s.sections.has("outreach")).toBe(true);
  });

  it("reads filter and q from URL params", () => {
    vi.stubGlobal("window", makeWindowStub("/?filter=ghosts&q=charn"));
    const s = readUrlState();
    expect(s.filter).toBe("ghosts");
    expect(s.search).toBe("charn");
  });

  it("parses comma-separated sections", () => {
    vi.stubGlobal("window", makeWindowStub("/?sections=health,creds"));
    const s = readUrlState();
    expect(s.sections.has("health")).toBe(true);
    expect(s.sections.has("creds")).toBe(true);
    expect(s.sections.has("diff")).toBe(false);
  });

  it("falls back to default sections set when sections param is missing", () => {
    vi.stubGlobal("window", makeWindowStub("/?filter=ready"));
    const s = readUrlState();
    expect(s.sections.has("diff")).toBe(true);
  });

  it("filters out empty section tokens", () => {
    vi.stubGlobal("window", makeWindowStub("/?sections=,health,,creds,"));
    const s = readUrlState();
    expect(s.sections.size).toBe(2);
    expect(s.sections.has("health")).toBe(true);
    expect(s.sections.has("creds")).toBe(true);
  });
});

describe("writeUrlState", () => {
  it("omits filter from URL when it equals the default", () => {
    writeUrlState({ filter: "all", search: "", sections: new Set(["diff", "outreach", "health", "creds"]) });
    expect(window.location.search).toBe("");
  });

  it("writes non-default filter and search", () => {
    writeUrlState({ filter: "ghosts", search: "char", sections: new Set(["diff", "outreach", "health", "creds"]) });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("filter")).toBe("ghosts");
    expect(params.get("q")).toBe("char");
    expect(params.has("sections")).toBe(false); // default set, omitted
  });

  it("writes sections only when they differ from default", () => {
    writeUrlState({ filter: "all", search: "", sections: new Set(["health"]) });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("sections")).toBe("health");
  });

  it("preserves sections in sorted order so URLs are stable across renders", () => {
    writeUrlState({ filter: "all", search: "", sections: new Set(["health", "diff", "creds"]) });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("sections")).toBe("creds,diff,health");
  });

  it("strips the query string entirely when everything is default", () => {
    vi.stubGlobal("window", makeWindowStub("/?filter=ghosts"));
    writeUrlState({ filter: "all", search: "", sections: new Set(["diff", "outreach", "health", "creds"]) });
    expect(window.location.search).toBe("");
  });

  it("round-trips: writeUrlState then readUrlState recovers the same state", () => {
    const sections = new Set(["health", "creds"]);
    writeUrlState({ filter: "needs_bump", search: "deja", sections });
    const recovered = readUrlState();
    expect(recovered.filter).toBe("needs_bump");
    expect(recovered.search).toBe("deja");
    expect(recovered.sections).toEqual(sections);
  });

  it("does not call replaceState if the URL is already correct", () => {
    const win = makeWindowStub("/?filter=ghosts");
    vi.stubGlobal("window", win);
    writeUrlState({ filter: "ghosts", search: "", sections: new Set(["diff", "outreach", "health", "creds"]) });
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });
});
