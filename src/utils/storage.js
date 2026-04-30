// IndexedDB wrapper for persisting the current pipeline snapshot.
// Stores a single "current" snapshot that overwrites on each Analyze.
// Auto-expires after 7 days so stale data doesn't accumulate forever.
//
// Why IndexedDB over localStorage: parsed CSV data can easily exceed 5-10MB
// (production exports with JSON cert progress are large). localStorage caps
// at ~5MB; IndexedDB has hundreds of MB available.

const DB_NAME = "shyftprod";
const DB_VERSION = 1;
const STORE = "snapshots";
const SNAPSHOT_KEY = "current";
const MAX_AGE_DAYS = 7;
const HISTORY_RETENTION_DAYS = 30; // Keep daily snapshots for trend analysis

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try { result = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/**
 * Save the current snapshot (overwrites any previous "current"). The dated
 * history entry is written separately by saveHistoryEntry — that lets the
 * caller persist the rich agent-level digest AFTER the results useMemo has
 * computed flags, instead of duplicating that logic inline in handleProcess.
 * @param {object} snapshot - { parsedData, fileMeta }
 */
export async function saveSnapshot(snapshot) {
  const now = Date.now();
  const fullPayload = { ...snapshot, savedAt: now };
  try {
    await tx("readwrite", store => {
      store.put(fullPayload, SNAPSHOT_KEY);
    });
    return now;
  } catch (e) {
    console.error("Failed to save snapshot:", e);
    return null;
  }
}

/**
 * Write a dated history entry for trend/diff analysis. Idempotent on the
 * date key — re-analyzing the same day overwrites today's entry, which is
 * the desired behavior (latest snapshot wins).
 *
 * @param {object} entry - { savedAt, stats, agentSnapshot }
 *   agentSnapshot includes: { inProductionSids, inPipelineSids, agents: {sid: state} }
 *   where state is a small per-agent flag bag for daily-diff computation.
 */
export async function saveHistoryEntry({ savedAt, stats, agentSnapshot }) {
  const date = new Date(savedAt || Date.now()).toISOString().slice(0, 10);
  const payload = {
    savedAt: savedAt || Date.now(),
    date,
    stats: stats || null,
    agentSnapshot: agentSnapshot || null,
  };
  try {
    await tx("readwrite", store => {
      store.put(payload, `history-${date}`);
    });
    pruneHistory().catch(e => console.error("History prune failed:", e));
    return true;
  } catch (e) {
    console.error("Failed to save history entry:", e);
    return false;
  }
}

/**
 * Load all history entries newer than the retention window, sorted by date desc.
 * Returns array of { date, savedAt, stats, agentSnapshot }.
 */
export async function loadHistory() {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const store = t.objectStore(STORE);
      const req = store.openCursor();
      const out = [];
      const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      req.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (!cursor) return;
        const key = cursor.key;
        const val = cursor.value;
        if (typeof key === "string" && key.startsWith("history-") && val.savedAt >= cutoff) {
          out.push(val);
        }
        cursor.continue();
      };
      t.oncomplete = () => resolve(out.sort((a, b) => b.savedAt - a.savedAt));
      t.onerror = () => reject(t.error);
    });
  } catch (e) {
    console.error("Failed to load history:", e);
    return [];
  }
}

async function pruneHistory() {
  const db = await openDb();
  const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    const req = store.openCursor();
    req.onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (!cursor) return;
      const key = cursor.key;
      if (typeof key === "string" && key.startsWith("history-") && cursor.value.savedAt < cutoff) {
        cursor.delete();
      }
      cursor.continue();
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/**
 * Wipe all history (used by Clear Cache).
 */
export async function clearAllHistory() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    const req = store.openCursor();
    req.onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (!cursor) return;
      if (typeof cursor.key === "string" && cursor.key.startsWith("history-")) {
        cursor.delete();
      }
      cursor.continue();
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/**
 * Load the current snapshot if it exists and isn't expired.
 * Returns null if no snapshot, expired, or DB unavailable.
 */
export async function loadSnapshot() {
  try {
    const result = await tx("readonly", store => store.get(SNAPSHOT_KEY));
    if (!result) return null;
    const ageMs = Date.now() - (result.savedAt || 0);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > MAX_AGE_DAYS) {
      // Auto-prune expired snapshot
      await clearSnapshot();
      return null;
    }
    return result;
  } catch (e) {
    console.error("Failed to load snapshot:", e);
    return null;
  }
}

/**
 * Manually clear stored data.
 */
export async function clearSnapshot() {
  try {
    await tx("readwrite", store => store.delete(SNAPSHOT_KEY));
    return true;
  } catch (e) {
    console.error("Failed to clear snapshot:", e);
    return false;
  }
}

/**
 * Returns true if the snapshot is from yesterday or earlier (not today).
 * Used to show a "data is from yesterday" warning prompting a fresh upload.
 */
export function isStale(savedAt) {
  if (!savedAt) return true;
  const saved = new Date(savedAt);
  const now = new Date();
  return saved.toDateString() !== now.toDateString();
}

/**
 * Dump everything in the snapshot store — current + all history entries.
 * Used by the Export Backup feature to produce a single restorable JSON file.
 */
export async function dumpAllStorage() {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const store = t.objectStore(STORE);
      const req = store.openCursor();
      const out = { current: null, history: [] };
      req.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (!cursor) return;
        const key = cursor.key;
        if (key === SNAPSHOT_KEY) out.current = cursor.value;
        else if (typeof key === "string" && key.startsWith("history-")) out.history.push(cursor.value);
        cursor.continue();
      };
      t.oncomplete = () => {
        out.history.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        resolve(out);
      };
      t.onerror = () => reject(t.error);
    });
  } catch (e) {
    console.error("Failed to dump storage:", e);
    return { current: null, history: [] };
  }
}

/**
 * Restore a backup payload into IndexedDB. Strategy:
 *   - "merge"   (default): only adds dates not already present locally
 *   - "replace":            overwrites everything (caller must confirm with user)
 *
 * Always overwrites the "current" snapshot if the backup has one.
 *
 * Returns { restoredHistory: number, replacedCurrent: boolean, skipped: number }.
 */
export async function restoreFromBackup(payload, mode = "merge") {
  if (!payload || typeof payload !== "object") {
    return { restoredHistory: 0, replacedCurrent: false, skipped: 0 };
  }
  const history = Array.isArray(payload.history) ? payload.history : [];
  const current = payload.snapshot || null;

  let restoredHistory = 0;
  let replacedCurrent = false;
  let skipped = 0;

  if (mode === "replace") {
    // Wipe history first so old entries not in backup are removed
    await clearAllHistory();
  }

  // Read existing keys for merge-mode dedup
  const existingDates = new Set();
  if (mode === "merge") {
    const existing = await loadHistory();
    existing.forEach(e => { if (e.date) existingDates.add(e.date); });
  }

  await tx("readwrite", store => {
    if (current) {
      store.put(current, SNAPSHOT_KEY);
      replacedCurrent = true;
    }
    for (const entry of history) {
      const date = entry.date || (entry.savedAt ? new Date(entry.savedAt).toISOString().slice(0, 10) : null);
      if (!date) { skipped++; continue; }
      if (mode === "merge" && existingDates.has(date)) { skipped++; continue; }
      store.put(entry, `history-${date}`);
      restoredHistory++;
    }
  });

  return { restoredHistory, replacedCurrent, skipped };
}

export function formatLoadedTime(savedAt) {
  if (!savedAt) return "";
  const d = new Date(savedAt);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today at ${time}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ` at ${time}`;
}
