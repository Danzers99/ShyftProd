// IndexedDB hardening helpers — request persistent storage, dump/restore
// for manual JSON backups, and a tiny health check for the UI.
//
// These are independent of the IndexedDB wrapper in storage.js — they
// just sit alongside it. The actual snapshot read/write still goes
// through the existing storage.js API.

/**
 * Ask the browser to keep IndexedDB even under storage pressure. Once
 * granted, the data won't be auto-evicted unless the user explicitly
 * clears site data.
 *
 * Returns one of:
 *   "persistent"     — already persistent
 *   "granted"        — request just succeeded
 *   "denied"         — browser declined (rare; usually requires PWA install)
 *   "unsupported"    — Storage API not available
 */
export async function requestPersistentStorage() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return "unsupported";
  }
  try {
    const already = await navigator.storage.persisted();
    if (already) return "persistent";
    const granted = await navigator.storage.persist();
    return granted ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

/**
 * Quick read-only check: is IndexedDB currently marked as persistent?
 * Used for the storage-health badge in the cache bar.
 */
export async function isStoragePersistent() {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return false;
  try { return await navigator.storage.persisted(); }
  catch { return false; }
}

/**
 * Estimated storage usage. Returns null if API unsupported.
 * Useful for "you're using X MB of Y MB" indicators.
 */
export async function getStorageEstimate() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Build a backup payload from the current snapshot + all history entries.
 * Pure — pass in the data, get a JSON-serializable object back.
 *
 * @param {object|null} snapshot - current full snapshot from loadSnapshot()
 * @param {Array} history - all history entries from loadHistory()
 */
export function buildBackupPayload(snapshot, history) {
  return {
    schema: "shyftprod-backup/v1",
    exportedAt: new Date().toISOString(),
    snapshot: snapshot || null,
    history: Array.isArray(history) ? history : [],
  };
}

/**
 * Validate the shape of a backup file before restoring. Returns
 * { ok: true } or { ok: false, reason: string }.
 */
export function validateBackupPayload(obj) {
  if (!obj || typeof obj !== "object") return { ok: false, reason: "Not a JSON object" };
  if (obj.schema !== "shyftprod-backup/v1") {
    return { ok: false, reason: `Unknown schema "${obj.schema}" (expected shyftprod-backup/v1)` };
  }
  if (obj.history !== undefined && !Array.isArray(obj.history)) {
    return { ok: false, reason: "history must be an array" };
  }
  return { ok: true };
}

/**
 * Trigger a JSON file download in the browser. Pure side-effect helper.
 * Returns the filename used.
 */
export function downloadJson(payload, basename = "shyftprod-backup") {
  if (typeof document === "undefined" || typeof URL === "undefined") return null;
  const today = new Date().toISOString().slice(0, 10);
  const filename = `${basename}-${today}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the download has time to start
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/**
 * Read a File (from <input type=file>) and parse as JSON.
 * Resolves to { ok: true, payload } or { ok: false, reason }.
 */
export async function readJsonFile(file) {
  if (!file) return { ok: false, reason: "No file provided" };
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    return { ok: true, payload: parsed };
  } catch (e) {
    return { ok: false, reason: `Couldn't parse ${file.name}: ${e.message}` };
  }
}
