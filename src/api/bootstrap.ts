import { DATA_API_BASE_URL, ENTRY_ORIGIN, USER_AGENT } from "../config/site.js";

type SiteBootstrap = {
  digit: string;
  dataApiBaseUrl: string;
  entryOrigin: string;
};

let cached: SiteBootstrap | null = null;

export async function loadSiteBootstrap(): Promise<SiteBootstrap> {
  if (cached) return cached;
  cached = {
    digit: "foth",
    dataApiBaseUrl: DATA_API_BASE_URL,
    entryOrigin: ENTRY_ORIGIN,
  };
  return cached;
}
