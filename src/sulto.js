// Sulto snapshot push — fires after each Analyze to ship a compact view of
// the pipeline state to the receiver bot. The receiver diffs against the
// previous snapshot and emits "new/resolved issue" facts.
//
// Behavior:
//   - No-op when env vars aren't configured (e.g. local dev without .env)
//   - Fire-and-forget: failures are logged, never thrown, never block UI
//
// Note: we do NOT use { keepalive: true } here. The browser caps keepalive
// payloads at 64 KB and this snapshot routinely exceeds that (~600 agents
// × per-agent annotation = 80–120 KB). The request would silently drop
// with "TypeError: Failed to fetch" before sending. Without keepalive the
// request runs as a normal POST — fine in practice because the user is
// looking at the results page right after Analyze, not navigating away.
//
// Receiver expects schema: shyftprod-snapshot/v1
// See: https://beelink.tailcbf816.ts.net:8443/healthz for liveness

const SULTO_URL = import.meta.env.VITE_SULTO_SNAPSHOT_URL;
const SULTO_TOKEN = import.meta.env.VITE_SULTO_SNAPSHOT_TOKEN;

/**
 * Map a pipeline/prod agent's campaign signals to the canonical "ENG" /
 * "Bilingual" pair the receiver expects.
 */
export function deriveCampaign(a) {
  if (a.isProd) {
    if (a.prodCampaigns && a.prodCampaigns.some(c => /bilingual/i.test(c))) return "Bilingual";
    return "ENG";
  }
  if (a.rowCampaign && /bilingual/i.test(a.rowCampaign)) return "Bilingual";
  return "ENG";
}

/**
 * Map a pipeline/prod agent's status flags to the canonical stage label.
 * Phase 2 Training is its own stage even though isNesting is true — the
 * receiver wants visibility into "they're training but not officially
 * Nesting yet" cohort.
 */
export function deriveStage(a) {
  if (a.isProd) return "Production";
  if (a.isPhase2Training) return "Phase 2 Training";
  if (a.isNesting) return "Nesting";
  if (a.isRoster) return "Roster";
  return a.status || "Unknown";
}

/**
 * Per-agent precomputed flags the receiver's stats query needs. Centralized
 * here so the agents array is self-contained and the snapshot payload is
 * easy to inspect / replay.
 */
export function annotateAgentForSulto(a) {
  const campaign = deriveCampaign(a);
  const stage = deriveStage(a);
  const isReady = !a.isProd && a.readyStatus === "ready";
  return {
    name: a.name,
    sid: a.sid,
    campaign,
    stage,
    // Convenience flags so the receiver doesn't need to reproduce campaign matching
    readyEng: isReady && campaign === "ENG",
    readyBi: isReady && campaign === "Bilingual",
    needsNestingBump: !!a.needsNestingBump,
    isStaleWaiter: !!a.isStaleWaiter,
    isGhost: !!a.isGhost,
    hasNameCollision: !!a.hasNameCollision,
    hasBgMismatch: !!a.isBgMismatch,
    needsNewCredentials: !!a.needsNewCredentials,
  };
}

/**
 * Convert the agent flag set into a normalized issues array — one row per
 * (agent, issue) pair. Mirrors the categories surfaced in the dashboard's
 * Pipeline Health and Action Items sections so Sulto's view stays
 * consistent with what the user sees in-app.
 */
export function buildIssuesPayload(agents) {
  const issues = [];
  for (const a of agents) {
    const campaign = deriveCampaign(a);
    const stage = deriveStage(a);
    const base = { agent_sid: a.sid, agent_name: a.name, campaign, stage };
    if (a.isGhost)            issues.push({ ...base, issue_type: "Ghost", detail: "In Nesting but no Litmos account" });
    if (a.isBgMismatch)       issues.push({ ...base, issue_type: "BG Mismatch", detail: `Roster says cleared, CIP shows ${a.cipBgProcess || "in progress"}` });
    if (a.hasAccountIssue)    issues.push({ ...base, issue_type: "BG Blocked", detail: `BG status: ${a.bgStatus || "unknown"}` });
    if (a.isTrulyStale)       issues.push({ ...base, issue_type: "Stale Waiter", detail: `${a.daysSinceChange ?? "?"}d since last status change` });
    if (a.isStaleInQueue)     issues.push({ ...base, issue_type: "Stale In Queue", detail: `${a.daysSinceChange ?? "?"}d waiting on credentials` });
    if (a.hasNameCollision)   issues.push({ ...base, issue_type: "Name Collision", detail: `Multiple Litmos accounts: ${(a.collidingUsernames || []).join(", ")}` });
    if (a.needsNestingBump)   issues.push({ ...base, issue_type: "Needs Nesting Bump", detail: "In Roster status with Litmos credentials" });
    if (a.needsNewCredentials) issues.push({ ...base, issue_type: "Needs New Credentials", detail: (a.rehireSignals || []).join("; ") || "Likely rehire" });
    if (a.removedTodayInProd) issues.push({ ...base, issue_type: "Data Conflict", detail: "Marked removed today AND active in production today" });
  }
  return issues;
}

/**
 * Build the full snapshot payload (without sending it). Pure / testable.
 */
export function buildSnapshotPayload(pipelineAgents, prodAgents) {
  const all = [...(pipelineAgents || []), ...(prodAgents || [])];
  const annotated = all.map(annotateAgentForSulto);
  const stats = {
    total_agents: annotated.length,
    ready_eng: annotated.filter(a => a.readyEng).length,
    ready_bi:  annotated.filter(a => a.readyBi).length,
    needs_nesting_bump: annotated.filter(a => a.needsNestingBump).length,
    stale_waiters:      annotated.filter(a => a.isStaleWaiter).length,
    ghosts:             annotated.filter(a => a.isGhost).length,
    name_collisions:    annotated.filter(a => a.hasNameCollision).length,
    bg_mismatches:      annotated.filter(a => a.hasBgMismatch).length,
    needs_new_creds:    annotated.filter(a => a.needsNewCredentials).length,
  };
  return {
    schema: "shyftprod-snapshot/v1",
    ts: new Date().toISOString(),
    campaign: "NationsBenefits",
    client_version: import.meta.env.VITE_APP_VERSION || "dev",
    stats,
    agents: annotated,
    issues: buildIssuesPayload(all),
  };
}

/**
 * Push the snapshot to the Sulto receiver. Resolves to one of:
 *   "ok"        – delivered (2xx)
 *   "no-config" – env vars missing, nothing sent
 *   "error"     – delivery failed (already logged to console.warn)
 */
export async function pushSnapshotToSulto(pipelineAgents, prodAgents) {
  if (!SULTO_URL || !SULTO_TOKEN) return "no-config";
  const payload = buildSnapshotPayload(pipelineAgents, prodAgents);
  try {
    const r = await fetch(SULTO_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SULTO_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn("Sulto snapshot push:", r.status, txt);
      return "error";
    }
    return "ok";
  } catch (e) {
    console.warn("Sulto snapshot push failed:", e);
    return "error";
  }
}

// Surfaces whether the integration is configured at all — used by the UI
// to decide whether to show the "→ Sulto" indicator next to the Analyze
// button. No secrets exposed; just a boolean.
export function isSultoConfigured() {
  return Boolean(SULTO_URL && SULTO_TOKEN);
}
