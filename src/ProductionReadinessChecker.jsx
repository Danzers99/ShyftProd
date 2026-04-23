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

// ShyftOff courses — ordered by workflow phase
// Phase 1 (Roster): agents can access these before credentials
const ROSTER_COURSES = [
  "NationsBenefits Certification Course",
  "NationsBenefits - Florida Blue 2026 Uptraining",
];
// Phase 2 (Nesting): unlocked after receiving credentials
const NESTING_COURSES = [
  "NationsBenefits Pre-Production",
  "Nations Benefits Navigation Meeting",
];
const SHYFTOFF_COURSES = [...ROSTER_COURSES, ...NESTING_COURSES];

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
  return (s || "").toLowerCase().replace(/[.'''`\u2018\u2019\u201B\-\s]+/g, "").trim();
}

function nameKey(first, last) {
  return `${normalize(first)}|${normalize(last)}`;
}

function nameParts(fullName) {
  const p = (fullName || "").trim().split(/\s+/);
  return { first: p[0] || "", last: p[p.length - 1] || "" };
}

// Strip single-letter tokens (middle initials like "I.", "J", "M.") from a name.
// Handles both "Candace I. Monger" and "Candace Monger I" → "Candace Monger".
function stripMiddleInitials(fullName) {
  return (fullName || "")
    .trim()
    .split(/\s+/)
    .filter(p => {
      const cleaned = p.replace(/[.,]/g, "");
      return cleaned.length > 1; // drop single-letter tokens
    })
    .join(" ");
}

// Generate all name key variations for a full name — includes middle-initial-stripped version.
function nameKeyVariations(fullName) {
  const keys = new Set();
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    // Standard: first + last
    keys.add(nameKey(parts[0], parts[parts.length - 1]));
    // Multi-part first (for 3+ token names): first two joined + last
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

function candidateEmails(fullName) {
  const parts = (fullName || "").trim().replace(/['''`\u2018\u2019\u201B]/g, "").split(/\s+/).filter(Boolean);
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

// Fuzzy-match a course_code or course_name from the CIP data to our known courses
function matchShyftoffCourse(code) {
  const lc = (code || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (lc.includes("certification") || lc.includes("certcourse")) return ROSTER_COURSES[0];
  if (lc.includes("floridablue") || lc.includes("fiblue") || lc.includes("flblue") || lc.includes("uptraining")) return ROSTER_COURSES[1];
  if (lc.includes("preproduction") || lc.includes("preprod")) return NESTING_COURSES[0];
  if (lc.includes("navigation") || lc.includes("navmeeting") || lc.includes("selfguided")) return NESTING_COURSES[1];
  return code; // return raw if no match
}

function parseCertProgress(raw) {
  if (!raw || raw === "") return { pct: null, map: {}, courseMap: {} };
  // New dashboard format: plain integer 0-100
  const asNum = Number(raw);
  if (!isNaN(asNum) && raw.trim().match(/^\d+$/)) {
    // Estimate per-course completion from overall percentage
    // 4 courses, each worth 25%. Courses unlock in order: Cert → FL Blue → Pre-Prod → Nav
    const courseMap = {};
    const perCourse = 100 / SHYFTOFF_COURSES.length;
    let remaining = asNum;
    SHYFTOFF_COURSES.forEach(c => {
      if (remaining >= perCourse) {
        courseMap[c] = 100;
        remaining -= perCourse;
      } else if (remaining > 0) {
        courseMap[c] = Math.round((remaining / perCourse) * 100);
        remaining = 0;
      } else {
        courseMap[c] = 0;
      }
    });
    return { pct: asNum, map: {}, courseMap };
  }
  // Old CIP format: JSON array with per-course progress
  try {
    const arr = JSON.parse(raw.replace(/""/g, '"'));
    const map = {};
    const courseMap = {};
    arr.forEach(item => {
      const rawCode = item.course_code || item.course_name || "";
      const pct = parseFloat(item.progress) || 0;
      map[rawCode] = pct;
      const matched = matchShyftoffCourse(rawCode);
      courseMap[matched] = pct * 100; // progress is 0-1 in JSON format
    });
    const values = Object.values(map);
    const pct = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) : 0;
    return { pct, map, courseMap };
  } catch { return { pct: null, map: {}, courseMap: {} }; }
}

function FileUpload({ label, sublabel, onFiles, multiple, files }) {
  const ref = useRef();
  return (
    <div
      className="relative border border-dashed rounded-lg p-3 cursor-pointer transition-all hover:border-purple-400 hover:bg-purple-950/20"
      style={{ borderColor: files?.length ? "#8F68D3" : "#4D1F3B" }}
      onClick={() => ref.current?.click()}
    >
      <input ref={ref} type="file" accept=".csv" multiple={multiple}
        className="hidden" onChange={e => onFiles(Array.from(e.target.files))} />
      <div className="text-sm font-semibold" style={{ color: files?.length ? "#8F68D3" : "#b8a5d4" }}>{label}</div>
      <div className="text-xs mt-0.5" style={{ color: "#7a5f9a" }}>{sublabel}</div>
      {files?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {files.map((f, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#4D1F3B", color: "#FF66C4" }}>
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
    ready: { bg: "#1a4d2e", color: "#4ade80", text: "READY" },
    partial: { bg: "#4D1F3B", color: "#FFE566", text: "IN PROGRESS" },
    missing: { bg: "#3d1525", color: "#FF7866", text: "NOT STARTED" },
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
    <div className="rounded-xl p-4" style={{ background: "#1a0d2e", border: "1px solid #3d2057" }}>
      <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#7a5f9a" }}>{label}</div>
      <div className="text-3xl font-black" style={{ color }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "#b8a5d4" }}>{sub}</div>}
    </div>
  );
}

function CourseDot({ done, title }) {
  return (
    <div title={title} className="w-3 h-3 rounded-sm flex-shrink-0"
      style={{ background: done ? "#22c55e" : "#FF7866", opacity: done ? 1 : 0.6 }} />
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
  const [showEmail, setShowEmail] = useState(false);
  const [openSections, setOpenSections] = useState(new Set(["flblue", "health"]));
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [showDetailCols, setShowDetailCols] = useState(false);

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

    // Track production status BY CAMPAIGN so agents in prod for one campaign
    // (e.g. Bilingual) can still be tracked in pipeline for another (e.g. ENG).
    // Map: SID → Set of campaign names they're in production for
    const prodCampaignsBySid = new Map();
    const prodCampaignsByKey = new Map(); // name-key fallback when no SID
    const addProdCampaign = (key, campaign) => {
      if (!key || !campaign) return;
      const map = key.includes("|") ? prodCampaignsByKey : prodCampaignsBySid;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(campaign);
    };
    (prodData || []).forEach(r => {
      const nm = (r.agent_nm || r.agent_name || r.full_name || "").trim();
      const sid = (r.so_agent_id || r.shyftoff_id || "").trim().toUpperCase();
      // Single campaign per row (JSON-format production exports)
      const campaign = (r.campaign_nm || "").trim();
      // Comma/semicolon-separated list (simple-format production agents)
      const campaignList = (r.productive_campaigns_list || r.active_campaigns_list || "").trim();
      const campaigns = campaign ? [campaign] : campaignList.split(/[;,]/).map(c => c.trim()).filter(Boolean);
      if (sid) {
        campaigns.forEach(c => addProdCampaign(sid, c));
      }
      // Also track by name key for agents without SID or for fallback matching
      const { first, last } = nameParts(nm);
      const nk = nameKey(first, last);
      campaigns.forEach(c => addProdCampaign(nk, c));
      const pp = nm.split(/\s+/).filter(Boolean);
      if (pp.length > 2) {
        const nk2 = nameKey(pp.slice(0, -1).join(""), pp[pp.length - 1]);
        campaigns.forEach(c => addProdCampaign(nk2, c));
      }
    });
    // Helper: is this agent in production for this specific campaign?
    const isInProdForCampaign = (sid, key, campaign) => {
      if (!campaign) return false;
      const sidProdCampaigns = prodCampaignsBySid.get(sid?.toUpperCase() || "") || new Set();
      const keyProdCampaigns = prodCampaignsByKey.get(key) || new Set();
      return sidProdCampaigns.has(campaign) || keyProdCampaigns.has(campaign);
    };
    // Helper: get ALL campaigns this agent is in production for
    const getProdCampaigns = (sid, key) => {
      const sidSet = prodCampaignsBySid.get(sid?.toUpperCase() || "") || new Set();
      const keySet = prodCampaignsByKey.get(key) || new Set();
      return [...new Set([...sidSet, ...keySet])];
    };

    // People Report: who has a Litmos account (= has credentials)
    // Track name → usernames so we can detect collisions (multiple people with same name)
    const litmosPeopleEmails = new Set();
    const litmosPeopleNames = new Set();
    const litmosNameToUsernames = new Map(); // nameKey → [usernames, ...] for collision detection
    (peopleData || []).forEach(r => {
      const email = (r["People.Username"] || "").toLowerCase().trim();
      if (email) litmosPeopleEmails.add(email);
      const first = r["People.First Name"] || "";
      const last = r["People.Last Name"] || "";
      if (first || last) {
        // Register both the raw name key AND all variations
        // (handles "Candace Monger I" where middle initial is stored in last name field)
        const fullName = `${first} ${last}`.trim();
        const variations = nameKeyVariations(fullName);
        variations.forEach(k => {
          litmosPeopleNames.add(k);
          if (!litmosNameToUsernames.has(k)) litmosNameToUsernames.set(k, []);
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

    // Deduplicate agents by ShyftOff ID when multiple files are uploaded
    // Merge strategy: Roster/Nesting exports have accurate course progress (integer)
    // and simple BG status. CIP export has detailed BG JSON for mismatch detection.
    // Keep both, but prefer Roster/Nesting for course data.
    const seenSids = new Map();
    cipData.forEach(row => {
      const sid = (row.shyftoff_id || "").trim();
      if (!sid) return;
      if (seenSids.has(sid)) {
        const existing = seenSids.get(sid);
        // BG JSON: keep the one with actual data (non-null process_status)
        if (row.background_check) {
          if (!existing.background_check) {
            existing.background_check = row.background_check;
          } else {
            // Both have BG JSON — prefer the one with non-null process_status
            try {
              const inArr = JSON.parse(row.background_check);
              const exArr = JSON.parse(existing.background_check);
              const inPs = inArr?.[0]?.process_status || "";
              const exPs = exArr?.[0]?.process_status || "";
              if (inPs && !exPs) existing.background_check = row.background_check;
            } catch {}
          }
        }
        // Simple BG status: keep any non-empty value (Roster is authoritative)
        if (row.background_check_status && !existing.background_check_status) existing.background_check_status = row.background_check_status;
        // Stale level from Roster/Nesting
        if (row.stale_level && !existing.stale_level) existing.stale_level = row.stale_level;
        // Cert progress: ALWAYS prefer Roster/Nesting integer over CIP JSON
        // Roster/Nesting integers are accurate for ShyftOff courses; CIP JSON is not
        if (row.certification_progress) {
          const incoming = row.certification_progress.trim();
          const existingCert = (existing.certification_progress || "").trim();
          const incomingIsInteger = incoming.match(/^\d+$/);
          const existingIsInteger = existingCert.match(/^\d+$/);
          if (incomingIsInteger && !existingIsInteger) {
            // Incoming is Roster integer, existing is CIP JSON — prefer Roster
            existing.certification_progress = row.certification_progress;
          } else if (!existingCert) {
            existing.certification_progress = row.certification_progress;
          }
        }
        // Prefer Roster/Nesting status if it has more detail
        if (row.status && row.agent_name && !existing.agent_name) {
          existing.agent_name = row.agent_name;
        }
        return;
      }
      seenSids.set(sid, { ...row });
    });
    const dedupedCip = [...seenSids.values()];

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
      const prodCampaignsForAgent = getProdCampaigns(sid, key);
      if (rowCampaign && isInProdForCampaign(sid, key, rowCampaign)) return;
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
      const flBlueDone = (courseMap[ROSTER_COURSES[1]] || 0) >= 100;
      const rosterCoursesDone = nbCertDone && flBlueDone;
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
      // Parse background check from both formats:
      // Roster/Nesting: simple `background_check_status` string ("cleared", "pending", etc.)
      // CIP Export: JSON `background_check` with process_status/report_status
      let bgStatus = (row.background_check_status || "").trim().toLowerCase();
      let cipBgProcess = "";
      let cipBgReport = "";
      const bgJson = (row.background_check || "").trim();
      if (bgJson.startsWith("[")) {
        try {
          const arr = JSON.parse(bgJson);
          if (arr.length > 0) {
            cipBgProcess = (arr[0].process_status || "").toUpperCase();
            cipBgReport = (arr[0].report_status || "").toLowerCase();
          }
        } catch {}
      }
      // If no simple status but CIP JSON exists, derive status from it
      if (!bgStatus && cipBgProcess) {
        bgStatus = cipBgProcess === "PASSED" ? "cleared" : cipBgReport || cipBgProcess.toLowerCase();
      }
      // BG is cleared if: CIP process says PASSED, OR CIP report says clear/proceed,
      // OR simple status says cleared (but ONLY when CIP doesn't contradict it)
      const bgReportClear = cipBgReport === "clear" || cipBgReport === "proceed";
      const cipContradicts = cipBgProcess === "IN_PROGRESS" && !bgReportClear && cipBgProcess !== "";
      const bgCleared = cipBgProcess === "PASSED" || bgReportClear
        || (bgStatus === "cleared" && !cipContradicts);
      const createdAt = row.created_at ? new Date(row.created_at) : null;
      const lastChanged = row.last_changed || row.status_updated_at || "";
      const changedAt = lastChanged ? new Date(lastChanged) : null;
      const statusLower = status.toLowerCase();
      const isNesting = statusLower.includes("nesting");
      const isRoster = statusLower.includes("roster");
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
      // BG mismatch: Roster/Nesting says "cleared" but CIP JSON says IN_PROGRESS
      // with a non-clear report (pending/processing/consider/created).
      // This is the cross-source discrepancy — the simple status is stale/wrong.
      const simpleBgCleared = (row.background_check_status || "").trim().toLowerCase() === "cleared";
      const cipBgNotCleared = cipBgProcess === "IN_PROGRESS" && !bgReportClear;
      const isBgMismatch = simpleBgCleared && cipBgNotCleared;

      // Credential pipeline flags (cross-referencing status + actual data)
      // Ready for credentials = courses done + BG cleared + CONFIRMED not in Litmos.
      // Excludes name collisions — we can't claim they need credentials if we can't
      // confidently say they lack them.
      const isWaitingForCreds = !inLitmos && !hasNameCollision && bgCleared && rosterCoursesDone;
      // Creds requested but courses not done = system advanced them prematurely
      const isCredsRequestedNoCourses = isCredentialsRequested && !rosterCoursesDone && !inLitmos && !hasNameCollision;
      // Creds requested, courses done, BG cleared, but already in Litmos = already credentialed
      const isAlreadyCredentialed = isCredentialsRequested && inLitmos;

      const isStaleWaiter = isWaitingForCreds && daysSinceChange !== null && daysSinceChange >= 21;
      // Split stale into: in credentials queue vs truly stale (only agents with cleared BG)
      const isStaleInQueue = isStaleWaiter && isCredentialsRequested;
      const isTrulyStale = isStaleWaiter && !isCredentialsRequested;
      // Account issue = BG not cleared, but NOT a known mismatch (those get their own category)
      const hasAccountIssue = !bgCleared && bgStatus !== "" && !isBgMismatch;

      const allLitmos = litmosCount === 14;
      const navMet = navAttended || !(navData && navData.length > 0);
      const readyStatus = allLitmos && shyftoffComplete && navMet ? "ready"
        : (litmosCount > 0 || (shyftoffPct !== null && shyftoffPct > 0)) ? "partial" : "missing";

      // Determine credential eligibility reason
      // Key trigger: Roster courses (NB Cert + FL Blue) done + BG cleared = credentials eligible
      let credentialNote = "";
      if (inLitmos) credentialNote = "Has credentials";
      else if (isBgMismatch) credentialNote = "BG mismatch — Roster says cleared but CIP shows in progress";
      else if (rosterCoursesDone && bgCleared) credentialNote = "Should be on next credentials batch";
      else if (rosterCoursesDone && !bgCleared) credentialNote = "Roster courses done — waiting on BG check";
      else if (nbCertDone && !flBlueDone && bgCleared) credentialNote = "BG cleared — FL Blue uptraining in progress";
      else if (!rosterCoursesDone && bgCleared) credentialNote = "BG cleared — roster courses in progress";
      else if (nbCertDone && !bgCleared) credentialNote = "NB Cert done — BG check + FL Blue pending";
      else credentialNote = "Roster courses in progress";

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
        isNesting, isRoster, isCredentialsRequested, shyftoffStaleLevel,
        cipBgProcess, cipBgReport, isBgMismatch,
        isGhost, isWaitingForCreds, isCredsRequestedNoCourses, isAlreadyCredentialed,
        isStaleWaiter, isStaleInQueue, isTrulyStale, hasAccountIssue,
        credentialNote,
      });
    });

    return agents;
  }, [litmosData, cipData, prodData, navData, peopleData]);

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
      };
    });
  }, [prodData]);

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

  const filtered = useMemo(() => {
    if (!results) return [];
    // Production filters return prod agents instead of pipeline agents
    const prodFilters = ["production", "prod_flblue_incomplete"];
    if (prodFilters.includes(filter)) {
      let out = prodAgents;
      if (filter === "prod_flblue_incomplete") out = out.filter(a => a.hasFlBlueData ? !a.flBlueDone : !a.allCoursesDone);
      if (search) {
        const s = search.toLowerCase();
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
    if (filter === "flblue_done") out = out.filter(a => a.flBlueDone);
    if (filter === "flblue_incomplete") out = out.filter(a => !a.flBlueDone);
    if (filter === "campaign_eng") out = out.filter(a => a.rowCampaign && !/bilingual/i.test(a.rowCampaign) && /nations/i.test(a.rowCampaign));
    if (filter === "campaign_bi") out = out.filter(a => a.rowCampaign && /bilingual/i.test(a.rowCampaign));
    if (filter === "campaign_both") out = out.filter(a => a.rowCampaign && /nations/i.test(a.rowCampaign) && a.prodCampaigns && a.prodCampaigns.length > 0);
    if (search) {
      const s = search.toLowerCase();
      out = out.filter(a => a.name.toLowerCase().includes(s) || a.sid.toLowerCase().includes(s) || (a.nbEmail || "").toLowerCase().includes(s));
    }
    return out;
  }, [results, prodAgents, filter, search]);

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
      flBlueDone: results.filter(a => a.flBlueDone).length,
      flBlueIncomplete: results.filter(a => !a.flBlueDone).length,
      engPipeline: results.filter(a => a.rowCampaign && !/bilingual/i.test(a.rowCampaign) && /nations/i.test(a.rowCampaign)).length,
      biPipeline: results.filter(a => a.rowCampaign && /bilingual/i.test(a.rowCampaign)).length,
      crossoverEngReady: results.filter(a => a.rowCampaign && !/bilingual/i.test(a.rowCampaign) && /nations/i.test(a.rowCampaign) && a.readyStatus === "ready" && a.prodCampaigns && a.prodCampaigns.some(c => /bilingual/i.test(c))).length,
      crossoverBiReady: results.filter(a => a.rowCampaign && /bilingual/i.test(a.rowCampaign) && a.readyStatus === "ready" && a.prodCampaigns && a.prodCampaigns.some(c => !/bilingual/i.test(c) && /nations/i.test(c))).length,
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
  };

  const handleExportIssues = () => {
    if (!results) return;
    const issueAgents = results.filter(a => a.isBgMismatch || a.hasAccountIssue || a.isGhost || a.isTrulyStale || a.isStaleInQueue || a.hasNameCollision);
    if (!issueAgents.length) return;
    const today = new Date().toISOString().split("T")[0];
    const headers = [
      "Issue Type","Agent Name","ShyftOff ID","CIP Status",
      "Roster BG Status","CIP BG Process","CIP BG Report",
      "Has Credentials (Litmos)","Cert Progress %",
      "NB Cert Done","FL Blue Done","Days in Status","Action Needed"
    ];
    const rows = issueAgents.map(a => {
      let issueType = "";
      let action = "";
      if (a.isBgMismatch) {
        issueType = "BG Data Mismatch";
        action = "Roster shows cleared but CIP shows In Progress. Investigate BG check system sync.";
      } else if (a.hasAccountIssue) {
        issueType = "BG Pending/Created";
        action = "Background check not cleared. Agent blocked from progressing.";
      } else if (a.isGhost) {
        issueType = "Nesting Without Credentials";
        action = "In Nesting status but no Litmos account. Needs credentialing or status correction.";
      } else if (a.isTrulyStale) {
        issueType = "Stale 3+ Weeks";
        action = "Ready for credentials 3+ weeks but not processed. Manual investigation needed.";
      } else if (a.isStaleInQueue) {
        issueType = "Stale — In Queue";
        action = "Credentials requested 3+ weeks ago. Check if batch was processed.";
      } else if (a.hasNameCollision) {
        issueType = "Name Collision";
        action = `Multiple Litmos accounts share this name: ${(a.collidingUsernames || []).join(", ")}. Verify manually before credentialing.`;
      }
      return [
        issueType, a.name, a.sid, a.status,
        a.bgStatus || "N/A", a.cipBgProcess || "N/A", a.cipBgReport || "N/A",
        a.inLitmos ? "YES" : "NO",
        a.shyftoffPct !== null ? a.shyftoffPct : "N/A",
        a.nbCertDone ? "YES" : "NO", a.flBlueDone ? "YES" : "NO",
        a.daysSinceChange !== null ? a.daysSinceChange : "N/A",
        action,
      ];
    });
    // Sort by issue type so BG mismatches are grouped together
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    downloadCsv(headers, rows, `pipeline_issues_${today}.csv`);
  };

  const handleExportFlBlue = () => {
    const today = new Date().toISOString().split("T")[0];
    const headers = ["Group","Agent Name","ShyftOff ID","Status","Cert Progress %","FL Blue Status","BG Status"];
    const rows = [];
    // Production agents
    prodAgents.forEach(a => {
      rows.push([
        "Production", a.name, a.sid, a.status, a.certPct !== null ? a.certPct : "N/A",
        a.flBlueDone === true ? "Complete" : a.flBlueDone === false ? "Not Done" : a.allCoursesDone ? "All Done (cert 100%)" : "No Data",
        a.bgStatus || "N/A",
      ]);
    });
    // Pipeline agents
    if (results) {
      results.forEach(a => {
        rows.push([
          "Pipeline", a.name, a.sid, a.status, a.shyftoffPct !== null ? a.shyftoffPct : "N/A",
          a.flBlueDone ? "Complete" : "Incomplete",
          a.bgStatus || "N/A",
        ]);
      });
    }
    rows.sort((a, b) => {
      if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
      return a[4] === "Complete" ? 1 : -1; // Incomplete first
    });
    downloadCsv(headers, rows, `fl_blue_uptraining_${today}.csv`);
  };

  const flBlueSummaryText = useMemo(() => {
    if (!prodStats && !stats) return "";
    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    let text = `FL Blue 2026 Uptraining Summary — ${today}\n\n`;
    if (prodStats) {
      const pct = Math.round(prodStats.flBlueDone / prodStats.total * 100);
      text += `PRODUCTION AGENTS (${prodStats.total})\n`;
      if (prodStats.hasFlBlueData) {
        text += `• FL Blue Complete: ${prodStats.flBlueDone} (${pct}%)\n`;
        text += `• FL Blue Not Done: ${prodStats.flBlueNotDone}\n\n`;
      } else {
        text += `• All Courses Done (cert 100%): ${prodStats.total - prodStats.noData}\n`;
        text += `• No per-course data — upload production-export files for FL Blue detail\n\n`;
      }
    }
    if (stats) {
      text += `PIPELINE AGENTS (${stats.total})\n`;
      text += `• Done: ${stats.flBlueDone}\n`;
      text += `• Not Done: ${stats.flBlueIncomplete}\n`;
    }
    return text;
  }, [prodStats, stats]);

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
      body += `Roster courses (NB Cert + FL Blue) complete + BG cleared but not yet in Litmos — should be added to credentials list.\n`;
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
        <div className="grid grid-cols-5 gap-3 mb-4">
          <FileUpload label="Litmos Course Data" sublabel="Required — CSV with course completions" onFiles={f => setLitmosFiles(f)} multiple files={litmosFiles} />
          <FileUpload label="Litmos People Report" sublabel="Required — Who has a Litmos account" onFiles={f => setPeopleFiles(f)} multiple={false} files={peopleFiles} />
          <FileUpload label="Nesting / CIP Export" sublabel="Required — Dashboard or CIP agent export" onFiles={f => setCipFiles(f)} multiple files={cipFiles} />
          <FileUpload label="Production Exports" sublabel="Optional — Exclude current prod agents" onFiles={f => setProdFiles(f)} multiple files={prodFiles} />
          <FileUpload label="Nav Meeting Tracker" sublabel="Optional — ShyftNav export or legacy Name/Email CSV" onFiles={f => setNavFiles(f)} multiple={false} files={navFiles} />
        </div>

        <div className="flex gap-2 mb-5">
          <button onClick={handleProcess}
            disabled={!litmosFiles.length || !cipFiles.length || processing}
            className="px-5 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-30"
            style={{ background: "#8F68D3", color: "#27133A" }}>
            {processing ? "Processing..." : "Analyze Readiness"}
          </button>
          {hasData && (
            <>
              <button onClick={handleExport} className="px-4 py-2 rounded-lg text-sm font-semibold border transition-all hover:bg-purple-900/30" style={{ borderColor: "#4D1F3B", color: "#b8a5d4" }}>
                Export CSV
              </button>
              <button onClick={handleExportIssues} className="px-4 py-2 rounded-lg text-sm font-semibold border transition-all hover:brightness-110" style={{ borderColor: "#FFE566", color: "#FFE566" }}>
                Export Issues
              </button>
              <button onClick={() => setShowEmail(true)} className="px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110" style={{ background: "#FF66C4", color: "#fff" }}>
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

            {/* === SECTION: FL Blue Uptraining === */}
            <div className="mb-3 rounded-xl overflow-hidden" style={{ border: "1px solid #3d2057" }}>
              <button onClick={() => toggleSection("flblue")} className="w-full flex items-center justify-between px-4 py-2.5 transition-all hover:brightness-110" style={{ background: "#1a0d2e" }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: "#7a5f9a" }}>{openSections.has("flblue") ? "▾" : "▸"}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#7a5f9a" }}>FL Blue 2026 Uptraining</span>
                </div>
                <div className="flex items-center gap-3 text-xs" style={{ color: "#5c3d7a" }}>
                  {prodStats && <span>Production: {prodStats.hasFlBlueData ? prodStats.flBlueDone : "?"}/{prodStats.total} FL Blue done</span>}
                  <span>Pipeline: {stats.flBlueDone}/{stats.total} complete</span>
                </div>
              </button>
              {openSections.has("flblue") && (
                <div className="px-4 py-3" style={{ background: "#27133A" }}>
                  {/* Production agents */}
                  {prodStats && (
                    <div className="mb-3">
                      <div className="text-xs font-semibold mb-2" style={{ color: "#7a5f9a" }}>Production Agents ({prodStats.total}){!prodStats.hasFlBlueData && <span style={{ color: "#5c3d7a" }}> — upload production-export files for per-course FL Blue data</span>}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setFilter(filter === "production" ? "all" : "production")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "production" ? "#1a4d2e44" : "#1a4d2e22", border: `1px solid ${filter === "production" ? "#4ade80" : "#1a4d2e"}` }}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-bold" style={{ color: "#4ade80" }}>FL Blue Complete</span>
                            <span className="text-xl font-black" style={{ color: "#4ade80" }}>{prodStats.hasFlBlueData ? prodStats.flBlueDone : prodStats.total - prodStats.noData + " (cert 100%)"}</span>
                          </div>
                          <div className="text-xs" style={{ color: "#5c3d7a" }}>{prodStats.hasFlBlueData ? "Confirmed from per-course data." : "Based on aggregate cert only."}</div>
                        </button>
                        <button onClick={() => setFilter(filter === "prod_flblue_incomplete" ? "all" : "prod_flblue_incomplete")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "prod_flblue_incomplete" ? "#FF786622" : "#FF786611", border: `1px solid ${filter === "prod_flblue_incomplete" ? "#FF7866" : "#4D1F3B"}` }}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-bold" style={{ color: "#FF7866" }}>FL Blue Not Done</span>
                            <span className="text-xl font-black" style={{ color: "#FF7866" }}>{prodStats.hasFlBlueData ? prodStats.flBlueNotDone : prodStats.noData}</span>
                          </div>
                          <div className="text-xs" style={{ color: "#5c3d7a" }}>{prodStats.hasFlBlueData ? "Confirmed from per-course data." : "No per-course data available."}</div>
                        </button>
                      </div>
                      {/* Progress bar */}
                      {prodStats.hasFlBlueData && (
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "#3d2057" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.round(prodStats.flBlueDone / prodStats.total * 100)}%`, background: "#4ade80" }} />
                        </div>
                        <span className="text-xs font-bold" style={{ color: "#b8a5d4", fontFamily: "'IBM Plex Mono', monospace" }}>{Math.round(prodStats.flBlueDone / prodStats.total * 100)}%</span>
                      </div>
                      )}
                    </div>
                  )}
                  {/* Pipeline agents — Done vs Not Done */}
                  <div>
                    <div className="text-xs font-semibold mb-2" style={{ color: "#7a5f9a" }}>Pipeline Agents ({stats.total})</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => setFilter(filter === "flblue_done" ? "all" : "flblue_done")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "flblue_done" ? "#1a4d2e44" : "#1a4d2e22", border: `1px solid ${filter === "flblue_done" ? "#4ade80" : "#1a4d2e"}` }}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-bold" style={{ color: "#4ade80" }}>Done</span>
                          <span className="text-xl font-black" style={{ color: "#4ade80" }}>{stats.flBlueDone}</span>
                        </div>
                        <div className="text-xs" style={{ color: "#5c3d7a" }}>FL Blue uptraining completed.</div>
                      </button>
                      <button onClick={() => setFilter(filter === "flblue_incomplete" ? "all" : "flblue_incomplete")} className="text-left rounded-lg p-3 transition-all hover:brightness-110" style={{ background: filter === "flblue_incomplete" ? "#FF786622" : "#FF786611", border: `1px solid ${filter === "flblue_incomplete" ? "#FF7866" : "#4D1F3B"}` }}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-bold" style={{ color: "#FF7866" }}>Not Done</span>
                          <span className="text-xl font-black" style={{ color: "#FF7866" }}>{stats.flBlueIncomplete}</span>
                        </div>
                        <div className="text-xs" style={{ color: "#5c3d7a" }}>FL Blue not yet completed.</div>
                      </button>
                    </div>
                  </div>
                  {/* FL Blue actions */}
                  <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: "1px solid #3d2057" }}>
                    <button onClick={handleExportFlBlue} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110" style={{ background: "#3d2057", color: "#b8a5d4" }}>
                      Export FL Blue CSV
                    </button>
                    <button onClick={() => { navigator.clipboard.writeText(flBlueSummaryText); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110" style={{ background: "#3d2057", color: "#b8a5d4" }}>
                      Copy Summary
                    </button>
                  </div>
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
                    <div className="text-xs" style={{ color: "#5c3d7a" }}>Creds requested but courses not done.</div>
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
                  <thead>
                    <tr style={{ background: "#1a0d2e" }}>
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
                          </div>
                          )}
                          {a.isProd && a.flBlueDone === false && (
                            <span className="text-xs px-1.5 py-0 rounded" style={{ background: "#4D1F3B", color: "#FF7866", fontSize: 10 }}>FL BLUE NOT DONE</span>
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
                          ? <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: a.flBlueDone === true ? "#1a4d2e" : a.flBlueDone === false ? "#4D1F3B" : "#3d2057", color: a.flBlueDone === true ? "#4ade80" : a.flBlueDone === false ? "#FF7866" : "#b8a5d4" }}>{a.flBlueDone === true ? "FL BLUE ✓" : a.flBlueDone === false ? "FL BLUE ✗" : `CERT ${a.certPct}%`}</span>
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
                    <span className="text-sm font-semibold" style={{ color: ag.flBlueDone === true ? "#4ade80" : ag.flBlueDone === false ? "#FF7866" : "#b8a5d4" }}>
                      {ag.flBlueDone === true ? "FL Blue complete" : ag.flBlueDone === false ? "FL Blue not done" : ag.allCoursesDone ? "All courses done" : `Cert ${ag.certPct}%`}
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
                      <span style={{ color: "#7a5f9a" }}>FL Blue Status</span>
                      <span style={{ color: ag.flBlueDone === true ? "#4ade80" : ag.flBlueDone === false ? "#FF7866" : "#b8a5d4" }}>
                        {ag.flBlueDone === true ? `✓ Complete${ag.flBluePct !== null ? "" : ""}` : ag.flBlueDone === false ? `✗ Not done${ag.flBluePct !== null ? ` (${ag.flBluePct}%)` : ""}` : ag.allCoursesDone ? "✓ All courses done (cert 100%)" : "No per-course data"}
                      </span>
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
                  return (
                    <div key={i} className="flex items-center gap-2 mb-1.5" style={{ opacity: locked ? 0.5 : 1 }}>
                      <div className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold"
                        style={{ background: done ? "#1a4d2e" : "#3d2057", color: done ? "#4ade80" : locked ? "#5c3d7a" : pct > 0 ? "#FFE566" : "#5c3d7a" }}>
                        {locked ? "🔒" : done ? "✓" : pct > 0 ? "◔" : "○"}
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-semibold" style={{ color: done ? "#E8DFF6" : "#b8a5d4" }}>{course}</div>
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
