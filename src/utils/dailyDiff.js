/**
 * Compute a rich day-over-day diff between two history snapshots.
 *
 * Each snapshot's `agentSnapshot.agents` is a map of sid → small state bag:
 *   { name, sid, status, litmosCount, shyftoffPct, bgCleared, inLitmos,
 *     isGhost, isBgMismatch, needsNestingBump, needsNavOutreach,
 *     readyStatus, inProduction }
 *
 * Returns null if either snapshot is missing the agents map (back-compat
 * with older history entries that only stored SID lists).
 *
 * Categories returned (each is { count, agents: [...] }):
 *   - newToProduction:    moved into the production set (was in pipeline)
 *   - leftPipeline:       no longer in pipeline (most are newToProduction;
 *                         residual = removed/reassigned)
 *   - newToPipeline:      brand-new SIDs not seen yesterday
 *   - completedLitmos:    litmosCount went from <14 to 14
 *   - completedShyftoff:  shyftoffPct went from <100 to 100
 *   - gotCredentials:     inLitmos went false → true
 *   - bgCleared:          bgCleared went false → true
 *   - newReady:           readyStatus became "ready"
 *   - statusChanges:      status field text changed
 *   - newIssues:          a new flag turned on (ghost / bg mismatch / nesting bump)
 *   - resolvedIssues:     a flag turned off
 *
 * Each entry in `agents: [...]` is { name, sid, before, after } where
 * before/after are the relevant scalar values (e.g. 12 → 14 for Litmos).
 */
export function computeDailyDiff(today, prev) {
  if (!today || !prev) return null;
  const todayAgents = today.agentSnapshot?.agents;
  const prevAgents = prev.agentSnapshot?.agents;
  // Back-compat: older history entries only have inProductionSids/inPipelineSids
  // arrays, no per-agent map. Fall back to the basic SID-set diff so we still
  // surface SOMETHING after the storage upgrade until 2 days of new history accrue.
  if (!todayAgents || !prevAgents) {
    return computeBasicDiff(today, prev);
  }

  const todaySids = new Set(Object.keys(todayAgents));
  const prevSids = new Set(Object.keys(prevAgents));

  const cats = {
    newToProduction: [],
    leftPipeline: [],
    newToPipeline: [],
    completedLitmos: [],
    completedShyftoff: [],
    gotCredentials: [],
    bgCleared: [],
    newReady: [],
    statusChanges: [],
    newIssues: [],
    resolvedIssues: [],
  };

  // Walk every SID seen in either day.
  const allSids = new Set([...todaySids, ...prevSids]);
  allSids.forEach(sid => {
    const t = todayAgents[sid];
    const p = prevAgents[sid];

    // Brand new in pipeline (didn't exist yesterday)
    if (!p && t) {
      cats.newToPipeline.push({ name: t.name, sid, status: t.status });
      // Continue checking for ready status on a brand-new agent (rare but possible)
      if (t.readyStatus === "ready") {
        cats.newReady.push({ name: t.name, sid, before: "(new)", after: "ready" });
      }
      return;
    }

    // Left the pipeline entirely
    if (p && !t) {
      // If they were in pipeline and now we don't see them, they likely moved
      // to production. The newToProduction category is the more useful framing,
      // so we cross-reference inProduction state when available.
      const wentToProd = today.agentSnapshot?.inProductionSids?.includes(sid);
      if (wentToProd) {
        cats.newToProduction.push({ name: p.name, sid, status: p.status });
      } else {
        cats.leftPipeline.push({ name: p.name, sid, status: p.status });
      }
      return;
    }

    // Both days — compute deltas
    if (!t || !p) return;

    if (p.litmosCount < 14 && t.litmosCount === 14) {
      cats.completedLitmos.push({ name: t.name, sid, before: p.litmosCount, after: 14 });
    }
    if ((p.shyftoffPct ?? 0) < 100 && (t.shyftoffPct ?? 0) === 100) {
      cats.completedShyftoff.push({ name: t.name, sid, before: p.shyftoffPct, after: 100 });
    }
    if (!p.inLitmos && t.inLitmos) {
      cats.gotCredentials.push({ name: t.name, sid });
    }
    if (!p.bgCleared && t.bgCleared) {
      cats.bgCleared.push({ name: t.name, sid });
    }
    if (p.readyStatus !== "ready" && t.readyStatus === "ready") {
      cats.newReady.push({ name: t.name, sid, before: p.readyStatus, after: "ready" });
    }
    if (p.status !== t.status && p.status && t.status) {
      cats.statusChanges.push({ name: t.name, sid, before: p.status, after: t.status });
    }

    // Issue flags — newly turned on or off
    const issueFlags = ["isGhost", "isBgMismatch", "needsNestingBump", "needsNavOutreach"];
    issueFlags.forEach(flag => {
      if (!p[flag] && t[flag]) {
        cats.newIssues.push({ name: t.name, sid, flag, status: t.status });
      } else if (p[flag] && !t[flag]) {
        cats.resolvedIssues.push({ name: t.name, sid, flag, status: t.status });
      }
    });
  });

  // Wrap each category with a count
  const result = {};
  Object.entries(cats).forEach(([k, list]) => {
    result[k] = { count: list.length, agents: list };
  });
  result.previousDate = prev.date;
  result.totalChanges = Object.values(cats).reduce((sum, list) => sum + list.length, 0);
  return result;
}

