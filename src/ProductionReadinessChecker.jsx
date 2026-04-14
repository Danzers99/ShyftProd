import { useState, useMemo, useCallback, useRef } from "react";

const REQUIRED_LITMOS = [
  "Anti-money Laundering Awareness 4.0 (US)",
  "Cyber Security Overview 2.0",
  "HIPAA Privacy and Security Basics 5.0 (US)",
  "Health Risk Assessments (HRAs)",
  "Identity Theft Training 2026",
  "Information Security Basics 3.0",
  "Leading Learning - Payment Card Industry Data Security Standards (PCI-DSS) 2.0",
  "Medicare Parts C & D - Combating Fraud, Waste & Abuse 2026",
  "Medicare Parts C & D - Cultural Competency 2026",
  "Medicare Parts C & D - General Compliance 2026",
  "Nations of the Stars - Journey into 2026",
  "Sexual Harassment Prevention 3.0 (US)",
  "Triple-S Introduction",
  "UDAAP Training 2026",
];

const SHORT_LITMOS = [
  "AML 4.0","Cyber Sec","HIPAA","HRAs","ID Theft","Info Sec","PCI-DSS",
  "FWA","Cultural","Compliance","Stars","Sexual Harass","Triple-S","UDAAP"
];

const SHYFTOFF_COURSES = [
  "Nations Benefits Certification",
  "Nations Benefits Pre-Production",
  "Nations Benefits Navigation Meeting Self-Guided",
  "Nations-fiblue2026",
];

function parseCSV(text) {
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
  const headers = rows[0].map(h => h.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).filter(r => r.some(c => c.trim())).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] || "").trim(); });
    return obj;
  });
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, "").trim();
}

function nameKey(first, last) {
  return `${normalize(first)}|${normalize(last)}`;
}

function nameParts(fullName) {
  const p = (fullName || "").trim().split(/\s+/);
  return { first: p[0] || "", last: p[p.length - 1] || "" };
}

