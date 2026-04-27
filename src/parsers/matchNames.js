/**
 * Name normalization and matching utilities.
 *
 * Agent names appear in many slightly different formats across data sources
 * (Litmos People Report, Course Data, CIP exports, Roster CSVs, etc.).
 * These helpers produce stable keys that match across formats while handling:
 * - Apostrophes (ASCII + Unicode smart quotes)
 * - Hyphens, dots (middle initials)
 * - Whitespace variations
 * - Multi-part names ("Jenny Nunn-Stanley", "Andre Odell Jackie Collier")
 * - Middle initials in any position ("Candace I. Monger" vs "Candace Monger I")
 */

/**
 * Strip punctuation and whitespace, lowercase, for stable comparison.
 * Removes: dots, apostrophes (ASCII + smart), backticks, hyphens, whitespace.
 */
export function normalize(s) {
  return (s || "").toLowerCase().replace(/[.'''`\u2018\u2019\u201B\-\s]+/g, "").trim();
}

/**
 * Build a "first|last" key from two name parts.
 */
export function nameKey(first, last) {
  return `${normalize(first)}|${normalize(last)}`;
}

/**
 * Split a full name string into first and last tokens.
 * For multi-part names, takes the first and last whitespace-separated tokens.
 */
export function nameParts(fullName) {
  const p = (fullName || "").trim().split(/\s+/);
  return { first: p[0] || "", last: p[p.length - 1] || "" };
}

/**
 * Strip single-letter tokens (middle initials like "I.", "J", "M.") from a name.
 * Handles both "Candace I. Monger" and "Candace Monger I" → "Candace Monger".
 */
export function stripMiddleInitials(fullName) {
  return (fullName || "")
    .trim()
    .split(/\s+/)
    .filter(p => {
      const cleaned = p.replace(/[.,]/g, "");
      return cleaned.length > 1; // drop single-letter tokens
    })
    .join(" ");
}

/**
 * Generate all name key variations for a full name.
 * Used for matching against People Report entries that may store middle
 * initials in different positions or fields.
 *
 * For "Candace I. Monger" returns:
 *   ["candace|monger", "candacei|monger", "candace|imonger"]
 *
 * For "Jenny Nunn-Stanley" returns:
 *   ["jenny|nunnstanley"]
 */
export function nameKeyVariations(fullName) {
  const keys = new Set();
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    // Standard: first + last
    keys.add(nameKey(parts[0], parts[parts.length - 1]));
    // Multi-part variations for 3+ token names
    if (parts.length > 2) {
      keys.add(nameKey(parts.slice(0, -1).join(""), parts[parts.length - 1]));
      keys.add(nameKey(parts[0], parts.slice(1).join("")));
    }
    // Middle-initial-stripped version
    const stripped = stripMiddleInitials(fullName).split(/\s+/).filter(Boolean);
    if (stripped.length >= 2 && stripped.length !== parts.length) {
      keys.add(nameKey(stripped[0], stripped[stripped.length - 1]));
    }
  }
  return [...keys];
}

/**
 * Generate candidate NB email addresses from a full name.
 * Used to match pipeline agents against Litmos usernames by email.
 *
 * For "Sid Toria Melton" returns:
 *   sid.melton@nationsbenefits.com
 *   sidtoria.melton@nationsbenefits.com
 *   sid.toriamelton@nationsbenefits.com
 *
 * Strips smart quotes and apostrophes before generating.
 */
export function candidateEmails(fullName) {
  const parts = (fullName || "").trim().replace(/['''`\u2018\u2019\u201B]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [];
  const domain = "nationsbenefits.com";
  const emails = new Set();
  const last = parts[parts.length - 1];
  // Standard: First.Last
  emails.add(`${parts[0]}.${last}@${domain}`.toLowerCase());
  if (parts.length > 2) {
    // FirstMiddle.Last (e.g., "Sid Toria Melton" -> "SidToria.Melton")
    const allButLast = parts.slice(0, -1).join("");
    emails.add(`${allButLast}.${last}@${domain}`.toLowerCase());
    // First.MiddleLast
    const allButFirst = parts.slice(1).join("");
    emails.add(`${parts[0]}.${allButFirst}@${domain}`.toLowerCase());
  }
  // Handle dots in first name: "M.Cecilia Maseda" -> "Cecilia.Maseda"
  if (parts[0].includes(".")) {
    const afterDot = parts[0].split(".").pop();
    if (afterDot) emails.add(`${afterDot}.${last}@${domain}`.toLowerCase());
  }
  return [...emails];
}
