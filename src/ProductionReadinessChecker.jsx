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
  "NRTC Foundations 2.0",
  "NRTC Pre-Production 2.0",
  "NRTC - CPNI 2026 Recertification",
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
  try {
    const arr = JSON.parse(raw.replace(/""/g, '"'));
    const map = {};
    arr.forEach(item => {
      map[item.course_code] = parseFloat(item.progress) || 0;
    });
    return map;
  } catch { return {}; }
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
  const [litmosData, setLitmosData] = useState(null);
  const [cipData, setCipData] = useState(null);
  const [prodData, setProdData] = useState(null);
  const [navData, setNavData] = useState(null);
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
      const [litRows, cipRows, prodRows, navRows] = await Promise.all([
        litmosFiles.length ? readFiles(litmosFiles) : Promise.resolve([]),
        cipFiles.length ? readFiles(cipFiles) : Promise.resolve([]),
        prodFiles.length ? readFiles(prodFiles) : Promise.resolve([]),
        navFiles.length ? readFiles(navFiles) : Promise.resolve([]),
      ]);
      setLitmosData(litRows);
      setCipData(cipRows);
      setProdData(prodRows);
      setNavData(navRows);
    } catch (e) { console.error(e); }
    setProcessing(false);
  }, [litmosFiles, cipFiles, prodFiles, navFiles]);

  const results = useMemo(() => {
    if (!litmosData || !cipData) return null;

    const prodKeys = new Set();
    (prodData || []).forEach(r => {
      const nm = (r.agent_nm || "").trim();
      const { first, last } = nameParts(nm);
      prodKeys.add(nameKey(first, last));
      // Also add joined-name keys for multi-part names
      const pp = nm.split(/\s+/).filter(Boolean);
      if (pp.length > 2) {
        prodKeys.add(nameKey(pp.slice(0, -1).join(""), pp[pp.length - 1]));
      }
    });

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

    const agents = [];
    cipData.forEach(row => {
      const name = (row.agent_nm || "").trim();
      const sid = (row.shyftoff_id || "").trim();
      const status = (row.status || "").trim();
      const { first, last } = nameParts(name);
      const key = nameKey(first, last);

      if (prodKeys.has(key)) return;

      // Try matching: 1) exact name key, 2) alt name combos, 3) email-based
      let ldata = litmosMap[key] || null;

      // Try alternate first name (strip dots: "M.Cecilia" -> "Cecilia")
      if (!ldata && first.includes(".")) {
        const altFirst = first.split(".").pop();
        ldata = litmosMap[nameKey(altFirst, last)] || null;
      }

      // For 3+ part names, try joining all-but-last as first ("Sid Toria" -> "sidtoria")
      const parts = name.split(/\s+/).filter(Boolean);
      if (!ldata && parts.length > 2) {
        const joinedFirst = parts.slice(0, -1).join("");
        ldata = litmosMap[nameKey(joinedFirst, last)] || null;
        // Also try first + joined-rest as last ("Jasmine Reid Lavonda" -> "jasmine|reidlavonda")
        if (!ldata) {
          const joinedLast = parts.slice(1).join("");
          ldata = litmosMap[nameKey(first, joinedLast)] || null;
        }
      }

      // Email-based fallback: construct candidate emails and match against Litmos email index
      if (!ldata) {
        const candidates = candidateEmails(name);
        for (const email of candidates) {
          if (litmosEmailMap[email]) { ldata = litmosEmailMap[email]; break; }
        }
      }

      const litmosDone = REQUIRED_LITMOS.map(c => ({
        name: c,
        completed: ldata?.courses[c]?.completed || false,
        pct: ldata?.courses[c]?.pct || 0,
        date: ldata?.courses[c]?.date || "",
      }));
      const litmosCount = litmosDone.filter(c => c.completed).length;

      const certProg = parseCertProgress(row.certification_progress || "[]");
      const shyftoffDone = SHYFTOFF_COURSES.map(c => ({
        name: c,
        progress: certProg[c] ?? null,
        completed: (certProg[c] ?? 0) >= 1,
      }));
      const shyftoffCount = shyftoffDone.filter(c => c.completed).length;

      const navAttended = navKeys.has(key) || (ldata?.email && navKeys.has(ldata.email.toLowerCase()));

      const allLitmos = litmosCount === 14;
      const allShyftoff = shyftoffCount === SHYFTOFF_COURSES.length;
      const navMet = navAttended || !(navData && navData.length > 0);
      const readyStatus = allLitmos && navMet ? "ready"
        : litmosCount > 0 ? "partial" : "missing";

      agents.push({
        name, sid, status, key,
        nbEmail: ldata?.email || "",
        litmosCount, litmosDone, litmosTotal: 14,
        shyftoffCount, shyftoffDone, shyftoffTotal: SHYFTOFF_COURSES.length,
        navAttended, navAvailable: navData && navData.length > 0,
        readyStatus, allLitmos, allShyftoff,
      });
    });

    return agents;
  }, [litmosData, cipData, prodData, navData]);

  const filtered = useMemo(() => {
    if (!results) return [];
    let out = results;
    if (filter === "ready") out = out.filter(a => a.readyStatus === "ready");
    if (filter === "partial") out = out.filter(a => a.readyStatus === "partial");
    if (filter === "missing") out = out.filter(a => a.readyStatus === "missing");
    if (filter === "litmos_done") out = out.filter(a => a.allLitmos);
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
      navAttended: results.filter(a => a.navAttended).length,
      navAvailable: results.length > 0 && results[0].navAvailable,
    };
  }, [results]);

  const handleExport = () => {
    if (!filtered.length) return;
    const headers = ["Agent Name","ShyftOff ID","CIP Status","NB Email","Litmos (done/14)","ShyftOff Apps (done/"+SHYFTOFF_COURSES.length+")","Nav Meeting","Readiness"];
    const rows = filtered.map(a => [
      a.name, a.sid, a.status, a.nbEmail,
      `${a.litmosCount}/14`, `${a.shyftoffCount}/${a.shyftoffTotal}`,
      a.navAvailable ? (a.navAttended ? "YES" : "NO") : "N/A",
      a.readyStatus.toUpperCase()
    ]);
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
              {["dashboard","details"].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
                  style={{ background: activeTab === tab ? "#0ea5e9" : "transparent", color: activeTab === tab ? "#020617" : "#94a3b8" }}>
                  {tab === "dashboard" ? "Dashboard" : "Detail View"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="grid grid-cols-4 gap-3 mb-4">
          <FileUpload label="Litmos Course Data" sublabel="Required — CSV export with all 14 courses" onFiles={f => setLitmosFiles(f)} multiple files={litmosFiles} />
          <FileUpload label="CIP Exports" sublabel="Required — Credentialed agents pipeline" onFiles={f => setCipFiles(f)} multiple files={cipFiles} />
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
            <div className="grid grid-cols-4 gap-3 mb-5">
              <StatCard label="Pipeline Total" value={stats.total} sub="Agents in CIP (excl. production)" color="#e2e8f0" />
              <StatCard label="Production Ready" value={stats.ready} sub="Litmos 14/14 + Nav Meeting" color="#4ade80" />
              <StatCard label="Litmos Complete" value={stats.litmosDone} sub="14/14 required courses" color="#38bdf8" />
              <StatCard label="Nav Meeting" value={stats.navAttended} sub={stats.navAvailable ? "Confirmed attended" : "No data uploaded"} color={stats.navAvailable ? "#f59e0b" : "#475569"} />
            </div>

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
                  { key: "partial", label: "In Progress" },
                  { key: "missing", label: "Not Started" },
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
                      <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: "#475569" }}>
                        <span title="Data not yet reliable — shown for reference only">ShyftOff Apps *</span>
                      </th>
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
                          <span className="font-mono text-xs" style={{ color: "#475569" }} title="Data not yet reliable">
                            {a.shyftoffCount}/{a.shyftoffTotal}
                          </span>
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
                    <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#475569" }}>
                      ShyftOff App Courses ({filtered[expandedRow].shyftoffCount}/{filtered[expandedRow].shyftoffTotal})
                    </div>
                    <div className="rounded-md px-2 py-1.5 mb-2 text-xs" style={{ background: "#1e1b4b", color: "#818cf8", border: "1px solid #312e81" }}>
                      Completion data not yet reliable from CIP export. Shown for reference only — not used in readiness calculation.
                    </div>
                    <div className="space-y-1 opacity-60">
                      {filtered[expandedRow].shyftoffDone.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <div className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold"
                            style={{ background: c.completed ? "#064e3b" : "#1e293b", color: c.completed ? "#4ade80" : "#475569" }}>
                            {c.completed ? "✓" : "—"}
                          </div>
                          <span style={{ color: "#64748b" }}>{c.name}</span>
                          {c.progress !== null && (
                            <span style={{ color: "#475569", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>
                              {Math.round(c.progress * 100)}%
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#64748b" }}>
                      Navigation Meeting
                    </div>
                    <div className="text-xs" style={{ color: filtered[expandedRow].navAttended ? "#4ade80" : "#f87171" }}>
                      {!filtered[expandedRow].navAvailable ? "No nav meeting data uploaded" : filtered[expandedRow].navAttended ? "✓ Attended" : "✗ Not found in attendance list"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-3 text-xs text-center" style={{ color: "#334155" }}>
              Showing {filtered.length} of {results.length} agents • Click any row for full breakdown
              <br />* ShyftOff App course data is shown for reference only — not used in readiness calculation
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
