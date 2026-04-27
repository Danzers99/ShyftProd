import { describe, it, expect } from "vitest";
import { buildProdCampaignMaps, isInProdForCampaign, getProdCampaigns } from "../prodCampaigns";

describe("buildProdCampaignMaps + isInProdForCampaign", () => {
  it("excludes agent from same-campaign pipeline (Janapher's Bilingual prod)", () => {
    // Janapher Sanchez: in production for Nations Benefits Bilingual (campaign 28)
    // but actively in pipeline for Nations Benefits ENG (campaign 20).
    // Expected: only excluded from Bilingual campaign rows, NOT from ENG.
    const prodData = [
      { shyftoff_id: "S2022579", agent_nm: "Janapher Sanchez", campaign_nm: "Nations Benefits Bilingual" },
    ];
    const maps = buildProdCampaignMaps(prodData);

    // Same campaign — should be excluded
    expect(isInProdForCampaign(maps, "S2022579", "janapher|sanchez", "Nations Benefits Bilingual")).toBe(true);
    // Different campaign — should NOT be excluded
    expect(isInProdForCampaign(maps, "S2022579", "janapher|sanchez", "Nations Benefits")).toBe(false);
  });

  it("supports comma/semicolon-separated productive_campaigns_list (simple format)", () => {
    const prodData = [
      { so_agent_id: "S001", full_name: "Bob Smith", productive_campaigns_list: "Nations Benefits; Nations Benefits Bilingual" },
    ];
    const maps = buildProdCampaignMaps(prodData);
    expect(isInProdForCampaign(maps, "S001", "bob|smith", "Nations Benefits")).toBe(true);
    expect(isInProdForCampaign(maps, "S001", "bob|smith", "Nations Benefits Bilingual")).toBe(true);
    expect(isInProdForCampaign(maps, "S001", "bob|smith", "Some Other Campaign")).toBe(false);
  });

  it("uses SID-uppercase to match consistently", () => {
    const maps = buildProdCampaignMaps([
      { shyftoff_id: "s001", agent_nm: "Test", campaign_nm: "X" },
    ]);
    expect(isInProdForCampaign(maps, "s001", "test|test", "X")).toBe(true);
    expect(isInProdForCampaign(maps, "S001", "test|test", "X")).toBe(true);
  });

  it("falls back to name key when SID is missing", () => {
    const maps = buildProdCampaignMaps([
      { agent_nm: "Jane Doe", campaign_nm: "Nations Benefits" },
    ]);
    expect(isInProdForCampaign(maps, "", "jane|doe", "Nations Benefits")).toBe(true);
  });

  it("registers multi-part name variants", () => {
    const maps = buildProdCampaignMaps([
      { agent_nm: "Sid Toria Melton", campaign_nm: "Nations Benefits" },
    ]);
    // Both standard "sid|melton" and joined "sidtoria|melton" should be registered
    expect(isInProdForCampaign(maps, "", "sid|melton", "Nations Benefits")).toBe(true);
    expect(isInProdForCampaign(maps, "", "sidtoria|melton", "Nations Benefits")).toBe(true);
  });

  it("returns empty for unknown agent", () => {
    const maps = buildProdCampaignMaps([]);
    expect(isInProdForCampaign(maps, "S999", "unknown|user", "X")).toBe(false);
    expect(getProdCampaigns(maps, "S999", "unknown|user")).toEqual([]);
  });

  it("handles empty/null prodData", () => {
    expect(buildProdCampaignMaps(null).bySid.size).toBe(0);
    expect(buildProdCampaignMaps([]).bySid.size).toBe(0);
  });
});

describe("getProdCampaigns", () => {
  it("returns all campaigns for an agent", () => {
    const maps = buildProdCampaignMaps([
      { shyftoff_id: "S001", agent_nm: "Test", campaign_nm: "Campaign A" },
      { shyftoff_id: "S001", agent_nm: "Test", campaign_nm: "Campaign B" },
    ]);
    expect(getProdCampaigns(maps, "S001", "test|test").sort()).toEqual(["Campaign A", "Campaign B"]);
  });

  it("dedupes campaigns from SID and name-key sources", () => {
    const maps = buildProdCampaignMaps([
      { shyftoff_id: "S001", agent_nm: "Test", campaign_nm: "Same" },
    ]);
    expect(getProdCampaigns(maps, "S001", "test|test")).toEqual(["Same"]);
  });
});
