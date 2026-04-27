import { describe, it, expect } from "vitest";
import { parseCSV } from "../parseCSV";

describe("parseCSV", () => {
  it("parses basic CSV with headers", () => {
    const text = "name,age\nJohn,30\nJane,25";
    expect(parseCSV(text)).toEqual([
      { name: "John", age: "30" },
      { name: "Jane", age: "25" },
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    const text = 'name,city\nJohn,"New York, NY"\nJane,Boston';
    const result = parseCSV(text);
    expect(result[0].city).toBe("New York, NY");
    expect(result[1].city).toBe("Boston");
  });

  it("handles escaped quotes within quoted fields", () => {
    const text = 'name,quote\nJohn,"He said ""hi"""';
    expect(parseCSV(text)[0].quote).toBe('He said "hi"');
  });

  it("handles \\r\\n line endings", () => {
    const text = "a,b\r\n1,2\r\n3,4";
    expect(parseCSV(text)).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("strips BOM from first header", () => {
    const text = "\uFEFFname,age\nJohn,30";
    const result = parseCSV(text);
    expect(Object.keys(result[0])).toEqual(["name", "age"]);
  });

  it("filters out empty trailing rows", () => {
    const text = "a,b\n1,2\n\n";
    expect(parseCSV(text)).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    expect(parseCSV("")).toEqual([]);
  });

  it("trims whitespace from cell values", () => {
    const text = "name,age\n  John  ,  30  ";
    expect(parseCSV(text)[0]).toEqual({ name: "John", age: "30" });
  });

  it("handles multi-line quoted fields", () => {
    const text = 'a,b\n"line1\nline2",x';
    expect(parseCSV(text)[0].a).toBe("line1\nline2");
  });
});