function candidateEmails(fullName) {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [];
  const domain = "nationsbenefits.com";
  const emails = new Set();
  const last = parts[parts.length - 1];
  // Standard: First.Last
  emails.add(`${parts[0]}.${last}@${domain}`.toLowerCase());
  // All parts joined as first: FirstMiddle.Last (e.g., "Sid Toria Melton" -> "SidToria.Melton")
  if (parts.length > 2) {
    const allButLast = parts.slice(0, -1).join("");
    emails.add(`${allButLast}.${last}@${domain}`.toLowerCase());
    // First.MiddleLast (e.g., "Jasmine Reid Lavonda" -> "Jasmine.ReidLavonda")
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

function parseCertProgress(raw) {
  if (!raw || raw === "") return { pct: null, map: {} };
  // New dashboard format: plain integer 0-100
  const asNum = Number(raw);
  if (!isNaN(asNum) && raw.trim().match(/^\d+$/)) {
    return { pct: asNum, map: {} };
  }
  // Old CIP format: JSON array with per-course progress
  try {
    const arr = JSON.parse(raw.replace(/""/g, '"'));
    const map = {};
    arr.forEach(item => {
      map[item.course_code] = parseFloat(item.progress) || 0;
    });
    const values = Object.values(map);
    const pct = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) : 0;
    return { pct, map };
  } catch { return { pct: null, map: {} }; }
}

function FileUpload({ label, sublabel, onFiles, multiple, files }) {
  const ref = useRef();
  return (
    <div
      className="relative border border-dashed rounded-lg p-3 cursor-pointer transition-all hover:border-sky-400 hover:bg-sky-950/20"
      style={{ borderColor: files?.length ? "#22c55e" : "#334155" }}
      onClick={() => ref.current?.click()}
    >
      <input ref={ref} type="file" accept=".csv" multiple={multiple}
        className="hidden" onChange={e => onFiles(Array.from(e.target.files))} />
      <div className="text-sm font-semibold" style={{ color: files?.length ? "#4ade80" : "#94a3b8" }}>{label}</div>
      <div className="text-xs mt-0.5" style={{ color: "#64748b" }}>{sublabel}</div>
      {files?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {files.map((f, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#064e3b", color: "#6ee7b7" }}>
              {f.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ type }) {
  const styles = {
    ready: { bg: "#064e3b", color: "#4ade80", text: "READY" },
    partial: { bg: "#78350f", color: "#fbbf24", text: "IN PROGRESS" },
    missing: { bg: "#7f1d1d", color: "#f87171", text: "NOT STARTED" },
  };
  const s = styles[type] || styles.missing;
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>
      {s.text}
    </span>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
      <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#64748b" }}>{label}</div>
      <div className="text-3xl font-black" style={{ color }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "#94a3b8" }}>{sub}</div>}
    </div>
  );
}

function CourseDot({ done, title }) {
  return (
    <div title={title} className="w-3 h-3 rounded-sm flex-shrink-0"
      style={{ background: done ? "#22c55e" : "#dc2626", opacity: done ? 1 : 0.6 }} />
  );
}

export default function ProductionReadinessChecker() {
  const [litmosFiles, setLitmosFiles] = useState([]);
  const [cipFiles, setCipFiles] = useState([]);
  const [prodFiles, setProdFiles] = useState([]);
  const [navFiles, setNavFiles] = useState([]);
  const [peopleFiles, setPeopleFiles] = useState([]);
  const [litmosData, setLitmosData] = useState(null);
  const [cipData, setCipData] = useState(null);
  const [prodData, setProdData] = useState(null);
  const [navData, setNavData] = useState(null);
  const [peopleData, setPeopleData] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expandedRow, setExpandedRow] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");

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
      const [litRows, cipRows, prodRows, navRows, pplRows] = await Promise.all([
        litmosFiles.length ? readFiles(litmosFiles) : Promise.resolve([]),
        cipFiles.length ? readFiles(cipFiles) : Promise.resolve([]),
        prodFiles.length ? readFiles(prodFiles) : Promise.resolve([]),
        navFiles.length ? readFiles(navFiles) : Promise.resolve([]),
        peopleFiles.length ? readFiles(peopleFiles) : Promise.resolve([]),
      ]);
      setLitmosData(litRows);
      setCipData(cipRows);
      setProdData(prodRows);
      setNavData(navRows);
      setPeopleData(pplRows);
    } catch (e) { console.error(e); }
    setProcessing(false);
  }, [litmosFiles, cipFiles, prodFiles, navFiles, peopleFiles]);

  const results = useMemo(() => {
    if (!litmosData || !cipData) return null;

    const prodKeys = new Set();
    const prodSids = new Set();
    (prodData || []).forEach(r => {
      const nm = (r.agent_nm || r.agent_name || "").trim();
      const sid = (r.shyftoff_id || "").trim().toUpperCase();
      if (sid) prodSids.add(sid);
      const { first, last } = nameParts(nm);
      prodKeys.add(nameKey(first, last));
      const pp = nm.split(/\s+/).filter(Boolean);
      if (pp.length > 2) {
        prodKeys.add(nameKey(pp.slice(0, -1).join(""), pp[pp.length - 1]));
      }
    });

    // People Report: who has a Litmos account (= has credentials)
    const litmosPeopleEmails = new Set();
    const litmosPeopleNames = new Set();
    (peopleData || []).forEach(r => {
      const email = (r["People.Username"] || "").toLowerCase().trim();
      if (email) litmosPeopleEmails.add(email);
      const first = r["People.First Name"] || "";
      const last = r["People.Last Name"] || "";
      if (first || last) litmosPeopleNames.add(nameKey(first, last));
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

    const navKeys = new Set();
    (navData || []).forEach(r => {
      const vals = Object.values(r).map(v => (v || "").toLowerCase());
      const name = r["Name"] || r["name"] || r["Agent Name"] || r["agent_name"] || r["Full Name"] || r["full_name"] || "";
      if (name) {
        const { first, last } = nameParts(name);
        navKeys.add(nameKey(first, last));
      }
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

    const agents = [];
    cipData.forEach(row => {
      const name = (row.agent_nm || row.agent_name || "").trim();
      const sid = (row.shyftoff_id || "").trim();
      const status = (row.status || "").trim();
      const { first, last } = nameParts(name);
      const key = nameKey(first, last);
      const parts = name.split(/\s+/).filter(Boolean);

      // Exclude production agents (by name key or ShyftOff ID)
      if (prodKeys.has(key) || prodSids.has(sid.toUpperCase())) return;

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

      const navAttended = navKeys.has(key) || (ldata?.email && navKeys.has(ldata.email.toLowerCase()));

      // New fields for anomaly detection
      const hasCcaas = !!(row.ccaas_id || "").trim();
      // Check if agent has a Litmos account (= has credentials)
      // Use People Report if available (definitive), otherwise fall back to Course Data presence
      let inLitmos;
      if (hasPeopleReport) {
        const candidateEm = candidateEmails(name);
        inLitmos = litmosPeopleNames.has(key) || candidateEm.some(e => litmosPeopleEmails.has(e));
        // Also try multi-part name keys
        if (!inLitmos && parts.length > 2) {
          inLitmos = litmosPeopleNames.has(nameKey(parts.slice(0, -1).join(""), last))
            || litmosPeopleNames.has(nameKey(first, parts.slice(1).join("")));
        }
      } else {
        inLitmos = ldata !== null;
      }
      const bgStatus = (row.background_check_status || "").trim().toLowerCase();
      const bgCleared = bgStatus === "cleared";
      const createdAt = row.created_at ? new Date(row.created_at) : null;
      const lastChanged = row.last_changed || row.status_updated_at || "";
      const changedAt = lastChanged ? new Date(lastChanged) : null;
      const isNesting = status.toLowerCase().includes("nesting");
      const isRoster = status.toLowerCase().includes("roster");

      // Days since status last changed
      const now = new Date();
      const daysSinceChange = changedAt ? Math.floor((now - changedAt) / 86400000) : null;
      const daysSinceCreated = createdAt ? Math.floor((now - createdAt) / 86400000) : null;

      // Anomaly flags
      // Ghost = in Nesting but not in Litmos (no credentials — Litmos presence = has credentials)
      const isGhost = isNesting && !inLitmos;
      // Missing CCAAS = needs ccaas_id assigned before moving to production
      const missingCcaas = !hasCcaas;
      // Waiting for creds = everything done, BG cleared, just needs to be credentialed
      const isWaitingForCreds = !inLitmos && bgCleared && shyftoffComplete;
      const isStaleWaiter = isWaitingForCreds && daysSinceChange !== null && daysSinceChange >= 21;
      const hasAccountIssue = !bgCleared && bgStatus !== "";

      const allLitmos = litmosCount === 14;
      const navMet = navAttended || !(navData && navData.length > 0);
      const readyStatus = allLitmos && shyftoffComplete && navMet ? "ready"
        : (litmosCount > 0 || (shyftoffPct !== null && shyftoffPct > 0)) ? "partial" : "missing";

      agents.push({
        name, sid, status, key,
        nbEmail: ldata?.email || "",
        litmosCount, litmosDone, litmosTotal: 14,
        shyftoffPct, shyftoffComplete,
        navAttended, navAvailable: navData && navData.length > 0,
        readyStatus, allLitmos,
        inLitmos, hasCcaas, missingCcaas, bgStatus, bgCleared,
        daysSinceChange, daysSinceCreated,
        isNesting, isRoster,
        isGhost, isWaitingForCreds, isStaleWaiter, hasAccountIssue,
      });
    });

    return agents;
  }, [litmosData, cipData, prodData, navData, peopleData]);

  const filtered = useMemo(() => {
    if (!results) return [];
    let out = results;
    if (filter === "ready") out = out.filter(a => a.readyStatus === "ready");
    if (filter === "partial") out = out.filter(a => a.readyStatus === "partial");
    if (filter === "missing") out = out.filter(a => a.readyStatus === "missing");
    if (filter === "litmos_done") out = out.filter(a => a.allLitmos);
    if (filter === "shyftoff_done") out = out.filter(a => a.shyftoffComplete);
    if (filter === "ghosts") out = out.filter(a => a.isGhost);
    if (filter === "waiting_creds") out = out.filter(a => a.isWaitingForCreds);
    if (filter === "stale") out = out.filter(a => a.isStaleWaiter);
    if (filter === "account_issues") out = out.filter(a => a.hasAccountIssue);
    if (search) {
      const s = search.toLowerCase();
      out = out.filter(a => a.name.toLowerCase().includes(s) || a.sid.toLowerCase().includes(s) || a.nbEmail.toLowerCase().includes(s));
    }
    return out;
  }, [results, filter, search]);

  const stats = useMemo(() => {
    if (!results) return null;
    return {
      total: results.length,
      ready: results.filter(a => a.readyStatus === "ready").length,
      litmosDone: results.filter(a => a.allLitmos).length,
      shyftoffDone: results.filter(a => a.shyftoffComplete).length,
      navAttended: results.filter(a => a.navAttended).length,
      navAvailable: results.length > 0 && results[0].navAvailable,
      ghosts: results.filter(a => a.isGhost).length,
      waitingForCreds: results.filter(a => a.isWaitingForCreds).length,
      staleWaiters: results.filter(a => a.isStaleWaiter).length,
      accountIssues: results.filter(a => a.hasAccountIssue).length,
    };
  }, [results]);

  const handleExport = () => {
    if (!filtered.length) return;
    const headers = ["Agent Name","ShyftOff ID","CIP Status","NB Email","Litmos (done/14)","ShyftOff Cert %","Nav Meeting","Readiness","In Litmos (Has Creds)","CCAAS ID","BG Check","Days Since Change","Flags"];
    const rows = filtered.map(a => {
      const flags = [];
      if (a.isGhost) flags.push("GHOST");
      if (a.isWaitingForCreds) flags.push("WAITING_CREDS");
      if (a.isStaleWaiter) flags.push("STALE");
      if (a.hasAccountIssue) flags.push("BG_ISSUE");
      return [
        a.name, a.sid, a.status, a.nbEmail,
        `${a.litmosCount}/14`,
        a.shyftoffPct !== null ? `${a.shyftoffPct}%` : "N/A",
        a.navAvailable ? (a.navAttended ? "YES" : "NO") : "N/A",
        a.readyStatus.toUpperCase(),
        a.inLitmos ? "YES" : "NO",
        a.hasCcaas ? "YES" : "NO",
        a.bgStatus || "unknown",
        a.daysSinceChange !== null ? `${a.daysSinceChange}` : "N/A",
        flags.join("; ") || "",
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "production_readiness_report.csv";
    link.click();
  };

  const hasData = results !== null;

  return (
    <div className="min-h-screen" style={{ background: "#020617", color: "#e2e8f0", fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet" />

      <div className="border-b" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm" style={{ background: "#0ea5e9", color: "#020617" }}>NB</div>
            <div>
              <div className="font-bold text-sm tracking-tight">Production Readiness Checker</div>
              <div className="text-xs" style={{ color: "#64748b" }}>NationsBenefits Agent Pipeline</div>
            </div>
          </div>
          {hasData && (
            <div className="flex gap-1">
              {[{k:"dashboard",l:"Dashboard"},{k:"insights",l:"Pipeline Insights"},{k:"details",l:"Detail View"}].map(tab => (
                <button key={tab.k} onClick={() => setActiveTab(tab.k)}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
                  style={{ background: activeTab === tab.k ? "#0ea5e9" : "transparent", color: activeTab === tab.k ? "#020617" : "#94a3b8" }}>
                  {tab.l}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="grid grid-cols-5 gap-3 mb-4">
          <FileUpload label="Litmos Course Data" sublabel="Required — CSV with course completions" onFiles={f => setLitmosFiles(f)} multiple files={litmosFiles} />
          <FileUpload label="Litmos People Report" sublabel="Required — Who has a Litmos account" onFiles={f => setPeopleFiles(f)} multiple={false} files={peopleFiles} />
          <FileUpload label="Nesting / CIP Export" sublabel="Required — Dashboard or CIP agent export" onFiles={f => setCipFiles(f)} multiple files={cipFiles} />
          <FileUpload label="Production Exports" sublabel="Optional — Exclude current prod agents" onFiles={f => setProdFiles(f)} multiple files={prodFiles} />
          <FileUpload label="Nav Meeting Tracker" sublabel="Optional — CSV with Name/Email columns" onFiles={f => setNavFiles(f)} multiple={false} files={navFiles} />
        </div>

        <div className="flex gap-2 mb-5">
          <button onClick={handleProcess}
            disabled={!litmosFiles.length || !cipFiles.length || processing}
            className="px-5 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-30"
            style={{ background: "#0ea5e9", color: "#020617" }}>
            {processing ? "Processing..." : "Analyze Readiness"}
          </button>
          {hasData && (
            <button onClick={handleExport} className="px-4 py-2 rounded-lg text-sm font-semibold border transition-all hover:bg-slate-800" style={{ borderColor: "#334155", color: "#94a3b8" }}>
              Export CSV
            </button>
          )}
        </div>

        {hasData && stats && (
          <>
            <div className="grid grid-cols-5 gap-3 mb-5">
              <StatCard label="Pipeline Total" value={stats.total} sub="Agents in pipeline (excl. production)" color="#e2e8f0" />
              <StatCard label="Production Ready" value={stats.ready} sub="All 3 pillars complete" color="#4ade80" />
              <StatCard label="Litmos Complete" value={stats.litmosDone} sub="14/14 required courses" color="#38bdf8" />
              <StatCard label="ShyftOff Cert" value={stats.shyftoffDone} sub="100% certification progress" color="#a78bfa" />
              <StatCard label="Nav Meeting" value={stats.navAttended} sub={stats.navAvailable ? "Confirmed attended" : "No data uploaded"} color={stats.navAvailable ? "#f59e0b" : "#475569"} />
            </div>

            {activeTab === "insights" && (
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="rounded-xl p-4" style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#64748b" }}>Status Anomalies</div>
                  <div className="space-y-3">
                    <button onClick={() => { setFilter("ghosts"); setActiveTab("dashboard"); }} className="w-full text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: "#7f1d1d22", border: "1px solid #7f1d1d" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold" style={{ color: "#f87171" }}>Nesting Without Credentials</span>
                        <span className="text-2xl font-black" style={{ color: "#f87171" }}>{stats.ghosts}</span>
                      </div>
                      <div className="text-xs" style={{ color: "#94a3b8" }}>
                        Agents in "Nesting" but not in Litmos — no credentials. If they've completed NB Certification + BG cleared, they need to be credentialed first.
                      </div>
                    </button>
                    <button onClick={() => { setFilter("account_issues"); setActiveTab("dashboard"); }} className="w-full text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: "#78350f22", border: "1px solid #78350f" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold" style={{ color: "#fbbf24" }}>Account Issues</span>
                        <span className="text-2xl font-black" style={{ color: "#fbbf24" }}>{stats.accountIssues}</span>
                      </div>
                      <div className="text-xs" style={{ color: "#94a3b8" }}>
                        Background check not cleared (status: pending or created). These agents are blocked from progressing.
                      </div>
                    </button>
                  </div>
                </div>
                <div className="rounded-xl p-4" style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#64748b" }}>Credential Queue</div>
                  <div className="space-y-3">
                    <button onClick={() => { setFilter("waiting_creds"); setActiveTab("dashboard"); }} className="w-full text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: "#0ea5e922", border: "1px solid #0c4a6e" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold" style={{ color: "#38bdf8" }}>Waiting for Credentials</span>
                        <span className="text-2xl font-black" style={{ color: "#38bdf8" }}>{stats.waitingForCreds}</span>
                      </div>
                      <div className="text-xs" style={{ color: "#94a3b8" }}>
                        NB Certification 100% + BG check cleared but not yet in Litmos — should be added to the credentials list.
                      </div>
                    </button>
                    <button onClick={() => { setFilter("stale"); setActiveTab("dashboard"); }} className="w-full text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: "#7f1d1d22", border: "1px solid #7f1d1d" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold" style={{ color: "#fb923c" }}>Stale (3+ Weeks)</span>
                        <span className="text-2xl font-black" style={{ color: "#fb923c" }}>{stats.staleWaiters}</span>
                      </div>
                      <div className="text-xs" style={{ color: "#94a3b8" }}>
                        NB Cert done + BG cleared but still not credentialed after 3+ weeks — usually means something is wrong with their account.
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 mb-3">
              <input type="text" placeholder="Search by name, ID, or email..."
                value={search} onChange={e => setSearch(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "#0f172a", border: "1px solid #1e293b", color: "#e2e8f0" }} />
              <div className="flex gap-1">
                {[
                  { key: "all", label: "All" },
                  { key: "ready", label: "Ready" },
                  { key: "litmos_done", label: "Litmos ✓" },
                  { key: "shyftoff_done", label: "ShyftOff ✓" },
                  { key: "partial", label: "In Progress" },
                  { key: "missing", label: "Not Started" },
                  { key: "ghosts", label: "Ghosts" },
                  { key: "waiting_creds", label: "Waiting Creds" },
                  { key: "account_issues", label: "BG Issues" },
                ].map(f => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
                    style={{ background: filter === f.key ? "#1e293b" : "transparent", color: filter === f.key ? "#e2e8f0" : "#64748b" }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #1e293b" }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#0f172a" }}>
                      <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#64748b" }}>Agent</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#64748b" }}>CIP Status</th>
                      <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#64748b" }}>Litmos</th>
                      {activeTab === "details" && SHORT_LITMOS.map((s, i) => (
                        <th key={i} className="text-center px-1 py-2.5 font-semibold text-xs" style={{ color: "#475569", maxWidth: 40 }} title={REQUIRED_LITMOS[i]}>{s}</th>
                      ))}
                      <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#64748b" }}>ShyftOff Cert</th>
                      <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#64748b" }}>Nav Meeting</th>
                      <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#64748b" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={99} className="text-center py-8" style={{ color: "#475569" }}>No agents match current filters</td></tr>
                    ) : filtered.map((a, idx) => (
                      <tr key={a.key + idx}
                        className="cursor-pointer transition-all"
                        style={{ background: idx % 2 === 0 ? "#020617" : "#0f172a", borderBottom: "1px solid #0f172a" }}
                        onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
                        onMouseEnter={e => e.currentTarget.style.background = "#1e293b"}
                        onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? "#020617" : "#0f172a"}>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold">{a.name}</div>
                          <div className="text-xs" style={{ color: "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>{a.sid}</div>
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {a.isGhost && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#7f1d1d", color: "#fca5a5", fontSize: 10 }}>NOT IN LITMOS</span>}
                            {a.hasAccountIssue && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#78350f", color: "#fcd34d", fontSize: 10 }}>BG: {a.bgStatus}</span>}
                            {a.isStaleWaiter && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#7c2d12", color: "#fdba74", fontSize: 10 }}>STALE {a.daysSinceChange}d</span>}
                            {a.isWaitingForCreds && !a.isStaleWaiter && <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#0c4a6e", color: "#7dd3fc", fontSize: 10 }}>AWAITING CREDS</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: "#94a3b8" }}>{a.status}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="font-bold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: a.allLitmos ? "#4ade80" : a.litmosCount > 0 ? "#fbbf24" : "#f87171" }}>
                            {a.litmosCount}/14
                          </span>
                        </td>
                        {activeTab === "details" && a.litmosDone.map((c, ci) => (
                          <td key={ci} className="px-1 py-2.5 text-center">
                            <CourseDot done={c.completed} title={c.name} />
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-center">
                          {a.shyftoffPct !== null ? (
                            <span className="font-bold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: a.shyftoffComplete ? "#4ade80" : a.shyftoffPct > 0 ? "#fbbf24" : "#f87171" }}>
                              {a.shyftoffPct}%
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: "#475569" }}>N/A</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {!a.navAvailable
                            ? <span className="text-xs" style={{ color: "#475569" }}>N/A</span>
                            : a.navAttended
                              ? <span style={{ color: "#4ade80" }}>✓</span>
                              : <span style={{ color: "#f87171" }}>✗</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 text-center"><Badge type={a.readyStatus} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {expandedRow !== null && filtered[expandedRow] && (
              <div className="mt-3 rounded-xl p-4" style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
                <div className="font-bold mb-3">{filtered[expandedRow].name} — Detail Breakdown</div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#64748b" }}>
                      Litmos Courses ({filtered[expandedRow].litmosCount}/14)
                    </div>
                    <div className="space-y-1">
                      {filtered[expandedRow].litmosDone.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <div className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold"
                            style={{ background: c.completed ? "#064e3b" : "#7f1d1d", color: c.completed ? "#4ade80" : "#f87171" }}>
                            {c.completed ? "✓" : "✗"}
                          </div>
                          <span style={{ color: c.completed ? "#94a3b8" : "#f87171" }}>{c.name}</span>
                          {c.date && <span style={{ color: "#475569", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>{c.date.split(" ")[0]}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#64748b" }}>
                      ShyftOff Certification
                    </div>
                    {filtered[expandedRow].shyftoffPct !== null ? (
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "#1e293b" }}>
                            <div className="h-full rounded-full transition-all" style={{
                              width: `${filtered[expandedRow].shyftoffPct}%`,
                              background: filtered[expandedRow].shyftoffComplete ? "#22c55e" : filtered[expandedRow].shyftoffPct > 0 ? "#eab308" : "#ef4444",
                            }} />
                          </div>
                          <span className="font-bold text-sm" style={{
                            fontFamily: "'IBM Plex Mono', monospace",
                            color: filtered[expandedRow].shyftoffComplete ? "#4ade80" : filtered[expandedRow].shyftoffPct > 0 ? "#fbbf24" : "#f87171",
                          }}>
                            {filtered[expandedRow].shyftoffPct}%
                          </span>
                        </div>
                        <div className="text-xs" style={{ color: "#64748b" }}>
                          Required courses: {SHYFTOFF_COURSES.join(", ")}
                        </div>
                        <div className="text-xs mt-1" style={{ color: filtered[expandedRow].shyftoffComplete ? "#4ade80" : "#fbbf24" }}>
                          {filtered[expandedRow].shyftoffComplete ? "✓ All certification courses completed" : "In progress — 100% required for production readiness"}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs" style={{ color: "#475569" }}>No certification data available</div>
                    )}
                    <div className="mt-3 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#64748b" }}>
                      Navigation Meeting
                    </div>
                    <div className="text-xs" style={{ color: filtered[expandedRow].navAttended ? "#4ade80" : "#f87171" }}>
                      {!filtered[expandedRow].navAvailable ? "No nav meeting data uploaded" : filtered[expandedRow].navAttended ? "✓ Attended" : "✗ Not found in attendance list"}
                    </div>
                    <div className="mt-3 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#64748b" }}>
                      Pipeline Status
                    </div>
                    <div className="space-y-1 text-xs">
                      <div>
                        <span style={{ color: "#64748b" }}>Has Credentials (in Litmos): </span>
                        <span style={{ color: filtered[expandedRow].inLitmos ? "#4ade80" : "#f87171" }}>
                          {filtered[expandedRow].inLitmos ? "Yes" : "No"}
                        </span>
                      </div>
                      <div>
                        <span style={{ color: "#64748b" }}>CCAAS ID: </span>
                        <span style={{ color: filtered[expandedRow].hasCcaas ? "#4ade80" : "#fbbf24" }}>
                          {filtered[expandedRow].hasCcaas ? "Assigned" : "Not assigned"}
                        </span>
                      </div>
                      <div>
                        <span style={{ color: "#64748b" }}>Background Check: </span>
                        <span style={{ color: filtered[expandedRow].bgCleared ? "#4ade80" : "#fbbf24" }}>
                          {filtered[expandedRow].bgStatus || "unknown"}
                        </span>
                      </div>
                      {filtered[expandedRow].daysSinceChange !== null && (
                        <div>
                          <span style={{ color: "#64748b" }}>Days since last status change: </span>
                          <span style={{ color: filtered[expandedRow].daysSinceChange >= 21 ? "#fb923c" : "#94a3b8" }}>
                            {filtered[expandedRow].daysSinceChange}d
                          </span>
                        </div>
                      )}
                      {(filtered[expandedRow].isGhost || filtered[expandedRow].isWaitingForCreds || filtered[expandedRow].hasAccountIssue) && (
                        <div className="mt-2 space-y-1">
                          {filtered[expandedRow].isGhost && (
                            <div className="rounded px-2 py-1" style={{ background: "#7f1d1d33", border: "1px solid #7f1d1d" }}>
                              <span style={{ color: "#fca5a5" }}>In Nesting but not in Litmos — likely doesn't have credentials and shouldn't be in this status</span>
                            </div>
                          )}
                          {filtered[expandedRow].isStaleWaiter && (
                            <div className="rounded px-2 py-1" style={{ background: "#7c2d1233", border: "1px solid #7c2d12" }}>
                              <span style={{ color: "#fdba74" }}>Waiting {filtered[expandedRow].daysSinceChange}+ days for credentials — likely account issue</span>
                            </div>
                          )}
                          {filtered[expandedRow].hasAccountIssue && (
                            <div className="rounded px-2 py-1" style={{ background: "#78350f33", border: "1px solid #78350f" }}>
                              <span style={{ color: "#fcd34d" }}>Background check status: {filtered[expandedRow].bgStatus} — blocking progress</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-3 text-xs text-center" style={{ color: "#334155" }}>
              Showing {filtered.length} of {results.length} agents • Click any row for full breakdown
            </div>
          </>
        )}

        {!hasData && (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">📋</div>
            <div className="text-lg font-bold mb-1" style={{ color: "#94a3b8" }}>Upload your data to get started</div>
            <div className="text-sm" style={{ color: "#475569" }}>
              Drop in your Litmos export and CIP files, then hit Analyze.<br />
              Optionally add production exports to exclude and nav meeting data.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
