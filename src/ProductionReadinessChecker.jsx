import { useState, useMemo, useCallback, useEffect, useDeferredValue, useRef } from "react";
import { useToast } from "./components/Toast";
import { saveSnapshot, saveHistoryEntry, loadSnapshot, clearSnapshot, isStale, formatLoadedTime, loadHistory, clearAllHistory } from "./utils/storage";
import { computeDailyDiff, buildAgentDigest, DIFF_CATEGORIES } from "./utils/dailyDiff";
import { pushSnapshotToSulto, isSultoConfigured } from "./sulto";
import { readUrlState, writeUrlState } from "./utils/urlState";
import { identifyFile, validateSlot } from "./utils/schemaValidation";
import { REQUIRED_LITMOS, SHORT_LITMOS, ROSTER_COURSES, NESTING_COURSES, FL_BLUE_LEGACY, SHYFTOFF_COURSES } from "./utils/constants";
import { parseCSV } from "./parsers/parseCSV";
import { normalize, nameKey, nameParts, nameKeyVariations, candidateEmails } from "./parsers/matchNames";
import { parseCertProgress } from "./parsers/parseCertProgress";
import { dedupCipData } from "./parsers/dedupCipData";
import { resolveBgStatus } from "./parsers/resolveBgStatus";
import { buildProdCampaignMaps, isInProdForCampaign, getProdCampaigns } from "./parsers/prodCampaigns";
import { buildRemovalHistoryMap, annotateAgentRemoval } from "./parsers/parseRemovedExport";
import Badge from "./components/Badge";
import StatCard from "./components/StatCard";
import CourseDot from "./components/CourseDot";
import FileUpload from "./components/FileUpload";

// All constants, parsers, and small components have been extracted to:
//   src/utils/constants.js
//   src/parsers/parseCSV.js
//   src/parsers/matchNames.js
//   src/parsers/parseCertProgress.js
//   src/components/Badge.jsx
//   src/components/StatCard.jsx
//   src/components/CourseDot.jsx
//   src/components/FileUpload.jsx
// The pure functions are covered by tests in src/**/__tests__/.

