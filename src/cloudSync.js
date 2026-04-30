// Cloudflare KV-backed durable storage for daily history entries.
//
// IndexedDB stays the local-first cache (instant reads, offline OK). Cloud
// sync is the durable cloud-of-record so history survives browser clears,
// device switches, and OS reinstalls.
//
// Endpoints (Cloudflare Pages Functions, see /functions/api/snapshots/):
//   POST /api/snapshots         — upsert by date
//   GET  /api/snapshots         — list { count, entries: [{date, savedAt, stats}] }
//   GET  /api/snapshots/:date   — fetch one
//
// Auth: Bearer token via VITE_SHYFTPROD_API_TOKEN. Internal tool — token
// in client JS is acceptable. For stronger guarantees, put the Pages
// project behind Cloudflare Access (the function still validates the
// bearer token as defense-in-depth).

const API_BASE = (import.meta.env.VITE_SHYFTPROD_API_BASE || "").replace(/\/+$/, "")
                 || "/api/snapshots";  // default: same-origin
const API_TOKEN = import.meta.env.VITE_SHYFTPROD_API_TOKEN;

export function isCloudSyncConfigured() {
  return Boolean(API_TOKEN);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

/**
 * Push a single history entry to the cloud (upsert by date).
 * Resolves to "ok" / "no-config" / "error".
 */
export async function pushHistoryToCloud(entry) {
  if (!isCloudSyncConfigured()) return "no-config";
  if (!entry || !entry.date) return "error";
  try {
    const r = await fetch(API_BASE, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ date: entry.date, payload: entry }),
      keepalive: true,
    });
    if (!r.ok) {
      console.warn("Cloud sync push:", r.status, await r.text().catch(() => ""));
      return "error";
    }
    return "ok";
  } catch (e) {
    console.warn("Cloud sync push failed:", e);
    return "error";
  }
}

/**
 * List all snapshot dates in cloud storage. Returns array sorted by date desc.
 * Each entry has { date, savedAt, stats } — full payload not fetched.
 */
export async function listCloudSnapshots() {
  if (!isCloudSyncConfigured()) return [];
  try {
    const r = await fetch(API_BASE, { headers: authHeaders() });
    if (!r.ok) {
      console.warn("Cloud sync list:", r.status);
      return [];
    }
    const body = await r.json();
    return Array.isArray(body?.entries) ? body.entries : [];
  } catch (e) {
    console.warn("Cloud sync list failed:", e);
    return [];
  }
}

/**
 * Fetch a single snapshot by date. Returns the full payload or null.
 */
export async function fetchCloudSnapshot(date) {
  if (!isCloudSyncConfigured()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
  try {
    const r = await fetch(`${API_BASE}/${date}`, { headers: authHeaders() });
    if (r.status === 404) return null;
    if (!r.ok) {
      console.warn("Cloud sync fetch:", r.status);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn("Cloud sync fetch failed:", e);
    return null;
  }
}

/**
 * Sync local IndexedDB history to the cloud (push any local entries that
 * aren't already in cloud). Idempotent. Cheap when there's nothing to push
 * (one GET, no PUTs).
 *
 * @param {Array} localHistory - the array returned by storage.loadHistory()
 * @returns { pushed: number, skipped: number }
 */
export async function pushAllLocalHistoryToCloud(localHistory) {
  if (!isCloudSyncConfigured()) return { pushed: 0, skipped: 0 };
  const cloudEntries = await listCloudSnapshots();
  const cloudDates = new Set(cloudEntries.map(e => e.date));
  let pushed = 0, skipped = 0;
  for (const entry of localHistory || []) {
    if (!entry?.date) { skipped++; continue; }
    if (cloudDates.has(entry.date)) { skipped++; continue; }
    const status = await pushHistoryToCloud(entry);
    if (status === "ok") pushed++;
    else skipped++;
  }
  return { pushed, skipped };
}

/**
 * Pull cloud history into local IndexedDB. For each cloud entry not present
 * locally, fetches the full payload and writes it via the provided saver.
 *
 * @param {Array} localHistory - existing local entries (for dedup)
 * @param {Function} saveLocal - async (entry) => void  (e.g. saveHistoryEntry)
 * @returns { pulled: number, alreadyHave: number, failed: number }
 */
export async function pullCloudHistoryToLocal(localHistory, saveLocal) {
  if (!isCloudSyncConfigured()) return { pulled: 0, alreadyHave: 0, failed: 0 };
  const localDates = new Set((localHistory || []).map(e => e.date));
  const cloudEntries = await listCloudSnapshots();
  let pulled = 0, alreadyHave = 0, failed = 0;
  for (const meta of cloudEntries) {
    if (localDates.has(meta.date)) { alreadyHave++; continue; }
    const full = await fetchCloudSnapshot(meta.date);
    if (!full) { failed++; continue; }
    try {
      await saveLocal(full);
      pulled++;
    } catch (e) {
      console.warn("Cloud sync local-write failed:", e);
      failed++;
    }
  }
  return { pulled, alreadyHave, failed };
}
