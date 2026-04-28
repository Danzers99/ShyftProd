// Tiny URL-state helpers — keep filter/search/sections in the address bar so
// reloads and shared links preserve the view. Uses replaceState so we don't
// pollute the back button (each keystroke would otherwise create a history
// entry).
//
// API:
//   readUrlState() → { filter, search, sections: Set<string> }
//   writeUrlState({ filter, search, sections }) → void
//
// Anything missing from the URL falls back to defaults handled by the caller.

const DEFAULT_FILTER = "all";
const DEFAULT_SECTIONS = ["diff", "outreach", "health", "creds"];

export function readUrlState() {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const filter = params.get("filter") || DEFAULT_FILTER;
    const search = params.get("q") || "";
    const sectionsRaw = params.get("sections");
    const sections = sectionsRaw
      ? new Set(sectionsRaw.split(",").filter(Boolean))
      : new Set(DEFAULT_SECTIONS);
    return { filter, search, sections };
  } catch {
    return null;
  }
}

export function writeUrlState({ filter, search, sections }) {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams();
    if (filter && filter !== DEFAULT_FILTER) params.set("filter", filter);
    if (search) params.set("q", search);
    if (sections instanceof Set) {
      const arr = [...sections].sort();
      // Only include if non-default — keeps the URL clean for the common case.
      const defaultArr = [...DEFAULT_SECTIONS].sort();
      const isDefault = arr.length === defaultArr.length && arr.every((v, i) => v === defaultArr[i]);
      if (!isDefault) params.set("sections", arr.join(","));
    }
    const queryString = params.toString();
    const newUrl = queryString
      ? `${window.location.pathname}?${queryString}`
      : window.location.pathname;
    // Skip the history write if nothing changed — avoids needless DOM work
    // when state changes that don't affect URL fields fire the effect.
    if (window.location.pathname + window.location.search === newUrl) return;
    window.history.replaceState(null, "", newUrl);
  } catch {
    // Best-effort — URL state isn't critical, just convenience.
  }
}
