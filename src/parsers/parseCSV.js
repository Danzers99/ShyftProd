/**
 * Parse a CSV string into an array of row objects keyed by header.
 * Handles:
 * - Quoted fields with embedded commas, newlines, and "" escapes
 * - Mixed line endings (\r, \n, \r\n)
 * - BOM marker stripping on first header
 * - Empty trailing rows
 *
 * Returns: Array<Record<string, string>>
 *
 * Note: this is a relatively forgiving parser. It does NOT validate
 * column counts row-to-row — missing values are returned as empty strings.
 */
export function parseCSV(text) {
  const lines = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if ((ch === "," || ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === ",") {
        if (!lines.length || lines[lines.length - 1].done) {
          lines.push({ cells: [current], done: false });
        } else {
          lines[lines.length - 1].cells.push(current);
        }
        current = "";
      } else {
        if (current || (lines.length && !lines[lines.length - 1].done)) {
          if (!lines.length || lines[lines.length - 1].done) {
            lines.push({ cells: [current], done: true });
          } else {
            lines[lines.length - 1].cells.push(current);
            lines[lines.length - 1].done = true;
          }
        }
        current = "";
        if (ch === "\r" && text[i + 1] === "\n") i++;
      }
    } else {
      current += ch;
    }
  }
  if (current || (lines.length && !lines[lines.length - 1].done)) {
    if (!lines.length || lines[lines.length - 1].done) {
      lines.push({ cells: [current], done: true });
    } else {
      lines[lines.length - 1].cells.push(current);
    }
  }
  const rows = lines.map(l => l.cells);
  if (!rows.length) return [];
  // Strip BOM from first header if present
  const headers = rows[0].map(h => h.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).filter(r => r.some(c => c.trim())).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] || "").trim(); });
    return obj;
  });
}
