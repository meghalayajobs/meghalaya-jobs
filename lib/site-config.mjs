import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const siteConfigPath = path.join(__dirname, "..", "data", "site-config.json");

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.round(parsed);
}

function sanitizeQuickLink(link, index) {
  return {
    title: cleanString(link?.title, `Quick Link ${index + 1}`),
    description: cleanString(link?.description, ""),
    url: cleanString(link?.url, ""),
    enabled: link?.enabled !== false
  };
}

function sanitizeSource(source, index) {
  return {
    department: cleanString(source?.department, `Department ${index + 1}`),
    url: cleanString(source?.url, ""),
    limit: cleanPositiveInteger(source?.limit, 8),
    enabled: source?.enabled !== false
  };
}

export function sanitizeSiteConfig(input = {}) {
  return {
    siteName: cleanString(input.siteName, "Meghalaya Jobs 2026"),
    latestJobsUrl: cleanString(input.latestJobsUrl, "https://www.meghalayajobs.in"),
    publicBaseUrl: cleanString(
      input.publicBaseUrl,
      "https://meghalayajobs.github.io/meghalaya-jobs"
    ).replace(/\/+$/, ""),
    maxItemsPerCategory: cleanPositiveInteger(input.maxItemsPerCategory, 24),
    requestTimeoutMs: cleanPositiveInteger(input.requestTimeoutMs, 40000),
    quickLinks: Array.isArray(input.quickLinks)
      ? input.quickLinks.map(sanitizeQuickLink).filter((item) => item.title && item.url)
      : [],
    sources: Array.isArray(input.sources)
      ? input.sources.map(sanitizeSource).filter((item) => item.department && item.url)
      : []
  };
}

export async function loadSiteConfig() {
  const raw = await readFile(siteConfigPath, "utf8");
  return sanitizeSiteConfig(JSON.parse(raw));
}

export async function saveSiteConfig(config) {
  const sanitized = sanitizeSiteConfig(config);
  await mkdir(path.dirname(siteConfigPath), { recursive: true });
  await writeFile(siteConfigPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  return sanitized;
}
