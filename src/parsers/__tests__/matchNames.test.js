import { describe, it, expect } from "vitest";
import { normalize, nameKey, nameParts, stripMiddleInitials, nameKeyVariations, candidateEmails } from "../matchNames";

describe("normalize", () => {
  it("lowercases and strips whitespace/dots/apostrophes", () => {
    expect(normalize("John Doe")).toBe("johndoe");
    expect(normalize("M.Cecilia")).toBe("mcecilia");
    expect(normalize("De'Ja")).toBe("deja");
    expect(normalize("Jenny Nunn-Stanley")).toBe("jennynunnstanley");
  });

  it("handles unicode smart quotes (apostrophe edge cases)", () => {
    // Te'asia uses ASCII apostrophe; De'Ja uses Unicode U+2019
    expect(normalize("Te'asia")).toBe("teasia");
    expect(normalize("De\u2019Ja")).toBe("deja");
  });

  it("returns empty string for null/undefined", () => {
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
    expect(normalize("")).toBe("");
  });
});

describe("nameKey", () => {
  it("produces stable first|last keys", () => {
    expect(nameKey("John", "Doe")).toBe("john|doe");
    expect(nameKey("john", "doe")).toBe("john|doe");
    expect(nameKey("De'Ja", "Sanders")).toBe("deja|sanders");
  });
});

describe("nameParts", () => {
  it("splits 2-token names", () => {
    expect(nameParts("John Doe")).toEqual({ first: "John", last: "Doe" });
  });

  it("returns first and LAST tokens for multi-part names", () => {
    expect(nameParts("Andre Odell Jackie Collier")).toEqual({ first: "Andre", last: "Collier" });
  });

  it("handles single-token names", () => {
    expect(nameParts("Madonna")).toEqual({ first: "Madonna", last: "Madonna" });
  });
});

describe("stripMiddleInitials", () => {
  it("removes single-letter tokens with optional dots", () => {
    expect(stripMiddleInitials("Candace I. Monger")).toBe("Candace Monger");
    expect(stripMiddleInitials("Candace I Monger")).toBe("Candace Monger");
    expect(stripMiddleInitials("Candace Monger I")).toBe("Candace Monger");
  });

  it("preserves names without middle initials", () => {
    expect(stripMiddleInitials("John Doe")).toBe("John Doe");
  });

  it("does not strip 2+ letter tokens", () => {
    expect(stripMiddleInitials("Jo Doe")).toBe("Jo Doe");
  });
});

describe("nameKeyVariations", () => {
  it("handles middle initial in any position (Candace I. Monger / Candace Monger I)", () => {
    // The classic regression: Litmos has First=Candace Last="Monger I", pipeline has "Candace I. Monger"
    const pipelineKeys = nameKeyVariations("Candace I. Monger");
    const litmosKeys = nameKeyVariations("Candace Monger I");
    // Both should produce "candace|monger" as one variation
    expect(pipelineKeys).toContain("candace|monger");
    expect(litmosKeys).toContain("candace|monger");
  });

  it("handles 3+ token names like Sid Toria Melton", () => {
    const keys = nameKeyVariations("Sid Toria Melton");
    expect(keys).toContain("sid|melton");
    expect(keys).toContain("sidtoria|melton");
    expect(keys).toContain("sid|toriamelton");
  });

  it("handles 4 token names like Andre Odell Jackie Collier", () => {
    const keys = nameKeyVariations("Andre Odell Jackie Collier");
    expect(keys).toContain("andre|collier");
    expect(keys).toContain("andreodelljackie|collier");
  });

  it("handles hyphenated last names", () => {
    const keys = nameKeyVariations("Jenny Nunn-Stanley");
    expect(keys).toContain("jenny|nunnstanley");
  });

  it("returns empty for single-token or empty names", () => {
    expect(nameKeyVariations("Madonna")).toEqual([]);
    expect(nameKeyVariations("")).toEqual([]);
    expect(nameKeyVariations(null)).toEqual([]);
  });
});

describe("candidateEmails", () => {
  it("generates standard first.last@nationsbenefits.com pattern", () => {
    const emails = candidateEmails("John Doe");
    expect(emails).toContain("john.doe@nationsbenefits.com");
  });

  it("generates joined-token variations for 3+ part names", () => {
    const emails = candidateEmails("Sid Toria Melton");
    expect(emails).toContain("sid.melton@nationsbenefits.com");
    expect(emails).toContain("sidtoria.melton@nationsbenefits.com");
    expect(emails).toContain("sid.toriamelton@nationsbenefits.com");
  });

  it("strips smart quotes and apostrophes from name parts", () => {
    const emails = candidateEmails("De\u2019Ja Sanders");
    expect(emails).toContain("deja.sanders@nationsbenefits.com");
  });

  it("handles dots in first name (M.Cecilia Maseda)", () => {
    const emails = candidateEmails("M.Cecilia Maseda");
    expect(emails).toContain("cecilia.maseda@nationsbenefits.com");
  });

  it("returns empty for names with fewer than 2 tokens", () => {
    expect(candidateEmails("Madonna")).toEqual([]);
    expect(candidateEmails("")).toEqual([]);
  });
});