/**
 * Fallback diff for old history entries that don't have the rich agents map.
 * Preserves the trend-strip experience until 2+ days of new-format entries
 * accumulate.
 */
function computeBasicDiff(today, prev) {
  const todaySet = new Set(today.agentSnapshot?.inProductionSids || []);
  const prevSet = new Set(prev.agentSnapshot?.inProductionSids || []);
  const todayPipe = new Set(today.agentSnapshot?.inPipelineSids || []);
  const prevPipe = new Set(prev.agentSnapshot?.inPipelineSids || []);

  const newToProduction = [...todaySet].filter(s => !prevSet.has(s)).map(sid => ({ sid, name: sid }));
  const leftPipeline = [...prevPipe].filter(s => !todayPipe.has(s)).map(sid => ({ sid, name: sid }));
  const newToPipeline = [...todayPipe].filter(s => !prevPipe.has(s)).map(sid => ({ sid, name: sid }));

  return {
    previousDate: prev.date,
    totalChanges: newToProduction.length + leftPipeline.length + newToPipeline.length,
    newToProduction: { count: newToProduction.length, agents: newToProduction },
    leftPipeline: { count: leftPipeline.length, agents: leftPipeline },
    newToPipeline: { count: newToPipeline.length, agents: newToPipeline },
    completedLitmos: { count: 0, agents: [] },
    completedShyftoff: { count: 0, agents: [] },
    gotCredentials: { count: 0, agents: [] },
    bgCleared: { count: 0, agents: [] },
    newReady: { count: 0, agents: [] },
    statusChanges: { count: 0, agents: [] },
    newIssues: { count: 0, agents: [] },
    resolvedIssues: { count: 0, agents: [] },
    _basic: true, // signal that the rich categories aren't populated
  };
}

/**
 * Build the per-agent state bag for storage. Stripped to just the fields
 * needed for daily-diff computation, so we don't bloat IndexedDB with the
 * full agent records. ~80 bytes per agent × 600 agents = ~50KB per day.
 */
export function buildAgentDigest(pipelineAgents, prodAgents) {
  const agents = {};
  const inPipelineSids = [];
  const inProductionSids = [];

  (pipelineAgents || []).forEach(a => {
    if (!a.sid) return;
    inPipelineSids.push(a.sid);
    agents[a.sid] = {
      name: a.name,
      sid: a.sid,
      status: a.status,
      litmosCount: a.litmosCount,
      shyftoffPct: a.shyftoffPct,
      bgCleared: !!a.bgCleared,
      inLitmos: !!a.inLitmos,
      isGhost: !!a.isGhost,
      isBgMismatch: !!a.isBgMismatch,
      needsNestingBump: !!a.needsNestingBump,
      needsNavOutreach: !!a.needsNavOutreach,
      readyStatus: a.readyStatus,
    };
  });

  (prodAgents || []).forEach(a => {
    if (!a.sid) return;
    inProductionSids.push(a.sid);
    // Don't overwrite a pipeline entry — an agent in both lists is rare but
    // would mean campaign-specific entries. Pipeline data is richer; keep it.
    if (!agents[a.sid]) {
      agents[a.sid] = {
        name: a.name,
        sid: a.sid,
        status: "production",
        inProduction: true,
      };
    }
  });

  return { inPipelineSids, inProductionSids, agents };
}

// Display metadata for each diff category — used by the UI to render cards
// without hard-coding labels in the JSX. Order matters (display order).
export const DIFF_CATEGORIES = [
  { key: "newToProduction", label: "New in production", icon: "▲", color: "var(--c-success)", tone: "good" },
  { key: "newReady",        label: "Newly production-ready", icon: "✓", color: "var(--c-success)", tone: "good" },
  { key: "completedLitmos", label: "Finished all Litmos courses", icon: "🎓", color: "var(--c-primary)", tone: "good" },
  { key: "completedShyftoff", label: "Finished ShyftOff certification", icon: "🎯", color: "var(--c-pink)", tone: "good" },
  { key: "gotCredentials",  label: "Got Litmos credentials", icon: "🔑", color: "var(--c-primary-soft)", tone: "good" },
  { key: "bgCleared",       label: "BG check cleared", icon: "✓", color: "var(--c-success)", tone: "good" },
  { key: "newToPipeline",   label: "New in pipeline", icon: "+", color: "var(--c-primary)", tone: "neutral" },
  { key: "statusChanges",   label: "Status changed", icon: "↻", color: "var(--c-text-muted)", tone: "neutral" },
  { key: "resolvedIssues",  label: "Issues resolved", icon: "✓", color: "var(--c-success)", tone: "good" },
  { key: "newIssues",       label: "New issues flagged", icon: "⚠", color: "var(--c-orange)", tone: "bad" },
  { key: "leftPipeline",    label: "Left the pipeline", icon: "−", color: "var(--c-text-dim)", tone: "neutral" },
];
