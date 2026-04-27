import { nameKey, nameParts } from "./matchNames";

/**
 * Build campaign-aware production lookup tables.
 *
 * The classic regression: an agent is in production for one campaign (e.g. Bilingual)
 * but still actively progressing in another campaign's pipeline (e.g. ENG). The old
 * naive logic excluded them from ALL pipeline analysis based on SID match alone.
 *
 * This function builds two maps:
 *   prodCampaignsBySid: SID -> Set of campaign names they're in production for
 *   prodCampaignsByKey: nameKey -> Set of campaign names (fallback for missing SIDs)
 *
 * These are used to determine: is THIS row's campaign one the agent is already in
 * production for? If yes → exclude. If no → process normally.
 */
export function buildProdCampaignMaps(prodData) {
  const bySid = new Map();
  const byKey = new Map();

  const add = (map, key, campaign) => {
    if (!key || !campaign) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(campaign);
  };

  for (const r of prodData || []) {
    const nm = (r.agent_nm || r.agent_name || r.full_name || "").trim();
    const sid = (r.so_agent_id || r.shyftoff_id || "").trim().toUpperCase();

    // Single campaign per row (CIP-format / production-export)
    const campaign = (r.campaign_nm || "").trim();
    // Comma/semicolon-separated list (simple production_agents format)
    const campaignList = (r.productive_campaigns_list || r.active_campaigns_list || "").trim();
    const campaigns = campaign
      ? [campaign]
      : campaignList.split(/[;,]/).map(c => c.trim()).filter(Boolean);

    if (sid) {
      campaigns.forEach(c => add(bySid, sid, c));
    }

    const { first, last } = nameParts(nm);
    const nk = nameKey(first, last);
    campaigns.forEach(c => add(byKey, nk, c));

    // Also register multi-part name variant
    const pp = nm.split(/\s+/).filter(Boolean);
    if (pp.length > 2) {
      const nk2 = nameKey(pp.slice(0, -1).join(""), pp[pp.length - 1]);
      campaigns.forEach(c => add(byKey, nk2, c));
    }
  }

  return { bySid, byKey };
}

/**
 * Is this agent in production for this specific campaign?
 */
export function isInProdForCampaign(maps, sid, key, campaign) {
  if (!campaign) return false;
  const sidSet = maps.bySid.get((sid || "").toUpperCase()) || new Set();
  const keySet = maps.byKey.get(key) || new Set();
  return sidSet.has(campaign) || keySet.has(campaign);
}

/**
 * Get all campaigns this agent is in production for (any campaign).
 */
export function getProdCampaigns(maps, sid, key) {
  const sidSet = maps.bySid.get((sid || "").toUpperCase()) || new Set();
  const keySet = maps.byKey.get(key) || new Set();
  return [...new Set([...sidSet, ...keySet])];
}