export default function ProductionReadinessChecker() {
  const toast = useToast();
  const [litmosFiles, setLitmosFiles] = useState([]);
  const [cipFiles, setCipFiles] = useState([]);
  const [prodFiles, setProdFiles] = useState([]);
  const [navFiles, setNavFiles] = useState([]);
  const [peopleFiles, setPeopleFiles] = useState([]);
  const [removedFiles, setRemovedFiles] = useState([]);
  const [litmosData, setLitmosData] = useState(null);
  const [cipData, setCipData] = useState(null);
  const [prodData, setProdData] = useState(null);
  const [navData, setNavData] = useState(null);
  const [peopleData, setPeopleData] = useState(null);
  // Removed Reports — entirely optional. When null, all downstream flag
  // computation skips and the dashboard behaves exactly as before.
  const [removedData, setRemovedData] = useState(null);
  const [processing, setProcessing] = useState(false);
  // Hydrate filter / search / open-sections from the URL on first render so
  // shared links and reloads preserve the view. Lazy initializers run once.
  const initialUrlState = useMemo(() => readUrlState(), []);
  const [search, setSearch] = useState(initialUrlState?.search || "");
  // useDeferredValue lets the input update synchronously while the
  // expensive filter+render of 600+ agents is debounced into the
  // next paint frame. Keeps typing snappy.
  const deferredSearch = useDeferredValue(search);
  const [filter, setFilter] = useState(initialUrlState?.filter || "all");
  const [expandedRow, setExpandedRow] = useState(null);
  const [showEmail, setShowEmail] = useState(false);
  const [openSections, setOpenSections] = useState(initialUrlState?.sections || new Set(["diff", "outreach", "health", "creds"]));
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [showDetailCols, setShowDetailCols] = useState(false);
  // Persistence state
  const [savedAt, setSavedAt] = useState(null);
  const [fileMeta, setFileMeta] = useState(null); // { litmos: [{name, size}], ... }
  const [restoring, setRestoring] = useState(true);
  const [fileTypes, setFileTypes] = useState({}); // slotKey → array of detected kinds

  // Restore snapshot from IndexedDB on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await loadSnapshot();
        if (snap && !cancelled) {
          setLitmosData(snap.parsedData?.litmosData || null);
          setCipData(snap.parsedData?.cipData || null);
          setProdData(snap.parsedData?.prodData || null);
          setNavData(snap.parsedData?.navData || null);
          setPeopleData(snap.parsedData?.peopleData || null);
          setRemovedData(snap.parsedData?.removedData || null);
          setSavedAt(snap.savedAt);
          setFileMeta(snap.fileMeta || null);
          if (isStale(snap.savedAt)) {
            toast.warn(`Loaded data from ${formatLoadedTime(snap.savedAt)} — re-upload today's files for fresh insights`);
          } else {
            toast.success(`Restored cached data from ${formatLoadedTime(snap.savedAt)}`);
          }
        }
      } catch (e) {
        console.error("Snapshot restore failed:", e);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => { cancelled = true; };
    // toast is stable from context; intentionally omitting to run only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Schema-check uploaded files and surface any slot mismatches as warnings.
  // Doesn't block upload — user might have a legitimate reason to drop a file in
  // an unexpected slot. Just gives them a heads-up.
  const handleFiles = useCallback(async (slotKey, setter, files) => {
    setter(files);
    if (!files || !files.length) {
      setFileTypes(prev => { const next = {...prev}; delete next[slotKey]; return next; });
      return;
    }
    // Run schema check on each file's headers
    const checks = await Promise.all(files.map(async f => {
      try {
        const text = await f.text();
        const rows = parseCSV(text);
        if (!rows.length) return { kind: "unknown", label: "Empty file", error: null };
        const headers = Object.keys(rows[0]);
        const detected = identifyFile(headers, rows[0]);
        const error = validateSlot(slotKey, detected.kind);
        return { ...detected, error, fileName: f.name };
      } catch (e) {
        return { kind: "unknown", label: "Parse failed", error: "Couldn't read file", fileName: f.name };
      }
    }));
    const warnings = checks.filter(c => c.error).map(c => `${c.fileName}: ${c.error} (looks like ${c.label})`);
    setFileTypes(prev => ({ ...prev, [slotKey]: { checks, warnings } }));
  }, []);

  const handleClearCache = useCallback(async (clearHistoryToo = false) => {
    const msg = clearHistoryToo
      ? "Clear ALL cached data including 30-day history? This cannot be undone."
      : "Clear cached data? You'll need to re-upload your files. (History is preserved.)";
    if (!confirm(msg)) return;
    await clearSnapshot();
    if (clearHistoryToo) await clearAllHistory();
    setLitmosData(null);
    setCipData(null);
    setProdData(null);
    setNavData(null);
    setPeopleData(null);
    setRemovedData(null);
    setLitmosFiles([]);
    setCipFiles([]);
    setProdFiles([]);
    setNavFiles([]);
    setPeopleFiles([]);
    setRemovedFiles([]);
    setSavedAt(null);
    setFileMeta(null);
    setFileTypes({});
    setHistory([]);
    toast.info(clearHistoryToo ? "Cleared cache and history" : "Cleared cache");
  }, [toast]);

  // Load history for trend insights. We only need the dates + agent digests.
  const [history, setHistory] = useState([]);
  useEffect(() => {
    loadHistory().then(setHistory).catch(() => setHistory([]));
  }, [savedAt]); // refresh when a new snapshot is saved

  // Compute the rich daily diff (newly credentialed, completed Litmos, status
  // moves, new/resolved issues, etc.). Pure function lives in utils/dailyDiff
  // and is unit-tested. Returns null when fewer than 2 days of history exist.
  const dailyDiff = useMemo(() => {
    if (history.length < 2) return null;
    const [today, prev] = history; // sorted desc by savedAt
    return computeDailyDiff(today, prev);
  }, [history]);

  // Sync URL whenever filter / search / openSections change so the address bar
  // is always shareable. replaceState avoids polluting the back button.
  useEffect(() => {
    writeUrlState({ filter, search, sections: openSections });
  }, [filter, search, openSections]);

  // Track which Daily Diff category cards have their agent list expanded.
  const [openDiffCats, setOpenDiffCats] = useState(new Set());
  const toggleDiffCat = (key) => setOpenDiffCats(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const toggleSection = (key) => setOpenSections(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const handleCopyAgent = (a, idx, e) => {
    e.stopPropagation();
    const text = `${a.name}${a.sid ? " — " + a.sid : ""}`;
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
    toast.success(`Copied: ${a.name}`);
  };

  const readFiles = async (files) => {
    const all = [];
    for (const f of files) {
      const text = await f.text();
      all.push(...parseCSV(text));
    }
    return all;
  };

  const handleProcess = useCallback(async () => {
    setProcessing(true);
    try {
      const [litRows, cipRows, prodRows, navRows, pplRows, rmvRows] = await Promise.all([
        litmosFiles.length ? readFiles(litmosFiles) : Promise.resolve([]),
        cipFiles.length ? readFiles(cipFiles) : Promise.resolve([]),
        prodFiles.length ? readFiles(prodFiles) : Promise.resolve([]),
        navFiles.length ? readFiles(navFiles) : Promise.resolve([]),
        peopleFiles.length ? readFiles(peopleFiles) : Promise.resolve([]),
        removedFiles.length ? readFiles(removedFiles) : Promise.resolve([]),
      ]);
      setLitmosData(litRows);
      setCipData(cipRows);
      setProdData(prodRows);
      setNavData(navRows);
      setPeopleData(pplRows);
      // Only set removedData if the user uploaded files. null = feature off.
      setRemovedData(removedFiles.length ? rmvRows : null);

      // Persist to IndexedDB so the data survives page refreshes.
      // The dated history entry (with the rich agent digest) is written by a
      // separate effect below — once `results` has computed all the per-agent
      // flags. This avoids duplicating that computation here.
      const meta = {
        litmos: litmosFiles.map(f => ({ name: f.name, size: f.size })),
        cip: cipFiles.map(f => ({ name: f.name, size: f.size })),
        prod: prodFiles.map(f => ({ name: f.name, size: f.size })),
        nav: navFiles.map(f => ({ name: f.name, size: f.size })),
        people: peopleFiles.map(f => ({ name: f.name, size: f.size })),
        removed: removedFiles.map(f => ({ name: f.name, size: f.size })),
      };
      const savedNow = await saveSnapshot({
        parsedData: {
          litmosData: litRows,
          cipData: cipRows,
          prodData: prodRows,
          navData: navRows,
          peopleData: pplRows,
          removedData: removedFiles.length ? rmvRows : null,
        },
        fileMeta: meta,
      });
      setSavedAt(savedNow || Date.now());
      setFileMeta(meta);
      const totalRows = litRows.length + cipRows.length + prodRows.length + navRows.length + pplRows.length + rmvRows.length;
      toast.success(`Analyzed ${totalRows.toLocaleString()} rows · saved to cache`);
      // Trigger the Sulto push on the NEXT render, after the results /
      // prodAgents useMemos have recomputed against the new raw data.
      // No-op if env vars aren't configured.
      setPendingSultoPush(true);
    } catch (e) {
      console.error("handleProcess failed:", e);
      toast.error(`Analysis failed: ${e.message}`);
    }
    setProcessing(false);
  }, [litmosFiles, cipFiles, prodFiles, navFiles, peopleFiles, removedFiles, toast]);

  // Removal history lookup. Built once per uploaded Removed Reports file and
  // reused by both pipeline and production agent annotations. Null when no
  // removed file is uploaded — every downstream branch checks for null.
  const removalMap = useMemo(() => {
    if (!removedData || !removedData.length) return null;
    return buildRemovalHistoryMap(removedData);
  }, [removedData]);

  const results = useMemo(() => {
    if (!litmosData || !cipData) return null;

    // Build campaign-aware production lookup (campaign-specific exclusion).
    // Logic lives in parsers/prodCampaigns.js (covered by unit tests).
    const prodMaps = buildProdCampaignMaps(prodData);

    // People Report: who has a Litmos account (= has credentials)
    // Track name → usernames so we can detect collisions (multiple people with same name)
    const litmosPeopleEmails = new Set();
    const litmosPeopleNames = new Set();
    const litmosNameToUsernames = new Map(); // nameKey → [usernames, ...] for collision detection
    // Account creation dates by name-key — used for the rehire stale-account
    // signal. People Report's "People.Created Date" is the only place this
    // info is available (Litmos Course Data doesn't include it).
    const litmosAccountCreatedByKey = new Map();
    (peopleData || []).forEach(r => {
      const email = (r["People.Username"] || "").toLowerCase().trim();
      if (email) litmosPeopleEmails.add(email);
      const first = r["People.First Name"] || "";
      const last = r["People.Last Name"] || "";
      const createdDate = (r["People.Created Date"] || "").trim();
      if (first || last) {
        // Register both the raw name key AND all variations
        // (handles "Candace Monger I" where middle initial is stored in last name field)
        const fullName = `${first} ${last}`.trim();
        const variations = nameKeyVariations(fullName);
        variations.forEach(k => {
          litmosPeopleNames.add(k);
          if (!litmosNameToUsernames.has(k)) litmosNameToUsernames.set(k, []);
          if (createdDate && !litmosAccountCreatedByKey.has(k)) {
            litmosAccountCreatedByKey.set(k, createdDate);
          }
          if (email && !litmosNameToUsernames.get(k).includes(email)) {
            litmosNameToUsernames.get(k).push(email);
          }
        });
      }
    });
    const hasPeopleReport = litmosPeopleEmails.size > 0;

    // Course Data: per-course completion for the 14 required Litmos courses
    const litmosMap = {};
    const litmosEmailMap = {};
    litmosData.forEach(r => {
      const first = r["People.First Name"] || "";
      const last = r["People.Last Name"] || "";
      const email = (r["People.Email"] || "").toLowerCase().trim();
      const key = nameKey(first, last);
      if (!litmosMap[key]) litmosMap[key] = { email: r["People.Email"] || "", courses: {} };
      const course = r["Course.Title"] || "";
      litmosMap[key].courses[course] = {
        pct: parseInt(r["Course User Results.Percentage"]) || 0,
        completed: (r["Course User Results.Completed"] || "").toUpperCase() === "YES",
        date: r["Course User Results.Date Completed"] || "",
      };
      if (email && !litmosEmailMap[email]) litmosEmailMap[email] = litmosMap[key];
    });

    // Nav Meeting attendance — only cares about WHO ATTENDED.
    // Supports both the ShyftNav export (with "Did the Agent Attend?" column)
    // and legacy Nav CSVs (Name/Email columns, all listed = attended).
    const navKeys = new Set();
    (navData || []).forEach(r => {
      // Attendance filter: if the file has the attendance column, only count "Yes" rows.
      // Legacy CSVs without this column preserve old behavior (any listed = attended).
      const attendField = r["Did the Agent Attend?"] || r["Attended"] || r["attended"] || "";
      if (attendField !== "") {
        const attendYes = attendField.trim().toLowerCase();
        if (attendYes !== "yes" && attendYes !== "y" && attendYes !== "true") return;
      }

      // Determine full name — prefer explicit Full Name, fall back to First+Last combo,
      // then legacy single-field variants.
      let name = r["Full Name"] || r["full_name"] || r["Name"] || r["name"] || r["Agent Name"] || r["agent_name"] || "";
      if (!name) {
        const first = (r["Agent First Name"] || r["First Name"] || r["first_name"] || "").trim();
        const last = (r["Agent Last Name"] || r["Last Name"] || r["last_name"] || "").trim();
        if (first || last) name = `${first} ${last}`.trim();
      }

      if (name) {
        // Register all name variations (handles multi-part names + middle initials)
        nameKeyVariations(name).forEach(k => navKeys.add(k));
      }

      // Email fallback (legacy Nav CSVs only — new ShyftNav export has no email column)
      const email = r["Email"] || r["email"] || r["NB Email"] || "";
      if (email) navKeys.add(email.toLowerCase().trim());
    });

    // Helper to find Litmos data for a given name
    function findLitmos(name) {
      const { first, last } = nameParts(name);
      const key = nameKey(first, last);
      let ldata = litmosMap[key] || null;
      if (!ldata && first.includes(".")) {
        ldata = litmosMap[nameKey(first.split(".").pop(), last)] || null;
      }
      const parts = name.split(/\s+/).filter(Boolean);
      if (!ldata && parts.length > 2) {
        ldata = litmosMap[nameKey(parts.slice(0, -1).join(""), last)] || null;
        if (!ldata) ldata = litmosMap[nameKey(first, parts.slice(1).join(""))] || null;
      }
      if (!ldata) {
        for (const email of candidateEmails(name)) {
          if (litmosEmailMap[email]) { ldata = litmosEmailMap[email]; break; }
        }
      }
      return ldata;
    }

    // Deduplicate agents by ShyftOff ID when multiple files are uploaded.
    // Merge strategy lives in parsers/dedupCipData.js (covered by unit tests).
    const dedupedCip = dedupCipData(cipData);

    const agents = [];
    dedupedCip.forEach(row => {
      const name = (row.agent_nm || row.agent_name || "").trim();
      const sid = (row.shyftoff_id || "").trim();
      const status = (row.status || "").trim();
      const { first, last } = nameParts(name);
      const key = nameKey(first, last);
      const parts = name.split(/\s+/).filter(Boolean);

      // Campaign-aware production exclusion: only skip if the agent is in production
      // FOR THIS ROW'S SPECIFIC CAMPAIGN. An agent can be in prod for Bilingual but
      // still active in the pipeline for ENG (and vice versa).
      const rowCampaign = (row.campaign_nm || "").trim();
      const prodCampaignsForAgent = getProdCampaigns(prodMaps, sid, key);
      if (rowCampaign && isInProdForCampaign(prodMaps, sid, key, rowCampaign)) return;
      // If no campaign info on this row, fall back to old behavior: exclude if in ANY prod
      if (!rowCampaign && prodCampaignsForAgent.length > 0) return;

      const ldata = findLitmos(name);

      const litmosDone = REQUIRED_LITMOS.map(c => ({
        name: c,
        completed: ldata?.courses[c]?.completed || false,
        pct: ldata?.courses[c]?.pct || 0,
        date: ldata?.courses[c]?.date || "",
      }));
      const litmosCount = litmosDone.filter(c => c.completed).length;

      const cert = parseCertProgress(row.certification_progress || "");
      const shyftoffPct = cert.pct;
      const shyftoffComplete = shyftoffPct === 100;
      const courseMap = cert.courseMap || {};

      // Per-course completion status
      const nbCertDone = (courseMap[ROSTER_COURSES[0]] || 0) >= 100;
      const flBlueDone = (courseMap[FL_BLUE_LEGACY] || 0) >= 100;
      // Phase 1 (Roster) only requires NB Certification for credential eligibility.
      // FL Blue was folded into Pre-Production and is no longer a separate Phase 1 requirement.
      const rosterCoursesDone = nbCertDone;
      const preProdDone = (courseMap[NESTING_COURSES[0]] || 0) >= 100;
      const navCourseDone = (courseMap[NESTING_COURSES[1]] || 0) >= 100;
      const nestingCoursesDone = preProdDone && navCourseDone;

      // Nav attendance — check all name variations (handles middle initials, multi-part names)
      const navAttended = nameKeyVariations(name).some(k => navKeys.has(k))
        || (ldata?.email && navKeys.has(ldata.email.toLowerCase()));

      // New fields for anomaly detection
      const hasCcaas = !!(row.ccaas_id || "").trim();
      // Check if agent has a Litmos account (= has credentials)
      // Use People Report if available (definitive), otherwise fall back to Course Data presence
      let inLitmos;
      let hasNameCollision = false;
      let collidingUsernames = [];
      if (hasPeopleReport) {
        const candidateEm = candidateEmails(name);
        const emailMatch = candidateEm.some(e => litmosPeopleEmails.has(e));
        // Try all name variations (handles middle initials in any position)
        const pipelineNameKeys = nameKeyVariations(name);
        // Gather all usernames associated with any matching variation
        const allMatchedUsernames = [];
        let maxCollisionCount = 0;
        pipelineNameKeys.forEach(k => {
          const users = litmosNameToUsernames.get(k) || [];
          users.forEach(u => { if (!allMatchedUsernames.includes(u)) allMatchedUsernames.push(u); });
          if (users.length > maxCollisionCount) maxCollisionCount = users.length;
        });
        hasNameCollision = maxCollisionCount > 1;
        if (hasNameCollision) {
          collidingUsernames = allMatchedUsernames;
          // Cannot reliably auto-match when multiple Litmos accounts share the name.
          // candidateEmails generates the base pattern "first.last@domain" which
          // always matches the FIRST colliding account — a false positive.
          // Conservative default: mark as NOT in Litmos, require manual verification.
          inLitmos = false;
        } else {
          // Unique name (0 or 1 Litmos match) — check all name variations
          inLitmos = pipelineNameKeys.some(k => litmosPeopleNames.has(k)) || emailMatch;
        }
      } else {
        inLitmos = ldata !== null;
      }
      // BG status resolution (cross-source mismatch detection lives in resolveBgStatus).
      const bg = resolveBgStatus(row);
      const { bgStatus, bgCleared, cipBgProcess, cipBgReport, isBgMismatch, hasAccountIssue } = bg;
      const createdAt = row.created_at ? new Date(row.created_at) : null;
      const lastChanged = row.last_changed || row.status_updated_at || "";
      const changedAt = lastChanged ? new Date(lastChanged) : null;
      const statusLower = status.toLowerCase();
      // "Roster - Phase 2 Training" is functionally the same stage as
      // "Nesting - First Call" — agents have already moved into the nesting
      // phase even though their CIP status still has "Roster" in the name.
      // Treat it as Nesting for all downstream flag logic, NOT as Roster, so
      // these agents are correctly excluded from bump/rehire detection.
      const isPhase2Training = statusLower.includes("phase 2 training");
      const isNesting = statusLower.includes("nesting") || isPhase2Training;
      const isRoster = statusLower.includes("roster") && !isPhase2Training;
      const isCredentialsRequested = statusLower.includes("credentials requested");
      const shyftoffStaleLevel = (row.stale_level || "").trim();

      // Days since status last changed
      const now = new Date();
      const daysSinceChange = changedAt ? Math.floor((now - changedAt) / 86400000) : null;
      const daysSinceCreated = createdAt ? Math.floor((now - createdAt) / 86400000) : null;

      // Anomaly flags
      // Ghost = in Nesting but confirmed not in Litmos.
      // Excludes name collisions — when we can't confidently determine Litmos status,
      // don't flag as ghost (we might be wrong about them lacking credentials).
      const isGhost = isNesting && !inLitmos && !hasNameCollision;
      // Missing CCAAS = needs ccaas_id assigned before moving to production
      const missingCcaas = !hasCcaas;

      // Credential pipeline flags (cross-referencing status + actual data)
      // Ready for credentials = courses done + BG cleared + CONFIRMED not in Litmos.
      // Excludes name collisions — we can't claim they need credentials if we can't
      // confidently say they lack them.
      const isWaitingForCreds = !inLitmos && !hasNameCollision && bgCleared && rosterCoursesDone;
      // Creds requested but courses not done = system advanced them prematurely
      const isCredsRequestedNoCourses = isCredentialsRequested && !rosterCoursesDone && !inLitmos && !hasNameCollision;
      // Creds requested, courses done, BG cleared, but already in Litmos = already credentialed
      const isAlreadyCredentialed = isCredentialsRequested && inLitmos;
      // Outreach target: completed all ShyftOff courses but didn't attend the live Nav Meeting.
      // Reach out to encourage attendance — the only thing blocking their readiness.
      const needsNavOutreach = shyftoffComplete && (navData && navData.length > 0) && !navAttended;
      // === Rehire detection (terminated Litmos credentials) ===
      // Some Roster + Litmos agents have OLD locked accounts and shouldn't be
      // bumped — they need fresh credentials. Two BEHAVIORAL signals identify
      // them (matching the user's stated heuristic of old completions/dormant
      // accounts):
      //   • Behavioral: had Litmos completions but most recent is >60 days old
      //   • Stale acct: 0 completions but Litmos account is >90 days old
      // The removed-export shows up as supporting context but does NOT trigger
      // alone (would mis-flag legitimately re-onboarded agents).
      // Logic mirrors src/parsers/computeAgentFlags.js (covered by 11 tests).
      const completionDates = litmosDone
        .filter(c => c.completed && c.date)
        .map(c => Date.parse(c.date))
        .filter(Number.isFinite);
      const lastLitmosCompletionMs = completionDates.length ? Math.max(...completionDates) : null;
      const daysSinceLastLitmosCompletion = lastLitmosCompletionMs !== null
        ? Math.floor((Date.now() - lastLitmosCompletionMs) / 86400000)
        : null;
      const litmosAccountCreatedDate = (() => {
        for (const k of nameKeyVariations(name)) {
          if (litmosAccountCreatedByKey.has(k)) return litmosAccountCreatedByKey.get(k);
        }
        return null;
      })();
      const litmosAccountAgeDays = litmosAccountCreatedDate
        ? Math.floor((Date.now() - Date.parse(litmosAccountCreatedDate)) / 86400000)
        : null;
      const removalAnnotationLocal = removalMap ? annotateAgentRemoval(removalMap, sid) : null;
      const isRehireFromRemovedList = !!(removalAnnotationLocal && removalAnnotationLocal.wasRemoved);
      const isRehireBehavioral = inLitmos && litmosCount > 0
        && daysSinceLastLitmosCompletion !== null && daysSinceLastLitmosCompletion > 60;
      const isRehireStaleAccount = inLitmos && litmosCount === 0
        && litmosAccountAgeDays !== null && litmosAccountAgeDays > 90;
      const isLikelyRehire = isRehireBehavioral || isRehireStaleAccount;
      const rehireSignals = [];
      if (isRehireBehavioral) {
        rehireSignals.push(`Last Litmos completion ${daysSinceLastLitmosCompletion}d ago — old training session`);
      }
      if (isRehireStaleAccount) {
        rehireSignals.push(`Litmos account ${litmosAccountAgeDays}d old with 0 completions — dormant account`);
      }
      if (isLikelyRehire && isRehireFromRemovedList) {
        rehireSignals.push(`Confirmed prior removal: ${removalAnnotationLocal.lastRemovalReason} (${removalAnnotationLocal.lastRemovalDaysAgo}d ago)`);
      }

      // Action target: agent is in any Roster status but ALREADY has Litmos credentials.
      // They need to be manually bumped to "Nesting - First Call" so they can access the
      // pre-production course (which is only visible in Nesting).
      // EXCLUDES likely rehires — those need fresh credentials, not a bump.
      const needsNestingBump = isRoster && inLitmos && !hasNameCollision && !isLikelyRehire;
      // New flag: rehire-with-terminated-creds in Roster status. They need fresh
      // credentials issued before they can advance.
      const needsNewCredentials = isRoster && inLitmos && !hasNameCollision && isLikelyRehire;

      const isStaleWaiter = isWaitingForCreds && daysSinceChange !== null && daysSinceChange >= 21;
      // Split stale into: in credentials queue vs truly stale (only agents with cleared BG)
      const isStaleInQueue = isStaleWaiter && isCredentialsRequested;
      const isTrulyStale = isStaleWaiter && !isCredentialsRequested;
      // hasAccountIssue and isBgMismatch already computed by resolveBgStatus above

      const allLitmos = litmosCount === 14;
      const navMet = navAttended || !(navData && navData.length > 0);
      const readyStatus = allLitmos && shyftoffComplete && navMet ? "ready"
        : (litmosCount > 0 || (shyftoffPct !== null && shyftoffPct > 0)) ? "partial" : "missing";

      // Determine credential eligibility reason
      // Key trigger: NB Certification Course done + BG cleared = credentials eligible.
      // (FL Blue was folded into Pre-Production and is no longer a Phase 1 requirement.)
      let credentialNote = "";
      if (inLitmos) credentialNote = "Has credentials";
      else if (isBgMismatch) credentialNote = "BG mismatch — Roster says cleared but CIP shows in progress";
      else if (rosterCoursesDone && bgCleared) credentialNote = "Should be on next credentials batch";
      else if (rosterCoursesDone && !bgCleared) credentialNote = "NB Certification done — waiting on BG check";
      else if (!rosterCoursesDone && bgCleared) credentialNote = "BG cleared — NB Certification in progress";
      else credentialNote = "NB Certification in progress";

      // Removal annotation — null when no Removed Reports file uploaded
      // (or this SID has no removal history). Spreads zero new fields when
      // null, preserving backward-compatible agent shape.
      const removal = removalMap ? annotateAgentRemoval(removalMap, sid) : null;

      agents.push({
        name, sid, status, key,
        nbEmail: ldata?.email || "",
        litmosCount, litmosDone, litmosTotal: 14,
        shyftoffPct, shyftoffComplete, courseMap, certMap: cert.map,
        nbCertDone, flBlueDone, rosterCoursesDone,
        preProdDone, navCourseDone, nestingCoursesDone,
        navAttended, navAvailable: navData && navData.length > 0,
        readyStatus, allLitmos,
        inLitmos, hasCcaas, missingCcaas, bgStatus, bgCleared,
        hasNameCollision, collidingUsernames,
        rowCampaign, prodCampaigns: prodCampaignsForAgent,
        daysSinceChange, daysSinceCreated,
        createdAtRaw: row.created_at || "",
        lastChangedRaw: lastChanged,
        isNesting, isRoster, isPhase2Training, isCredentialsRequested, shyftoffStaleLevel,
        cipBgProcess, cipBgReport, isBgMismatch,
        isGhost, isWaitingForCreds, isCredsRequestedNoCourses, isAlreadyCredentialed,
        needsNavOutreach, needsNestingBump, needsNewCredentials,
        isStaleWaiter, isStaleInQueue, isTrulyStale, hasAccountIssue,
        credentialNote,
        // Rehire diagnostic — populated whether or not signals fired so the
        // side panel can show "no rehire signals detected" for legit bumps.
        isLikelyRehire, isRehireFromRemovedList, isRehireBehavioral, isRehireStaleAccount,
        rehireSignals,
        daysSinceLastLitmosCompletion, litmosAccountAgeDays, litmosAccountCreatedDate,
        ...(removal || {}),
      });
    });

    return agents;
  }, [litmosData, cipData, prodData, navData, peopleData, removalMap]);

  // Process production agents for FL Blue tracking
  // Production data can come in two formats:
  // 1. production_agents CSV: aggregate cert % (integer), no per-course data
  // 2. production-export CSV: JSON cert_progress with per-course data (same as CIP)
  // Dedup by SID, prefer JSON format for FL Blue accuracy
  const prodAgents = useMemo(() => {
    if (!prodData || !prodData.length) return [];
    const seen = new Map();
    prodData.forEach(r => {
      const name = (r.full_name || r.agent_nm || r.agent_name || "").trim();
      const sid = (r.so_agent_id || r.shyftoff_id || "").trim();
      if (!sid) return;
      const certRaw = (r.certification_progress || "").trim();
      const isJson = certRaw.startsWith("[");
      if (seen.has(sid)) {
        const existing = seen.get(sid);
        // Prefer JSON cert data over integer
        if (isJson && !existing._isJson) {
          existing.certification_progress = certRaw;
          existing._isJson = true;
        }
        return;
      }
      seen.set(sid, { ...r, _isJson: isJson });
    });

    return [...seen.values()].map(r => {
      const name = (r.full_name || r.agent_nm || r.agent_name || "").trim();
      const sid = (r.so_agent_id || r.shyftoff_id || "").trim();
      const certRaw = (r.certification_progress || "").trim();

      // Try JSON per-course data first (production-export format)
      let flBlueDone = null; // null = no data, true/false = known
      let flBluePct = null;
      if (certRaw.startsWith("[")) {
        try {
          const arr = JSON.parse(certRaw.replace(/""/g, '"'));
          for (const item of arr) {
            if ((item.course_code || "").toLowerCase().includes("flblue")) {
              const prog = parseFloat(item.progress) || 0;
              flBluePct = Math.round(prog * 100);
              flBlueDone = prog >= 1.0;
              break;
            }
          }
        } catch {}
      }

      // Fall back to aggregate integer
      const certPct = certRaw.match(/^\d+$/) ? parseInt(certRaw) : null;

      // Campaigns this agent is in production for
      const campaignList = (r.productive_campaigns_list || r.active_campaigns_list || "").trim();
      const singleCampaign = (r.campaign_nm || "").trim();
      const campaigns = singleCampaign
        ? [singleCampaign]
        : campaignList.split(/[;,]/).map(c => c.trim()).filter(Boolean);

      // Removal annotation + the "removed today AND in prod today" anomaly
      // flag — surfaces records where the source system has the same agent
      // marked as removed and active simultaneously (3 cases observed at the
      // time this was added). These are typically data-correction candidates
      // the ops team should investigate.
      const removal = removalMap ? annotateAgentRemoval(removalMap, sid) : null;
      const removedTodayInProd = !!(removalMap && removalMap.removedTodaySids?.has(sid));

      return {
        name, sid, isProd: true,
        certPct: certPct !== null ? certPct : (flBlueDone !== null ? null : null),
        flBlueDone, // true/false from per-course, or null if no data
        flBluePct,
        hasFlBlueData: flBlueDone !== null,
        allCoursesDone: certPct === 100,
        status: r.agent_campaign_status || r.status || "Production",
        bgStatus: (r.background_check_status || "").trim().toLowerCase(),
        prodCampaigns: campaigns,
        ...(removal || {}),
        removedTodayInProd,
      };
    });
  }, [prodData, removalMap]);

  const prodStats = useMemo(() => {
    if (!prodAgents.length) return null;
    const withData = prodAgents.filter(a => a.hasFlBlueData);
    const noData = prodAgents.filter(a => !a.hasFlBlueData);
    return {
      total: prodAgents.length,
      hasFlBlueData: withData.length > 0,
      flBlueDone: withData.filter(a => a.flBlueDone).length,
      flBlueNotDone: withData.filter(a => !a.flBlueDone).length,
      noData: noData.length,
    };
  }, [prodAgents]);

  // Write the rich dated history entry once results have been computed.
  // Guarded by a ref so we don't re-write when unrelated state changes.
  // Triggers exactly once per Analyze cycle (savedAt changes on each run).
  const lastHistoryWriteRef = useRef(null);
  useEffect(() => {
    if (!results || !savedAt) return;
    if (lastHistoryWriteRef.current === savedAt) return;
    lastHistoryWriteRef.current = savedAt;
    const agentSnapshot = buildAgentDigest(results, prodAgents);
    saveHistoryEntry({
      savedAt,
      agentSnapshot,
      stats: {
        pipelineTotal: results.length,
        productionTotal: prodAgents.length,
      },
    })
      .then(() => loadHistory())
      .then(setHistory)
      .catch(e => console.error("History write failed:", e));
  }, [results, prodAgents, savedAt]);

  // Fire-and-forget push to the Sulto receiver after a fresh Analyze.
  // Driven by an explicit pendingSultoPush state — set by handleProcess only
  // after a successful run, NOT by the IndexedDB snapshot restore effect.
  // This ensures a page refresh doesn't re-push the same snapshot.
  const [pendingSultoPush, setPendingSultoPush] = useState(false);
  useEffect(() => {
    if (!pendingSultoPush || !results) return;
    setPendingSultoPush(false);
    pushSnapshotToSulto(results, prodAgents).then(status => {
      if (status === "ok") toast.success("Snapshot pushed to Sulto");
      else if (status === "error") toast.warn("Sulto push failed — see console");
      // status === "no-config" is silent (local dev / preview without env vars)
    });
    // toast is stable from context; intentionally omitted to keep deps tight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSultoPush, results, prodAgents]);

  const filtered = useMemo(() => {
    if (!results) return [];
    // Production filters return prod agents instead of pipeline agents
    const prodFilters = ["production", "prod_flblue_incomplete"];
    if (prodFilters.includes(filter)) {
      let out = prodAgents;
      if (filter === "prod_flblue_incomplete") out = out.filter(a => a.hasFlBlueData ? !a.flBlueDone : !a.allCoursesDone);
      if (deferredSearch) {
        const s = deferredSearch.toLowerCase();
        out = out.filter(a => a.name.toLowerCase().includes(s) || a.sid.toLowerCase().includes(s));
      }
      return out;
    }
    let out = results;
    if (filter === "ready") out = out.filter(a => a.readyStatus === "ready");
    if (filter === "partial") out = out.filter(a => a.readyStatus === "partial");
    if (filter === "missing") out = out.filter(a => a.readyStatus === "missing");
    if (filter === "litmos_done") out = out.filter(a => a.allLitmos);
    if (filter === "shyftoff_done") out = out.filter(a => a.shyftoffComplete);
    if (filter === "ghosts") out = out.filter(a => a.isGhost);
    if (filter === "waiting_creds") out = out.filter(a => a.isWaitingForCreds);
    if (filter === "creds_no_courses") out = out.filter(a => a.isCredsRequestedNoCourses);
    if (filter === "stale") out = out.filter(a => a.isStaleWaiter);
    if (filter === "stale_queue") out = out.filter(a => a.isStaleInQueue);
    if (filter === "stale_true") out = out.filter(a => a.isTrulyStale);
    if (filter === "stale_bg") out = out.filter(a => a.isBgMismatch);
    if (filter === "account_issues") out = out.filter(a => a.hasAccountIssue);
    if (filter === "name_collision") out = out.filter(a => a.hasNameCollision);
    if (filter === "needs_nav") out = out.filter(a => a.needsNavOutreach);
    if (filter === "needs_bump") out = out.filter(a => a.needsNestingBump);
    if (filter === "needs_new_creds") out = out.filter(a => a.needsNewCredentials);
    if (filter === "campaign_eng") out = out.filter(a => a.rowCampaign && !/bilingual/i.test(a.rowCampaign) && /nations/i.test(a.rowCampaign));
    if (filter === "campaign_bi") out = out.filter(a => a.rowCampaign && /bilingual/i.test(a.rowCampaign));
    if (filter === "campaign_both") out = out.filter(a => a.rowCampaign && /nations/i.test(a.rowCampaign) && a.prodCampaigns && a.prodCampaigns.length > 0);
    if (filter === "returning") out = out.filter(a => a.wasRemoved);
    if (filter === "returning_prod") out = out.filter(a => a.wasRemoved && a.previouslyInProd);
    if (filter === "returning_repeat") out = out.filter(a => a.wasRemoved && a.removalCount > 1);
    if (deferredSearch) {
      const s = deferredSearch.toLowerCase();
      out = out.filter(a => a.name.toLowerCase().includes(s) || a.sid.toLowerCase().includes(s) || (a.nbEmail || "").toLowerCase().includes(s));
    }
    return out;
  }, [results, prodAgents, filter, deferredSearch]);

  const stats = useMemo(() => {
    if (!results) return null;
    return {
      total: results.length,
      ready: results.filter(a => a.readyStatus === "ready").length,
      readyEng: results.filter(a => a.readyStatus === "ready" && a.rowCampaign && !/bilingual/i.test(a.rowCampaign) && /nations/i.test(a.rowCampaign)).length,
      readyBi: results.filter(a => a.readyStatus === "ready" && a.rowCampaign && /bilingual/i.test(a.rowCampaign)).length,
      litmosDone: results.filter(a => a.allLitmos).length,
      shyftoffDone: results.filter(a => a.shyftoffComplete).length,
      navAttended: results.filter(a => a.navAttended).length,
      navAvailable: results.length > 0 && results[0].navAvailable,
      ghosts: results.filter(a => a.isGhost).length,
      waitingForCreds: results.filter(a => a.isWaitingForCreds).length,
      credsRequestedNoCourses: results.filter(a => a.isCredsRequestedNoCourses).length,
      alreadyCredentialed: results.filter(a => a.isAlreadyCredentialed).length,
      credsRequestedTotal: results.filter(a => a.isCredentialsRequested).length,
      staleWaiters: results.filter(a => a.isStaleWaiter).length,
      staleInQueue: results.filter(a => a.isStaleInQueue).length,
      trulyStale: results.filter(a => a.isTrulyStale).length,
      staleBgMismatch: results.filter(a => a.isBgMismatch).length,
      accountIssues: results.filter(a => a.hasAccountIssue).length,
      nameCollisions: results.filter(a => a.hasNameCollision).length,
      needsNavOutreach: results.filter(a => a.needsNavOutreach).length,
      needsNestingBump: results.filter(a => a.needsNestingBump).length,
      needsNewCredentials: results.filter(a => a.needsNewCredentials).length,
      flBlueDone: results.filter(a => a.flBlueDone).length,
      flBlueIncomplete: results.filter(a => !a.flBlueDone).length,
      engPipeline: results.filter(a => a.rowCampaign && !/bilingual/i.test(a.rowCampaign) && /nations/i.test(a.rowCampaign)).length,
      biPipeline: results.filter(a => a.rowCampaign && /bilingual/i.test(a.rowCampaign)).length,
      crossoverEngReady: results.filter(a => a.rowCampaign && !/bilingual/i.test(a.rowCampaign) && /nations/i.test(a.rowCampaign) && a.readyStatus === "ready" && a.prodCampaigns && a.prodCampaigns.some(c => /bilingual/i.test(c))).length,
      crossoverBiReady: results.filter(a => a.rowCampaign && /bilingual/i.test(a.rowCampaign) && a.readyStatus === "ready" && a.prodCampaigns && a.prodCampaigns.some(c => !/bilingual/i.test(c) && /nations/i.test(c))).length,
      // Returning-agent counts (only meaningful when removed file is uploaded — otherwise all 0)
      returning: results.filter(a => a.wasRemoved).length,
      returningPreviouslyInProd: results.filter(a => a.wasRemoved && a.previouslyInProd).length,
      returningMultipleTimes: results.filter(a => a.wasRemoved && a.removalCount > 1).length,
    };
  }, [results]);

  const downloadCsv = (headers, rows, filename) => {
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  };

  const handleExport = () => {
    if (!filtered.length) return;
    const headers = ["Agent Name","ShyftOff ID","Campaign","Already In Prod For","CIP Status","NB Email","Litmos (done/14)","ShyftOff Cert %","Nav Meeting","Readiness","In Litmos (Has Creds)","CCAAS ID","BG Check","Days Since Change","Flags"];
    const rows = filtered.map(a => {
      const flags = [];
      if (a.isGhost) flags.push("GHOST");
      if (a.isWaitingForCreds) flags.push("WAITING_CREDS");
      if (a.isStaleWaiter) flags.push("STALE");
      if (a.hasAccountIssue) flags.push("BG_ISSUE");
      if (a.isBgMismatch) flags.push("BG_MISMATCH");
      return [
        a.name, a.sid,
        a.rowCampaign || (a.isProd && a.prodCampaigns ? a.prodCampaigns.join("; ") : ""),
        a.prodCampaigns ? a.prodCampaigns.join("; ") : "",
        a.status, a.nbEmail || "",
        a.isProd ? "N/A" : `${a.litmosCount}/14`,
        a.isProd ? (a.certPct !== null ? `${a.certPct}%` : "N/A") : (a.shyftoffPct !== null ? `${a.shyftoffPct}%` : "N/A"),
        a.navAvailable ? (a.navAttended ? "YES" : "NO") : "N/A",
        a.isProd ? "PRODUCTION" : a.readyStatus.toUpperCase(),
        a.inLitmos ? "YES" : "NO",
        a.hasCcaas ? "YES" : "NO",
        a.bgStatus || "unknown",
        a.daysSinceChange !== null ? `${a.daysSinceChange}` : "N/A",
        flags.join("; ") || "",
      ];
    });
    downloadCsv(headers, rows, "production_readiness_report.csv");
    toast.success(`Exported ${rows.length.toLocaleString()} agents to CSV`);
  };

  const handleExportIssues = () => {
    if (!results) return;
    const issueAgents = results.filter(a => a.isBgMismatch || a.hasAccountIssue || a.isGhost || a.isTrulyStale || a.isStaleInQueue || a.hasNameCollision || a.needsNestingBump || a.needsNewCredentials);
    if (!issueAgents.length) return;
    const today = new Date().toISOString().split("T")[0];
    const headers = [
      "Issue Type","Agent Name","ShyftOff ID","CIP Status",
      "Roster BG Status","CIP BG Process","CIP BG Report",
      "Has Credentials (Litmos)","Cert Progress %",
      "NB Cert Done","FL Blue Done","Days in Status","Action Needed"
    ];
    // Emit one row per issue per agent — an agent with multiple issues
    // (e.g. BG Mismatch AND Needs Nesting Bump) appears in each category.
    // Filter by "Issue Type" in Excel to get each group cleanly.
    const rows = [];
    const baseFields = (a) => [
      a.name, a.sid, a.status,
      a.bgStatus || "N/A", a.cipBgProcess || "N/A", a.cipBgReport || "N/A",
      a.inLitmos ? "YES" : "NO",
      a.shyftoffPct !== null ? a.shyftoffPct : "N/A",
      a.nbCertDone ? "YES" : "NO", a.flBlueDone ? "YES" : "NO",
      a.daysSinceChange !== null ? a.daysSinceChange : "N/A",
    ];
    issueAgents.forEach(a => {
      if (a.needsNestingBump) rows.push(["Needs Nesting Bump", ...baseFields(a), "Agent is in a Roster status but already has Litmos credentials. Move to 'Nesting - First Call' so they can access the pre-production course."]);
      if (a.needsNewCredentials) rows.push(["Rehire — Needs New Credentials", ...baseFields(a), `Rehire with terminated/locked Litmos account — do NOT bump. Issue fresh credentials. Signals: ${(a.rehireSignals || []).join(" · ")}`]);
      if (a.isBgMismatch) rows.push(["BG Data Mismatch", ...baseFields(a), "Roster shows cleared but CIP shows In Progress. Investigate BG check system sync."]);
      if (a.hasAccountIssue) rows.push(["BG Pending/Created", ...baseFields(a), "Background check not cleared. Agent blocked from progressing."]);
      if (a.isGhost) rows.push(["Nesting Without Credentials", ...baseFields(a), "In Nesting status but no Litmos account. Needs credentialing or status correction."]);
      if (a.isTrulyStale) rows.push(["Stale 3+ Weeks", ...baseFields(a), "Ready for credentials 3+ weeks but not processed. Manual investigation needed."]);
      if (a.isStaleInQueue) rows.push(["Stale — In Queue", ...baseFields(a), "Credentials requested 3+ weeks ago. Check if batch was processed."]);
      if (a.hasNameCollision) rows.push(["Name Collision", ...baseFields(a), `Multiple Litmos accounts share this name: ${(a.collidingUsernames || []).join(", ")}. Verify manually before credentialing.`]);
    });
    // Sort by issue type so BG mismatches are grouped together
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    downloadCsv(headers, rows, `pipeline_issues_${today}.csv`);
    toast.success(`Exported ${rows.length.toLocaleString()} issue rows`);
  };

  // Dedicated export for the recurring "Needs Nesting Bump" report.
  // Format matches what Ops Manager expects: Campaign, Agent Name, ShyftOff ID,
  // Current Status, BG Check Status (with cross-source mismatch detail), Action.
  // Sorted by Campaign (ENG → Bilingual → Both), then alphabetically by name.
  const handleExportNestingBump = () => {
    if (!results) return;
    const bumpAgents = results.filter(a => a.needsNestingBump);
    if (!bumpAgents.length) return;
    const today = new Date().toISOString().split("T")[0];
    const headers = ["Campaign","Agent Name","ShyftOff ID","Current Status","BG Check Status","Action"];

    const labelCampaign = (a) => {
      // Determine campaign(s) the agent appears in
      const c = (a.rowCampaign || "").toLowerCase();
      const prodCs = (a.prodCampaigns || []).map(x => x.toLowerCase());
      const allCs = [c, ...prodCs];
      const hasEng = allCs.some(x => x && x.includes("nations") && !x.includes("bilingual"));
      const hasBi = allCs.some(x => x && x.includes("bilingual"));
      if (hasEng && hasBi) return "Both ENG + Bilingual";
      if (hasBi) return "Bilingual";
      if (hasEng) return "ENG";
      return "Unknown";
    };

    const labelBg = (a) => {
      const simpleCleared = (a.bgStatus || "").toLowerCase() === "cleared";
      const cipReport = (a.cipBgReport || "").toLowerCase();
      const cipProcess = (a.cipBgProcess || "").toUpperCase();
      const cipMismatch = cipProcess === "IN_PROGRESS" && cipReport && !["clear","proceed"].includes(cipReport);
      if (simpleCleared && cipMismatch) return `MISMATCH (Roster: cleared, CIP: ${cipReport})`;
      if (a.bgCleared) return "Cleared";
      if (a.bgStatus) return a.bgStatus.charAt(0).toUpperCase() + a.bgStatus.slice(1);
      return "Unknown";
    };

    const rows = bumpAgents.map(a => [
      labelCampaign(a),
      a.name,
      a.sid,
      a.status,
      labelBg(a),
      'Move to "Nesting - First Call"',
    ]);

    const order = { "ENG": 0, "Bilingual": 1, "Both ENG + Bilingual": 2, "Unknown": 3 };
    rows.sort((x, y) => {
      const co = (order[x[0]] ?? 99) - (order[y[0]] ?? 99);
      if (co !== 0) return co;
      return x[1].toLowerCase().localeCompare(y[1].toLowerCase());
    });

    downloadCsv(headers, rows, `needs_nesting_bump_by_campaign_${today}.csv`);
    toast.success(`Exported ${rows.length.toLocaleString()} agents needing Nesting bump`);
  };

  // Ops export specifically for rehires-needing-fresh-credentials. Same shape
  // as the bump export but with rehire diagnostic columns so ops can see why
  // the agent was flagged (prior removal? old completion? dormant account?).
  const handleExportNewCreds = () => {
    if (!results) return;
    const rehireAgents = results.filter(a => a.needsNewCredentials);
    if (!rehireAgents.length) return;
    const today = new Date().toISOString().split("T")[0];
    const headers = [
      "Campaign", "Agent Name", "ShyftOff ID", "Current Status",
      "Litmos Count", "Last Litmos Completion (days ago)", "Litmos Account Age (days)",
      "Prior Removal Reason", "Prior Removal Date", "Detection Signals", "Action",
    ];
    const labelCampaign = (a) => {
      const c = (a.rowCampaign || "").toLowerCase();
      const hasEng = c && c.includes("nations") && !c.includes("bilingual");
      const hasBi = c && c.includes("bilingual");
      if (hasBi) return "Bilingual";
      if (hasEng) return "ENG";
      return "Unknown";
    };
    const rows = rehireAgents.map(a => [
      labelCampaign(a),
      a.name,
      a.sid,
      a.status,
      `${a.litmosCount}/14`,
      a.daysSinceLastLitmosCompletion !== null ? a.daysSinceLastLitmosCompletion : "(never)",
      a.litmosAccountAgeDays !== null ? a.litmosAccountAgeDays : "(unknown)",
      a.lastRemovalReason || "(not in removed-export)",
      a.lastRemovalDate || "(N/A)",
      (a.rehireSignals || []).join(" · "),
      "Issue NEW Litmos credentials — do not bump to Nesting",
    ]);
    const order = { "ENG": 0, "Bilingual": 1, "Unknown": 2 };
    rows.sort((x, y) => {
      const co = (order[x[0]] ?? 99) - (order[y[0]] ?? 99);
      if (co !== 0) return co;
      return x[1].toLowerCase().localeCompare(y[1].toLowerCase());
    });
    downloadCsv(headers, rows, `rehires_needing_new_credentials_${today}.csv`);
    toast.success(`Exported ${rows.length.toLocaleString()} rehires needing fresh credentials`);
  };

  const emailBody = useMemo(() => {
    if (!stats || !results) return "";
    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const readyNames = results.filter(a => a.readyStatus === "ready").map(a => a.name);
    const waitingNames = results.filter(a => a.isWaitingForCreds).map(a => a.name);
    const ghostNames = results.filter(a => a.isGhost).map(a => a.name);
    const staleQueueNames = results.filter(a => a.isStaleInQueue).map(a => a.name);
    const trulyStaleNames = results.filter(a => a.isTrulyStale).map(a => a.name);
    const bgMismatchNames = results.filter(a => a.isBgMismatch).map(a => a.name);

    let body = `Hi Jayden,\n\nHere is the NationsBenefits pipeline readiness summary as of ${today}.\n`;
    body += `\nPIPELINE OVERVIEW\n`;
    body += `• Total agents in pipeline: ${stats.total}\n`;
    body += `• Production ready (all 3 pillars): ${stats.ready}\n`;
    body += `• Litmos 14/14 complete: ${stats.litmosDone}\n`;
    body += `• ShyftOff certification 100%: ${stats.shyftoffDone}\n`;

    if (readyNames.length > 0) {
      body += `\nREADY FOR PRODUCTION (${readyNames.length})\n`;
      readyNames.forEach(n => { body += `• ${n}\n`; });
    }

    if (stats.waitingForCreds > 0 || stats.ghosts > 0 || stats.accountIssues > 0) {
      body += `\nACTION ITEMS\n`;
    }
    if (stats.waitingForCreds > 0) {
      body += `\nWaiting for Credentials (${stats.waitingForCreds}):\n`;
      body += `NB Certification complete + BG cleared but not yet in Litmos — should be added to credentials list.\n`;
      waitingNames.slice(0, 10).forEach(n => { body += `• ${n}\n`; });
      if (waitingNames.length > 10) body += `• ...and ${waitingNames.length - 10} more\n`;
    }
    if (staleQueueNames.length > 0) {
      body += `\nCredentials In Queue — 3+ Weeks (${staleQueueNames.length}):\n`;
      body += `Credentials were requested but not yet processed — check if the batch was sent.\n`;
      staleQueueNames.slice(0, 10).forEach(n => { body += `• ${n}\n`; });
      if (staleQueueNames.length > 10) body += `• ...and ${staleQueueNames.length - 10} more\n`;
    }
    if (trulyStaleNames.length > 0) {
      body += `\nTruly Stale — 3+ Weeks (${trulyStaleNames.length}):\n`;
      body += `Waiting 3+ weeks with no credentials request — needs manual investigation.\n`;
      trulyStaleNames.slice(0, 10).forEach(n => { body += `• ${n}\n`; });
      if (trulyStaleNames.length > 10) body += `• ...and ${trulyStaleNames.length - 10} more\n`;
    }
    if (bgMismatchNames.length > 0) {
      body += `\nBG Check Mismatch (${bgMismatchNames.length}):\n`;
      body += `Roster shows BG "cleared" but CIP export shows In Progress — cross-source BG mismatch.\n`;
      bgMismatchNames.slice(0, 10).forEach(n => { body += `• ${n}\n`; });
      if (bgMismatchNames.length > 10) body += `• ...and ${bgMismatchNames.length - 10} more\n`;
    }
    if (stats.ghosts > 0) {
      body += `\nNesting Without Credentials (${stats.ghosts}):\n`;
      body += `In Nesting status but not in Litmos — may need to be credentialed or moved back.\n`;
      ghostNames.forEach(n => { body += `• ${n}\n`; });
    }
    if (stats.accountIssues > 0) {
      body += `\nBackground Check Issues: ${stats.accountIssues} agents with BG check not cleared.\n`;
    }

    body += `\nPlease let me know if you need the full detailed export or have any questions.\n`;
    body += `\nBest,\nDavid`;
    return body;
  }, [stats, results]);

  const emailSubject = useMemo(() => {
    if (!stats) return "";
    const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
    return `NB Pipeline Update ${today} — ${stats.ready} Production Ready, ${stats.waitingForCreds} Awaiting Credentials`;
  }, [stats]);

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(emailBody);
    toast.success("Email body copied to clipboard");
  };

  const handleOpenMail = () => {
    const to = "jaydencole@shyftoff.com";
    const cc = "davidmorales@shyftoff.com,ericyost@shyftoff.com";
    const mailto = `mailto:${to}?cc=${encodeURIComponent(cc)}&subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.open(mailto);
  };

  const hasData = results !== null;

  return (
    <div className="min-h-screen" style={{ background: "#27133A", color: "#E8DFF6", fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet" />

      <div className="border-b" style={{ borderColor: "#3d2057", background: "#1a0d2e" }}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm" style={{ background: "#8F68D3", color: "#27133A" }}>NB</div>
            <div>
              <div className="font-bold text-sm tracking-tight">Production Readiness Checker</div>
              <div className="text-xs" style={{ color: "#7a5f9a" }}>NationsBenefits Agent Pipeline</div>
            </div>
          </div>
          {hasData && (
            <div className="flex items-center gap-2">
              <button onClick={() => setShowDetailCols(!showDetailCols)}
                className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
                style={{ background: showDetailCols ? "#8F68D3" : "transparent", color: showDetailCols ? "#27133A" : "#b8a5d4" }}>
                {showDetailCols ? "Hide Course Cols" : "Show Course Cols"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Cache status bar — appears when data is restored from IndexedDB */}
        {savedAt && (
          <div className="mb-3 rounded-lg px-3 py-2 flex items-center justify-between text-xs"
            style={{ background: isStale(savedAt) ? "#3d300022" : "#1a4d2e22", border: `1px solid ${isStale(savedAt) ? "#FFE566" : "#1a4d2e"}` }}>
            <div className="flex items-center gap-3">
              <span style={{ color: isStale(savedAt) ? "#FFE566" : "#4ade80" }}>
                {isStale(savedAt) ? "⚠ Loaded data is from a previous day" : "✓ Loaded from cache"}
              </span>
              <span style={{ color: "#7a5f9a" }}>{formatLoadedTime(savedAt)}</span>
              {fileMeta && (
                <span style={{ color: "#5c3d7a" }}>
                  • {Object.values(fileMeta).reduce((sum, arr) => sum + arr.length, 0)} files
                </span>
              )}
              {history.length > 1 && (
                <span style={{ color: "#5c3d7a" }}>• {history.length} day{history.length > 1 ? "s" : ""} of history</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isStale(savedAt) && (
                <span style={{ color: "#FFE566" }}>Re-upload today's files to refresh</span>
              )}
              <button onClick={() => handleClearCache(false)}
                className="px-2 py-0.5 rounded text-xs transition-all hover:brightness-110"
                style={{ background: "#3d2057", color: "#b8a5d4" }}
                title="Clears current snapshot. Daily history is preserved.">
                Clear cache
              </button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-6 gap-3 mb-4">
          <FileUpload required label="Litmos Course Data" sublabel="CSV with per-course completions" onFiles={f => handleFiles("litmos", setLitmosFiles, f)} multiple files={litmosFiles} validation={fileTypes.litmos} />
          <FileUpload required label="Litmos People Report" sublabel="Who has a Litmos account" onFiles={f => handleFiles("people", setPeopleFiles, f)} multiple={false} files={peopleFiles} validation={fileTypes.people} />
          <FileUpload required label="Nesting / CIP Export" sublabel="Dashboard or CIP agent export" onFiles={f => handleFiles("cip", setCipFiles, f)} multiple files={cipFiles} validation={fileTypes.cip} />
          <FileUpload label="Production Exports" sublabel="Exclude current prod agents" onFiles={f => handleFiles("prod", setProdFiles, f)} multiple files={prodFiles} validation={fileTypes.prod} />
          <FileUpload label="Nav Meeting Tracker" sublabel="Upload multiple ShyftNav exports — duplicates auto-deduped" onFiles={f => handleFiles("nav", setNavFiles, f)} multiple files={navFiles} validation={fileTypes.nav} />
          <FileUpload label="Removed Reports" sublabel="Optional — surfaces returning-agent context (last 180 days)" onFiles={f => handleFiles("removed", setRemovedFiles, f)} multiple files={removedFiles} validation={fileTypes.removed} />
        </div>

        <div className="flex gap-2 mb-5 items-center flex-wrap">
          <button onClick={handleProcess}
            disabled={!litmosFiles.length || !cipFiles.length || !peopleFiles.length || processing}
            className="px-5 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "var(--c-primary)", color: "var(--c-bg-page)" }}>
            {processing ? "Processing…" : "Analyze Readiness"}
          </button>
          {/* Sulto integration indicator — only shown when env vars are configured */}
          {isSultoConfigured() && (
            <span
              className="text-xs px-2 py-0.5 rounded inline-flex items-center gap-1"
              style={{ background: "var(--c-bg-panel)", color: "var(--c-text-dim)", border: "1px solid var(--c-border)" }}
              title="Snapshots are pushed to the Sulto receiver after each Analyze"
            >
              → Sulto
            </span>
          )}
          {/* Inline validation hint — surfaces missing required files when Analyze is disabled */}
          {!hasData && !processing && (!litmosFiles.length || !cipFiles.length || !peopleFiles.length) && (
            <span className="text-xs" style={{ color: "var(--c-yellow)" }}>
              Missing required:{" "}
              {[!litmosFiles.length && "Litmos Course Data", !peopleFiles.length && "Litmos People Report", !cipFiles.length && "Nesting / CIP Export"].filter(Boolean).join(", ")}
            </span>
          )}
          {hasData && (
            <>
              <button onClick={handleExport} className="px-4 py-2 rounded-lg text-sm font-semibold border transition-all hover:bg-purple-900/30" style={{ borderColor: "var(--c-border-strong)", color: "var(--c-text-muted)" }}>
                Export CSV
              </button>
              <button onClick={handleExportIssues} className="px-4 py-2 rounded-lg text-sm font-semibold border transition-all hover:brightness-110" style={{ borderColor: "var(--c-yellow)", color: "var(--c-yellow)" }}>
                Export Issues
              </button>
              <button onClick={() => setShowEmail(true)} className="px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110" style={{ background: "var(--c-pink)", color: "#fff" }}>
                Generate Email
              </button>
            </>
          )}
        </div>

        {hasData && stats && (
          <>
            <div className="grid grid-cols-5 gap-3 mb-5">
              <StatCard label="Pipeline Total" value={stats.total} sub={`${stats.engPipeline} ENG • ${stats.biPipeline} BI`} color="#E8DFF6" />
              <StatCard label="Production Ready" value={stats.ready} sub={`${stats.readyEng} ENG • ${stats.readyBi} BI`} color="#4ade80" />
              <StatCard label="Litmos Complete" value={stats.litmosDone} sub="14/14 required courses" color="#8F68D3" />
              <StatCard label="ShyftOff Cert" value={stats.shyftoffDone} sub="100% certification progress" color="#FF66C4" />
              <StatCard label="Nav Meeting" value={stats.navAttended} sub={stats.navAvailable ? "Confirmed attended" : "No data uploaded"} color={stats.navAvailable ? "#FFE566" : "#5c3d7a"} />
            </div>

            {/* === SECTION: Daily Diff (only when 2+ days of history) === */}
            {dailyDiff && dailyDiff.totalChanges > 0 && (
              <div className="mb-3 rounded-xl overflow-hidden" style={{ border: "1px solid var(--c-border)" }}>
                <button onClick={() => toggleSection("diff")} className="w-full flex items-center justify-between px-4 py-2.5 transition-all hover:brightness-110" style={{ background: "var(--c-bg-panel)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: "var(--c-text-dim)" }}>{openSections.has("diff") ? "▾" : "▸"}</span>
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-dim)" }}>Daily Changes</span>
                    <span className="text-xs" style={{ color: "var(--c-text-faint)" }}>since {dailyDiff.previousDate}</span>
                  </div>
                  <div className="text-xs" style={{ color: "var(--c-text-muted)" }}>
                    <span className="font-semibold" style={{ color: "var(--c-primary)" }}>{dailyDiff.totalChanges}</span>
                    <span> change{dailyDiff.totalChanges === 1 ? "" : "s"}</span>
                  </div>
                </button>
                {openSections.has("diff") && (
                  <div className="px-4 py-3 grid grid-cols-3 gap-2" style={{ background: "var(--c-bg-page)" }}>
                    {DIFF_CATEGORIES.map(cat => {
                      const data = dailyDiff[cat.key];
                      if (!data || data.count === 0) return null;
                      const isOpen = openDiffCats.has(cat.key);
                      return (
                        <div key={cat.key}
                          className="rounded-lg overflow-hidden"
                          style={{
                            background: cat.tone === "bad" ? "rgba(255,120,102,0.05)" : cat.tone === "good" ? "rgba(74,222,128,0.05)" : "var(--c-bg-panel)",
                            border: `1px solid ${cat.tone === "bad" ? "var(--c-orange)" : cat.tone === "good" ? "var(--c-success)" : "var(--c-border)"}`,
                          }}>
                          <button onClick={() => toggleDiffCat(cat.key)} className="w-full text-left px-3 py-2 transition-all hover:brightness-110">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold flex items-center gap-2" style={{ color: cat.color }}>
                                <span>{cat.icon}</span>
                                <span>{cat.label}</span>
                              </span>
                              <span className="text-lg font-black" style={{ color: cat.color }}>{data.count}</span>
                            </div>
                            {data.count > 0 && (
                              <div className="text-[10px] mt-0.5" style={{ color: "var(--c-text-faint)" }}>
                                {isOpen ? "▾ Click to collapse" : "▸ Click to see who"}
                              </div>
                            )}
                          </button>
                          {isOpen && (
                            <div className="px-3 pb-2 max-h-48 overflow-y-auto" style={{ borderTop: `1px solid ${cat.color}33` }}>
                              {data.agents.slice(0, 50).map((a, i) => (
                                <div key={`${a.sid}-${i}`} className="text-xs py-0.5 flex items-center justify-between gap-2" style={{ color: "var(--c-text-muted)" }}>
                                  <span className="truncate">{a.name}</span>
                                  <span className="text-[10px]" style={{ color: "var(--c-text-faint)" }}>
                                    {a.before !== undefined && a.after !== undefined
                                      ? `${a.before} → ${a.after}`
                                      : a.flag
                                        ? a.flag.replace(/^is|^needs/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()
                                        : a.status || ""}
                                  </span>
                                </div>
                              ))}
                              {data.agents.length > 50 && (
                                <div className="text-[10px] mt-1" style={{ color: "var(--c-text-faint)" }}>… and {data.agents.length - 50} more</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* === SECTION: Action Items === */}
            <div className="mb-3 rounded-xl overflow-hidden" style={{ border: "1px solid #3d2057" }}>
              <button onClick={() => toggleSection("outreach")} className="w-full flex items-center justify-between px-4 py-2.5 transition-all hover:brightness-110" style={{ background: "#1a0d2e" }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: "#7a5f9a" }}>{openSections.has("outreach") ? "▾" : "▸"}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#7a5f9a" }}>Action Items</span>
                </div>
                <div className="text-xs flex gap-3" style={{ color: "#5c3d7a" }}>
                  <span style={{ color: stats.needsNestingBump > 0 ? "#FF66C4" : "#5c3d7a" }}>{stats.needsNestingBump} need Nesting bump</span>
                  <span>•</span>
                  <span style={{ color: stats.needsNewCredentials > 0 ? "#FF7866" : "#5c3d7a" }}>{stats.needsNewCredentials} rehires need creds</span>
                  <span>•</span>
                  <span style={{ color: stats.needsNavOutreach > 0 ? "#FFE566" : "#5c3d7a" }}>{stats.needsNavOutreach} need Nav</span>
                </div>
              </button>
              {openSections.has("outreach") && (
                <div className="px-4 py-3 grid grid-cols-3 gap-2" style={{ background: "#27133A" }}>
                  <div className="rounded-lg p-3" style={{ background: filter === "needs_bump" ? "#FF66C422" : "#FF66C411", border: `1px solid ${filter === "needs_bump" ? "#FF66C4" : "#794EC2"}` }}>
                    <button onClick={() => setFilter(filter === "needs_bump" ? "all" : "needs_bump")} className="w-full text-left transition-all hover:brightness-110">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-bold" style={{ color: "#FF66C4" }}>Needs Nesting Bump</span>
                        <span className="text-2xl font-black" style={{ color: "#FF66C4" }}>{stats.needsNestingBump}</span>
                      </div>
                      <div className="text-xs" style={{ color: "#b8a5d4" }}>In Roster + has fresh Litmos credentials. Move to "Nesting - First Call" so they can access pre-production. Rehires with old/locked accounts are excluded — see next card.</div>
                    </button>
                    {stats.needsNestingBump > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); handleExportNestingBump(); }} className="mt-2 px-2 py-1 rounded text-xs font-semibold transition-all hover:brightness-110" style={{ background: "#FF66C4", color: "#27133A" }}>
                        ↓ Export for Ops (CSV)
                      </button>
                    )}
                  </div>
                  <div className="rounded-lg p-3" style={{ background: filter === "needs_new_creds" ? "#FF786633" : "#FF786611", border: `1px solid ${filter === "needs_new_creds" ? "#FF7866" : "#4D1F3B"}` }}>
                    <button onClick={() => setFilter(filter === "needs_new_creds" ? "all" : "needs_new_creds")} className="w-full text-left transition-all hover:brightness-110">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-bold flex items-center gap-1" style={{ color: "#FF7866" }}>↻ Rehire — Needs New Credentials</span>
                        <span className="text-2xl font-black" style={{ color: "#FF7866" }}>{stats.needsNewCredentials}</span>
                      </div>
                      <div className="text-xs" style={{ color: "#b8a5d4" }}>In Roster with an OLD Litmos account (terminated/locked). Issue fresh credentials before they can advance — do NOT bump to Nesting.</div>
                    </button>
                    {stats.needsNewCredentials > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); handleExportNewCreds(); }} className="mt-2 px-2 py-1 rounded text-xs font-semibold transition-all hover:brightness-110" style={{ background: "#FF7866", color: "#27133A" }}>
                        ↓ Export for Ops (CSV)
                      </button>
                    )}
                  </div>
                  <button onClick={() => setFilter(filter === "needs_nav" ? "all" : "needs_nav")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "needs_nav" ? "#FFE56622" : "#FFE56611", border: `1px solid ${filter === "needs_nav" ? "#FFE566" : "#3d2057"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-bold" style={{ color: "#FFE566" }}>Needs Nav Meeting</span>
                      <span className="text-2xl font-black" style={{ color: "#FFE566" }}>{stats.needsNavOutreach}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#b8a5d4" }}>Completed all ShyftOff courses but missed the live Navigation Meeting. Reach out to encourage attendance.</div>
                  </button>
                </div>
              )}
            </div>

            {/* === SECTION: Pipeline Health === */}
            <div className="mb-3 rounded-xl overflow-hidden" style={{ border: "1px solid #3d2057" }}>
              <button onClick={() => toggleSection("health")} className="w-full flex items-center justify-between px-4 py-2.5 transition-all hover:brightness-110" style={{ background: "#1a0d2e" }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: "#7a5f9a" }}>{openSections.has("health") ? "▾" : "▸"}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#7a5f9a" }}>Pipeline Health</span>
                </div>
                <div className="text-xs" style={{ color: stats.ghosts + stats.accountIssues + stats.staleBgMismatch + stats.nameCollisions > 0 ? "#FF7866" : "#5c3d7a" }}>
                  {stats.ghosts + stats.accountIssues + stats.staleBgMismatch + stats.nameCollisions} issues
                </div>
              </button>
              {openSections.has("health") && (
                <div className="px-4 py-3 grid grid-cols-4 gap-2" style={{ background: "#27133A" }}>
                  <button onClick={() => setFilter(filter === "ghosts" ? "all" : "ghosts")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "ghosts" ? "#3d152544" : "#3d152522", border: `1px solid ${filter === "ghosts" ? "#FF7866" : "#4D1F3B"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold" style={{ color: "#FF7866" }}>Nesting — No Creds</span>
                      <span className="text-xl font-black" style={{ color: "#FF7866" }}>{stats.ghosts}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>In Nesting but no Litmos account.</div>
                  </button>
                  <button onClick={() => setFilter(filter === "account_issues" ? "all" : "account_issues")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "account_issues" ? "#4D1F3B44" : "#4D1F3B22", border: `1px solid ${filter === "account_issues" ? "#FFE566" : "#4D1F3B"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold" style={{ color: "#FFE566" }}>BG Blocked</span>
                      <span className="text-xl font-black" style={{ color: "#FFE566" }}>{stats.accountIssues}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>BG pending or created — blocked.</div>
                  </button>
                  <button onClick={() => setFilter(filter === "stale_bg" ? "all" : "stale_bg")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "stale_bg" ? "#FFE56630" : "#FFE56615", border: `1px solid ${filter === "stale_bg" ? "#FFE566" : "#FFE56666"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold" style={{ color: "#FFE566" }}>BG Mismatch</span>
                      <span className="text-xl font-black" style={{ color: "#FFE566" }}>{stats.staleBgMismatch}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>Roster ≠ CIP. Flag to Product.</div>
                  </button>
                  <button onClick={() => setFilter(filter === "name_collision" ? "all" : "name_collision")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "name_collision" ? "#3d205744" : "#3d205722", border: `1px solid ${filter === "name_collision" ? "#FF66C4" : "#794EC2"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold" style={{ color: "#FF66C4" }}>Name Collisions</span>
                      <span className="text-xl font-black" style={{ color: "#FF66C4" }}>{stats.nameCollisions}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>Same name as existing Litmos users. Verify manually.</div>
                  </button>
                </div>
              )}
              {/* Returning agents — only when Removed Reports file is uploaded */}
              {openSections.has("health") && removalMap && (
                <div className="px-4 pb-3 grid grid-cols-3 gap-2" style={{ background: "#27133A" }}>
                  <button onClick={() => setFilter(filter === "returning" ? "all" : "returning")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "returning" ? "#794EC244" : "#794EC222", border: `1px solid ${filter === "returning" ? "#8F68D3" : "#794EC2"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold flex items-center gap-1" style={{ color: "#8F68D3" }}>↩ Returning Agents</span>
                      <span className="text-xl font-black" style={{ color: "#8F68D3" }}>{stats.returning}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>Currently in pipeline but previously removed. Useful coaching context.</div>
                  </button>
                  <button onClick={() => setFilter(filter === "returning_prod" ? "all" : "returning_prod")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "returning_prod" ? "#3d152544" : "#3d152522", border: `1px solid ${filter === "returning_prod" ? "#FF7866" : "#4D1F3B"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold" style={{ color: "#FF7866" }}>Previously in Production</span>
                      <span className="text-xl font-black" style={{ color: "#FF7866" }}>{stats.returningPreviouslyInProd}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>Reached production before, fell off (Performance / Production Stale), and are back.</div>
                  </button>
                  <button onClick={() => setFilter(filter === "returning_repeat" ? "all" : "returning_repeat")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "returning_repeat" ? "#3d300044" : "#3d300022", border: `1px solid ${filter === "returning_repeat" ? "#FFE566" : "#4D1F3B"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold" style={{ color: "#FFE566" }}>Multiple Removals</span>
                      <span className="text-xl font-black" style={{ color: "#FFE566" }}>{stats.returningMultipleTimes}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>Removed 2+ times in the last 180 days. Worth a deeper look.</div>
                  </button>
                </div>
              )}
            </div>

            {/* === SECTION: Credential Pipeline === */}
            <div className="mb-3 rounded-xl overflow-hidden" style={{ border: "1px solid #3d2057" }}>
              <button onClick={() => toggleSection("creds")} className="w-full flex items-center justify-between px-4 py-2.5 transition-all hover:brightness-110" style={{ background: "#1a0d2e" }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: "#7a5f9a" }}>{openSections.has("creds") ? "▾" : "▸"}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#7a5f9a" }}>Credential Pipeline</span>
                </div>
                <div className="text-xs flex items-center gap-3" style={{ color: "#5c3d7a" }}>
                  <span>{stats.waitingForCreds} ready</span>
                  <span>•</span>
                  <span>{stats.credsRequestedTotal} requested</span>
                  <span>•</span>
                  <span>{stats.alreadyCredentialed} credentialed</span>
                </div>
              </button>
              {openSections.has("creds") && (
                <div className="px-4 py-3 grid grid-cols-4 gap-2" style={{ background: "#27133A" }}>
                  <button onClick={() => setFilter(filter === "waiting_creds" ? "all" : "waiting_creds")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "waiting_creds" ? "#794EC244" : "#794EC222", border: `1px solid ${filter === "waiting_creds" ? "#8F68D3" : "#794EC2"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold" style={{ color: "#8F68D3" }}>Ready</span>
                      <span className="text-xl font-black" style={{ color: "#E8DFF6" }}>{stats.waitingForCreds}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>Courses + BG done. Credential next.</div>
                  </button>
                  <button onClick={() => setFilter(filter === "creds_no_courses" ? "all" : "creds_no_courses")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "creds_no_courses" ? "#3d205744" : "#3d205722", border: `1px solid ${filter === "creds_no_courses" ? "#b8a5d4" : "#3d2057"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold" style={{ color: "#b8a5d4" }}>Courses Incomplete</span>
                      <span className="text-xl font-black" style={{ color: "#b8a5d4" }}>{stats.credsRequestedNoCourses}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>Creds requested but NB Certification not done.</div>
                  </button>
                  <button onClick={() => setFilter(filter === "stale_true" ? "all" : "stale_true")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "stale_true" ? "#4D1F3B44" : "#4D1F3B22", border: `1px solid ${filter === "stale_true" ? "#FF7866" : "#4D1F3B"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold" style={{ color: "#FF7866" }}>Stale 3+ Weeks</span>
                      <span className="text-xl font-black" style={{ color: "#FF7866" }}>{stats.trulyStale}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>Ready but not credentialed. Investigate.</div>
                  </button>
                  <button onClick={() => setFilter(filter === "stale_queue" ? "all" : "stale_queue")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "stale_queue" ? "#3d205744" : "#3d205722", border: `1px solid ${filter === "stale_queue" ? "#b8a5d4" : "#3d2057"}` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold" style={{ color: "#b8a5d4" }}>In Queue</span>
                      <span className="text-xl font-black" style={{ color: "#b8a5d4" }}>{stats.staleInQueue}</span>
                    </div>
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>Requested 3+ weeks. Check batch.</div>
                  </button>
                </div>
              )}
            </div>

            {/* === SEARCH + FILTERS === */}
            <div className="flex items-center gap-3 mb-3">
              <input type="text" placeholder="Search by name, ID, or email..."
                value={search} onChange={e => setSearch(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "#1a0d2e", border: "1px solid #3d2057", color: "#E8DFF6" }} />
              <div className="flex gap-1 flex-wrap">
                {[
                  { key: "all", label: "All" },
                  { key: "ready", label: "Ready" },
                  { key: "partial", label: "In Progress" },
                  { key: "missing", label: "Not Started" },
                  { key: "campaign_eng", label: "ENG" },
                  { key: "campaign_bi", label: "BI" },
                  { key: "campaign_both", label: "Both" },
                  { key: "production", label: "Production" },
                ].map(f => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
                    style={{ background: filter === f.key ? "#3d2057" : "transparent", color: filter === f.key ? "#E8DFF6" : "#7a5f9a" }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #3d2057" }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr style={{ background: "#1a0d2e", boxShadow: "0 1px 0 #3d2057" }}>
                      <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#7a5f9a" }}>Agent</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#7a5f9a" }}>CIP Status</th>
                      <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#7a5f9a" }}>Litmos</th>
                      {showDetailCols && SHORT_LITMOS.map((s, i) => (
                        <th key={i} className="text-center px-1 py-2.5 font-semibold text-xs" style={{ color: "#5c3d7a", maxWidth: 40 }} title={REQUIRED_LITMOS[i]}>{s}</th>
                      ))}
                      <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#7a5f9a" }}>ShyftOff Cert</th>
                      <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#7a5f9a" }}>Nav Meeting</th>
                      <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#7a5f9a" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={99} className="text-center py-8" style={{ color: "#5c3d7a" }}>No agents match current filters</td></tr>
                    ) : filtered.map((a, idx) => (
                      <tr key={(a.key || a.sid) + idx}
                        className="cursor-pointer transition-all group"
                        style={{ background: idx % 2 === 0 ? "#27133A" : "#1a0d2e", borderBottom: "1px solid #1a0d2e" }}
                        onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
                        onMouseEnter={e => e.currentTarget.style.background = "#3d2057"}
                        onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? "#27133A" : "#1a0d2e"}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="font-semibold">{a.name}</div>
                            {/* Campaign tag: which NB campaign this row is for (ENG or BI) */}
                            {!a.isProd && a.rowCampaign && /bilingual/i.test(a.rowCampaign) && (
                              <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#794EC2", color: "#E8DFF6", fontSize: 10 }}>BI</span>
                            )}
                            {!a.isProd && a.rowCampaign && !/bilingual/i.test(a.rowCampaign) && /nations/i.test(a.rowCampaign) && (
                              <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#3d2057", color: "#8F68D3", fontSize: 10 }}>ENG</span>
                            )}
                            {/* If they're ALREADY in prod for another campaign, surface that */}
                            {!a.isProd && a.prodCampaigns && a.prodCampaigns.length > 0 && (
                              <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#1a4d2e", color: "#4ade80", fontSize: 10 }} title={"Already in production for: " + a.prodCampaigns.join(", ")}>
                                PROD: {a.prodCampaigns.some(c => /bilingual/i.test(c)) ? "BI" : ""}{a.prodCampaigns.some(c => /bilingual/i.test(c)) && a.prodCampaigns.some(c => !/bilingual/i.test(c) && /nations/i.test(c)) ? "+" : ""}{a.prodCampaigns.some(c => !/bilingual/i.test(c) && /nations/i.test(c)) ? "ENG" : ""}
                              </span>
                            )}
                            {a.isProd && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#794EC2", color: "#E8DFF6", fontSize: 10 }}>PROD{a.prodCampaigns && a.prodCampaigns.length > 0 ? " " + (a.prodCampaigns.some(c => /bilingual/i.test(c)) && a.prodCampaigns.some(c => !/bilingual/i.test(c) && /nations/i.test(c)) ? "BI+ENG" : a.prodCampaigns.some(c => /bilingual/i.test(c)) ? "BI" : "ENG") : ""}</span>}
                            {a.isProd && a.wasRemoved && (
                              <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#3d1525", color: "#FF7866", fontSize: 10 }}
                                title={`Previously removed ${a.removalCount}× (last: ${a.lastRemovalReason}, ${a.lastRemovalDaysAgo}d ago) — currently back in production.`}>
                                ↩ COMEBACK
                              </span>
                            )}
                            {a.isProd && a.removedTodayInProd && (
                              <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#3d3000", color: "#FFE566", fontSize: 10 }}
                                title="Source data shows this agent as 'Removed' today AND active in production today. Likely a data correction needed in the source system.">
                                ⚠ DATA CONFLICT
                              </span>
                            )}
                            <button
                              onClick={(e) => handleCopyAgent(a, idx, e)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded text-xs"
                              style={{ background: copiedIdx === idx ? "#1a4d2e" : "#3d2057", color: copiedIdx === idx ? "#4ade80" : "#b8a5d4", fontSize: 10 }}
                              title="Copy agent info to clipboard"
                            >
                              {copiedIdx === idx ? "Copied!" : "📋 Copy"}
                            </button>
                          </div>
                          <div className="text-xs" style={{ color: "#7a5f9a", fontFamily: "'IBM Plex Mono', monospace" }}>{a.sid}</div>
                          {!a.isProd && (
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {a.isGhost && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#3d1525", color: "#FF7866", fontSize: 10 }}>NOT IN LITMOS</span>}
                            {a.hasAccountIssue && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#4D1F3B", color: "#FFE566", fontSize: 10 }}>BG: {a.bgStatus}</span>}
                            {a.isTrulyStale && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#4D1F3B", color: "#FF7866", fontSize: 10 }}>STALE {a.daysSinceChange}d</span>}
                            {a.isStaleInQueue && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#2d1a4e", color: "#8F68D3", fontSize: 10 }}>IN QUEUE {a.daysSinceChange}d</span>}
                            {a.isBgMismatch && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#3d3000", color: "#FFE566", fontSize: 10 }}>BG MISMATCH{a.daysSinceChange !== null ? ` ${a.daysSinceChange}d` : ""}</span>}
            {a.isWaitingForCreds && !a.isStaleWaiter && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#2d1a4e", color: "#E8DFF6", fontSize: 10 }}>AWAITING CREDS</span>}
            {a.hasNameCollision && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#3d2057", color: "#FF66C4", fontSize: 10 }}>⚠ NAME COLLISION</span>}
            {a.needsNestingBump && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#794EC2", color: "#FF66C4", fontSize: 10 }}>NEEDS NESTING BUMP</span>}
            {a.needsNewCredentials && (
              <span
                className="text-xs px-1.5 py-0 rounded"
                style={{ background: "#3d1525", color: "#FF7866", fontSize: 10 }}
                title={`Rehire — terminated Litmos account. Signals: ${(a.rehireSignals || []).join(" · ")}`}
              >
                ↻ REHIRE — NEEDS CREDS
              </span>
            )}
            {a.wasRemoved && (
              <span
                className="text-xs px-1.5 py-0 rounded"
                style={{
                  background: a.previouslyInProd ? "#3d1525" : "#3d2057",
                  color: a.previouslyInProd ? "#FF7866" : "#8F68D3",
                  fontSize: 10,
                }}
                title={`Previously removed ${a.removalCount}× (last: ${a.lastRemovalReason}, ${a.lastRemovalDaysAgo}d ago)`}
              >
                ↩ RETURNING{a.removalCount > 1 ? ` ×${a.removalCount}` : ""}
              </span>
            )}
                          </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: "#b8a5d4" }}>{a.status}</td>
                        <td className="px-3 py-2.5 text-center">
                          {a.isProd ? (
                            <span className="text-xs" style={{ color: "#5c3d7a" }}>—</span>
                          ) : (
                          <span className="font-bold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: a.allLitmos ? "#4ade80" : a.litmosCount > 0 ? "#FFE566" : "#FF7866" }}>
                            {a.litmosCount}/14
                          </span>
                          )}
                        </td>
                        {showDetailCols && a.litmosDone.map((c, ci) => (
                          <td key={ci} className="px-1 py-2.5 text-center">
                            <CourseDot done={c.completed} title={c.name} />
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-center">
                          {a.isProd ? (
                            <span className="font-bold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: a.certPct === 100 ? "#4ade80" : a.certPct >= 75 ? "#FFE566" : "#FF7866" }}>
                              {a.certPct !== null ? `${a.certPct}%` : "N/A"}
                            </span>
                          ) : a.shyftoffPct !== null ? (
                            <span className="font-bold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: a.shyftoffComplete ? "#4ade80" : a.shyftoffPct > 0 ? "#FFE566" : "#FF7866" }}>
                              {a.shyftoffPct}%
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: "#5c3d7a" }}>N/A</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {a.isProd
                            ? <span className="text-xs" style={{ color: "#5c3d7a" }}>—</span>
                            : !a.navAvailable
                            ? <span className="text-xs" style={{ color: "#5c3d7a" }}>N/A</span>
                            : a.navAttended
                              ? <span style={{ color: "#4ade80" }}>✓</span>
                              : <span style={{ color: "#FF7866" }}>✗</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 text-center">{a.isProd
                          ? <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: a.allCoursesDone ? "#1a4d2e" : "#3d2057", color: a.allCoursesDone ? "#4ade80" : "#b8a5d4" }}>{a.allCoursesDone ? "COMPLETE" : `CERT ${a.certPct !== null ? a.certPct + "%" : "?"}`}</span>
                          : <Badge type={a.readyStatus} />
                        }</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3 text-xs text-center" style={{ color: "#4D1F3B" }}>
              Showing {filtered.length} {filtered.length > 0 && filtered[0].isProd ? "production" : "pipeline"} agents • {filtered.length > 0 && !filtered[0].isProd ? "Click any row for details" : ""}
            </div>
          </>
        )}

        {!hasData && (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">📋</div>
            <div className="text-lg font-bold mb-1" style={{ color: "#b8a5d4" }}>Upload your data to get started</div>
            <div className="text-sm" style={{ color: "#5c3d7a" }}>
              Drop in your Litmos export and CIP files, then hit Analyze.<br />
              Optionally add production exports to exclude and nav meeting data.
            </div>
          </div>
        )}
      </div>

      {/* Side panel for agent detail */}
      {expandedRow !== null && filtered[expandedRow] && (() => {
        const ag = filtered[expandedRow];
        return (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.3)" }} onClick={() => setExpandedRow(null)} />
            {/* Panel */}
            <div className="fixed top-0 right-0 z-50 h-full overflow-y-auto" style={{ width: 420, background: "#1a0d2e", borderLeft: "1px solid #3d2057", boxShadow: "-4px 0 24px rgba(0,0,0,0.5)" }}>
              {/* Header */}
              <div className="sticky top-0 z-10" style={{ background: "#1a0d2e" }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #3d2057" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="font-bold truncate">{ag.name}</div>
                    <button
                      onClick={() => handleCopyAgent(ag, "detail", { stopPropagation: () => {} })}
                      className="flex-shrink-0 px-2 py-0.5 rounded text-xs transition-all hover:brightness-110"
                      style={{ background: copiedIdx === "detail" ? "#1a4d2e" : "#3d2057", color: copiedIdx === "detail" ? "#4ade80" : "#b8a5d4" }}>
                      {copiedIdx === "detail" ? "✓" : "📋"}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {ag.isProd
                      ? <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#794EC2", color: "#E8DFF6" }}>PRODUCTION</span>
                      : <Badge type={ag.readyStatus} />}
                    <button onClick={() => setExpandedRow(null)} className="text-lg leading-none px-1" style={{ color: "#7a5f9a" }}>&times;</button>
                  </div>
                </div>
                {ag.sid && (
                  <div className="px-4 py-1" style={{ borderBottom: "1px solid #3d2057" }}>
                    <span className="text-xs" style={{ color: "#7a5f9a", fontFamily: "'IBM Plex Mono', monospace" }}>{ag.sid}</span>
                  </div>
                )}
                {/* Banner — different for prod vs pipeline */}
                {ag.isProd ? (
                  <div className="px-4 py-2.5" style={{ background: ag.certPct === 100 ? "#1a4d2e33" : "#3d300033", borderBottom: "1px solid #3d2057" }}>
                    <span className="text-sm font-semibold" style={{ color: ag.allCoursesDone ? "#4ade80" : "#b8a5d4" }}>
                      {ag.allCoursesDone ? "All courses complete" : `Cert ${ag.certPct !== null ? ag.certPct + "%" : "unknown"}`}
                    </span>
                  </div>
                ) : (
                <div className="px-4 py-2.5" style={{
                  background: ag.rosterCoursesDone && ag.bgCleared && !ag.inLitmos ? "#794EC233"
                    : ag.hasAccountIssue ? "#4D1F3B33"
                    : "#27133A",
                  borderBottom: "1px solid #3d2057",
                }}>
                  <span className="text-sm" style={{
                    color: ag.rosterCoursesDone && ag.bgCleared && !ag.inLitmos ? "#FFE566"
                      : ag.inLitmos ? "#4ade80"
                      : ag.hasAccountIssue ? "#FF7866"
                      : "#b8a5d4",
                    fontWeight: 600,
                  }}>
                    {ag.rosterCoursesDone && ag.bgCleared && !ag.inLitmos ? "⚡ " : ""}
                    {ag.credentialNote}
                  </span>
                </div>
                )}
              </div>

              {/* Rehire — Needs New Credentials diagnostic */}
              {ag.needsNewCredentials && (
                <div className="px-4 py-3" style={{ borderBottom: "1px solid #3d2057", background: "#3d152511" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#FF7866" }}>
                      ↻ Rehire — Needs New Credentials
                    </div>
                  </div>
                  <div className="text-xs mb-2" style={{ color: "#b8a5d4" }}>
                    Detected as a likely rehire with old/locked Litmos account.
                    Issue fresh credentials before bumping to Nesting.
                  </div>
                  <ul className="space-y-1 text-xs" style={{ color: "#FFE566" }}>
                    {(ag.rehireSignals || []).map((sig, i) => (
                      <li key={i} style={{ paddingLeft: 12, position: "relative" }}>
                        <span style={{ position: "absolute", left: 0, color: "#FF7866" }}>•</span>
                        {sig}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Removal History — only when removed file uploaded and this agent has history */}
              {ag.wasRemoved && ag.removalHistory && (
                <div className="px-4 py-3" style={{ borderBottom: "1px solid #3d2057", background: ag.previouslyInProd ? "#3d152511" : "#27133A" }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: ag.previouslyInProd ? "#FF7866" : "#8F68D3" }}>
                      ↩ Removal History
                    </div>
                    <span className="text-xs" style={{ color: "#7a5f9a" }}>
                      {ag.removalCount}× in last 180d{ag.previouslyInProd ? " · prior prod" : ""}
                    </span>
                  </div>
                  {ag.removedTodayInProd && (
                    <div className="text-xs mb-2 px-2 py-1 rounded" style={{ background: "#3d3000", color: "#FFE566", border: "1px solid #FFE566" }}>
                      ⚠ Data conflict: marked as removed today AND active in production today.
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {ag.removalHistory.map((h, i) => (
                      <div key={`${h.date}-${i}`} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#7a5f9a" }}>{h.date}</span>
                          <span style={{
                            color: h.category === "performance" ? "#FF7866"
                              : h.category === "stale" ? "#FFE566"
                              : h.category === "voluntary" ? "#b8a5d4"
                              : h.category === "ops" ? "#8F68D3"
                              : "#E8DFF6",
                            fontWeight: 600,
                          }}>{h.reason}</span>
                        </div>
                        <span style={{ color: "#5c3d7a", fontSize: 10 }}>
                          {h.daysAgo}d ago{h.campaign && /bilingual/i.test(h.campaign) ? " · BI" : h.campaign && /nations/i.test(h.campaign) ? " · ENG" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Production agent detail */}
              {ag.isProd && (
                <div className="px-4 py-3" style={{ borderBottom: "1px solid #3d2057" }}>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#7a5f9a" }}>Production Agent Details</div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span style={{ color: "#7a5f9a" }}>Status</span>
                      <span style={{ color: "#E8DFF6" }}>{ag.status}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "#7a5f9a" }}>Certification Progress</span>
                      <span className="font-bold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: ag.certPct === 100 ? "#4ade80" : "#FFE566" }}>{ag.certPct}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "#7a5f9a" }}>BG Check</span>
                      <span style={{ color: ag.bgStatus === "cleared" ? "#4ade80" : "#FFE566" }}>{ag.bgStatus || "unknown"}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Pipeline agent sections */}
              {!ag.isProd && <>
              {/* Quick status row — BG, Credentials, Last Change */}
              <div className="grid grid-cols-3 gap-0" style={{ borderBottom: "1px solid #3d2057" }}>
                <div className="px-3 py-2.5 text-center" style={{ borderRight: "1px solid #3d2057" }}>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#7a5f9a", fontSize: 10 }}>BG Check</div>
                  <div className="text-base font-black" style={{ color: ag.bgCleared ? "#4ade80" : ag.bgStatus ? "#FFE566" : "#7a5f9a" }}>
                    {ag.bgCleared ? "✓" : ag.bgStatus ? "⏳" : "—"}
                  </div>
                  <div className="text-xs" style={{ color: ag.bgCleared ? "#4ade80" : "#FFE566", fontSize: 10 }}>
                    {ag.bgStatus || "unknown"}
                  </div>
                </div>
                <div className="px-3 py-2.5 text-center" style={{ borderRight: "1px solid #3d2057" }}>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#7a5f9a", fontSize: 10 }}>Credentials</div>
                  <div className="text-base font-black" style={{ color: ag.inLitmos ? "#4ade80" : "#FF7866" }}>
                    {ag.inLitmos ? "✓" : "✗"}
                  </div>
                  <div className="text-xs" style={{ color: ag.inLitmos ? "#4ade80" : "#FF7866", fontSize: 10 }}>
                    {ag.inLitmos ? "In Litmos" : "No creds"}
                  </div>
                </div>
                <div className="px-3 py-2.5 text-center">
                  <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#7a5f9a", fontSize: 10 }}>Last Change</div>
                  <div className="text-sm font-black" style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: ag.daysSinceChange !== null && ag.daysSinceChange >= 21 ? "#FF7866" : "#E8DFF6",
                  }}>
                    {ag.lastChangedRaw ? new Date(ag.lastChangedRaw).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  </div>
                  {ag.daysSinceChange !== null && (
                    <div className="text-xs" style={{ color: ag.daysSinceChange >= 21 ? "#FF7866" : "#7a5f9a", fontSize: 10 }}>
                      {ag.daysSinceChange}d ago{ag.daysSinceChange >= 21 ? " ⚠" : ""}
                    </div>
                  )}
                </div>
              </div>

              {/* ShyftOff Courses — two phases */}
              <div className="px-4 py-3" style={{ borderBottom: "1px solid #3d2057" }}>
                <div className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color: "#7a5f9a" }}>
                  <span>Phase 1 — Roster</span>
                  {ag.rosterCoursesDone && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#1a4d2e", color: "#4ade80", fontSize: 10 }}>COMPLETE</span>}
                </div>
                {ROSTER_COURSES.map((course, i) => {
                  const pct = ag.courseMap[course] || 0;
                  const done = pct >= 100;
                  return (
                    <div key={i} className="flex items-center gap-2 mb-1.5">
                      <div className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold"
                        style={{ background: done ? "#1a4d2e" : "#3d2057", color: done ? "#4ade80" : pct > 0 ? "#FFE566" : "#5c3d7a" }}>
                        {done ? "✓" : pct > 0 ? "◔" : "○"}
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-semibold" style={{ color: done ? "#E8DFF6" : "#b8a5d4" }}>{course}</div>
                        <div className="text-xs" style={{ color: done ? "#4ade80" : pct > 0 ? "#FFE566" : "#5c3d7a" }}>
                          {done ? "Complete" : pct > 0 ? `${pct}% in progress` : "Not started"}
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="text-xs font-semibold uppercase tracking-wider mb-2 mt-3 flex items-center gap-2" style={{ color: "#7a5f9a" }}>
                  <span>Phase 2 — Nesting</span>
                  {!ag.inLitmos && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#3d2057", color: "#7a5f9a", fontSize: 10 }}>LOCKED</span>}
                  {ag.inLitmos && ag.nestingCoursesDone && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#1a4d2e", color: "#4ade80", fontSize: 10 }}>COMPLETE</span>}
                </div>
                {NESTING_COURSES.map((course, i) => {
                  const pct = ag.courseMap[course] || 0;
                  const done = pct >= 100;
                  const locked = !ag.inLitmos;
                  const isPreProd = course === NESTING_COURSES[0];
                  return (
                    <div key={i} className="flex items-center gap-2 mb-1.5" style={{ opacity: locked ? 0.5 : 1 }}>
                      <div className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold"
                        style={{ background: done ? "#1a4d2e" : "#3d2057", color: done ? "#4ade80" : locked ? "#5c3d7a" : pct > 0 ? "#FFE566" : "#5c3d7a" }}>
                        {locked ? "🔒" : done ? "✓" : pct > 0 ? "◔" : "○"}
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-semibold" style={{ color: done ? "#E8DFF6" : "#b8a5d4" }}>
                          {course}{isPreProd && <span style={{ color: "#7a5f9a", fontWeight: 400 }}> (includes FL Blue)</span>}
                        </div>
                        <div className="text-xs" style={{ color: locked ? "#5c3d7a" : done ? "#4ade80" : pct > 0 ? "#FFE566" : "#5c3d7a" }}>
                          {locked ? "Requires credentials" : done ? "Complete" : pct > 0 ? `${pct}% in progress` : "Not started"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Litmos Courses */}
              <div className="px-4 py-3" style={{ borderBottom: "1px solid #3d2057" }}>
                <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#7a5f9a" }}>
                  Litmos Courses ({ag.litmosCount}/14)
                </div>
                <div className="space-y-1">
                  {ag.litmosDone.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <div className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold"
                        style={{ background: c.completed ? "#1a4d2e" : "#3d1525", color: c.completed ? "#4ade80" : "#FF7866" }}>
                        {c.completed ? "✓" : "✗"}
                      </div>
                      <span className="flex-1" style={{ color: c.completed ? "#b8a5d4" : "#FF7866" }}>{c.name}</span>
                      {c.date && <span style={{ color: "#5c3d7a", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>{c.date.split(" ")[0]}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Pipeline Details */}
              <div className="px-4 py-3" style={{ borderBottom: "1px solid #3d2057" }}>
                <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#7a5f9a" }}>Pipeline Details</div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span style={{ color: "#7a5f9a" }}>CIP Status</span>
                    <span style={{ color: "#E8DFF6" }}>{ag.status}</span>
                  </div>
                  {ag.rowCampaign && (
                    <div className="flex justify-between">
                      <span style={{ color: "#7a5f9a" }}>Campaign (this row)</span>
                      <span style={{ color: "#E8DFF6" }}>{ag.rowCampaign}</span>
                    </div>
                  )}
                  {ag.prodCampaigns && ag.prodCampaigns.length > 0 && (
                    <div className="flex justify-between">
                      <span style={{ color: "#7a5f9a" }}>Already in Production for</span>
                      <span style={{ color: "#4ade80" }}>{ag.prodCampaigns.join(", ")}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span style={{ color: "#7a5f9a" }}>CCAAS ID</span>
                    <span style={{ color: ag.hasCcaas ? "#4ade80" : "#FFE566" }}>{ag.hasCcaas ? "Assigned" : "Not assigned"}</span>
                  </div>
                  {ag.nbEmail && (
                    <div className="flex justify-between">
                      <span style={{ color: "#7a5f9a" }}>NB Email</span>
                      <span style={{ color: "#b8a5d4", fontFamily: "'IBM Plex Mono', monospace" }}>{ag.nbEmail}</span>
                    </div>
                  )}
                  {ag.createdAtRaw && (
                    <div className="flex justify-between">
                      <span style={{ color: "#7a5f9a" }}>Created</span>
                      <span style={{ color: "#b8a5d4", fontFamily: "'IBM Plex Mono', monospace" }}>
                        {new Date(ag.createdAtRaw).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        {ag.daysSinceCreated !== null && <span style={{ color: "#5c3d7a" }}> ({ag.daysSinceCreated}d)</span>}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span style={{ color: "#7a5f9a" }}>Nav Meeting</span>
                    <span style={{ color: ag.navAttended ? "#4ade80" : !ag.navAvailable ? "#5c3d7a" : "#FF7866" }}>
                      {!ag.navAvailable ? "No data" : ag.navAttended ? "✓ Attended" : "✗ Not attended"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Anomaly alerts */}
              {(ag.isGhost || ag.isStaleWaiter || ag.isBgMismatch || ag.hasAccountIssue || ag.hasNameCollision) && (
                <div className="px-4 py-3 space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#7a5f9a" }}>Alerts</div>
                  {ag.isGhost && (
                    <div className="rounded px-2 py-1.5 text-xs" style={{ background: "#3d152533", border: "1px solid #4D1F3B", color: "#FF7866" }}>
                      In Nesting without credentials — shouldn't be in this status
                    </div>
                  )}
                  {ag.isStaleInQueue && (
                    <div className="rounded px-2 py-1.5 text-xs" style={{ background: "#794EC222", border: "1px solid #794EC2", color: "#8F68D3" }}>
                      Credentials were requested — in batch queue for {ag.daysSinceChange}d. Check if the batch has been processed.
                    </div>
                  )}
                  {ag.isTrulyStale && (
                    <div className="rounded px-2 py-1.5 text-xs" style={{ background: "#4D1F3B33", border: "1px solid #4D1F3B", color: "#FF7866" }}>
                      Waiting {ag.daysSinceChange}+ days with no credentials request — needs manual investigation.
                    </div>
                  )}
                  {ag.isBgMismatch && (
                    <div className="rounded px-2 py-1.5 text-xs" style={{ background: "#FFE56615", border: "1px solid #FFE566", color: "#FFE566" }}>
                      BG Mismatch: Roster shows "cleared" but CIP export shows process: {ag.cipBgProcess || "unknown"}, report: {ag.cipBgReport || "unknown"}. The CIP data is the source of truth — BG is not actually cleared.
                    </div>
                  )}
                  {ag.shyftoffStaleLevel && (
                    <div className="rounded px-2 py-1.5 text-xs" style={{ background: "#3d205722", border: "1px solid #3d2057", color: "#b8a5d4" }}>
                      ShyftOff flagged: {ag.shyftoffStaleLevel}
                    </div>
                  )}
                  {ag.hasAccountIssue && (
                    <div className="rounded px-2 py-1.5 text-xs" style={{ background: "#4D1F3B33", border: "1px solid #4D1F3B", color: "#FFE566" }}>
                      BG check: {ag.bgStatus} — blocking progress
                    </div>
                  )}
                  {ag.hasNameCollision && (
                    <div className="rounded px-2 py-1.5 text-xs" style={{ background: "#3d205722", border: "1px solid #794EC2", color: "#FF66C4" }}>
                      ⚠ Name Collision — multiple Litmos accounts share this name. Verify manually before credentialing.
                      {ag.collidingUsernames && ag.collidingUsernames.length > 0 && (
                        <div className="mt-1" style={{ color: "#b8a5d4", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>
                          Existing: {ag.collidingUsernames.join(", ")}
                        </div>
                      )}
                      <div className="mt-1" style={{ color: "#7a5f9a", fontSize: 10 }}>
                        Tool cannot auto-match when multiple Litmos accounts share a name. Check ShyftOff/Litmos directly to see if this is a new person or one of the existing accounts.
                      </div>
                    </div>
                  )}
                </div>
              )}
              </>}
            </div>
          </>
        );
      })()}

      {showEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setShowEmail(false)}>
          <div className="w-full max-w-2xl mx-4 rounded-xl overflow-hidden" style={{ background: "#1a0d2e", border: "1px solid #3d2057" }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid #3d2057" }}>
              <div className="font-bold text-sm">Pipeline Update Email</div>
              <button onClick={() => setShowEmail(false)} className="text-lg" style={{ color: "#7a5f9a" }}>&times;</button>
            </div>
            <div className="px-5 py-3 space-y-2 text-xs" style={{ borderBottom: "1px solid #3d2057" }}>
              <div><span style={{ color: "#7a5f9a" }}>To: </span><span style={{ color: "#E8DFF6" }}>jaydencole@shyftoff.com</span></div>
              <div><span style={{ color: "#7a5f9a" }}>CC: </span><span style={{ color: "#E8DFF6" }}>davidmorales@shyftoff.com, ericyost@shyftoff.com</span></div>
              <div><span style={{ color: "#7a5f9a" }}>Subject: </span><span style={{ color: "#E8DFF6" }}>{emailSubject}</span></div>
            </div>
            <div className="px-5 py-4 overflow-y-auto" style={{ maxHeight: "50vh" }}>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: "#d4c6eb", fontFamily: "'IBM Plex Sans', sans-serif" }}>{emailBody}</pre>
            </div>
            <div className="flex gap-2 px-5 py-3" style={{ borderTop: "1px solid #3d2057" }}>
              <button onClick={handleCopyEmail} className="px-4 py-2 rounded-lg text-xs font-semibold transition-all hover:brightness-110" style={{ background: "#3d2057", color: "#E8DFF6" }}>
                Copy to Clipboard
              </button>
              <button onClick={handleOpenMail} className="px-4 py-2 rounded-lg text-xs font-semibold transition-all hover:brightness-110" style={{ background: "#FF66C4", color: "#fff" }}>
                Open in Mail Client
              </button>
              <button onClick={() => setShowEmail(false)} className="ml-auto px-4 py-2 rounded-lg text-xs font-semibold transition-all" style={{ color: "#7a5f9a" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
