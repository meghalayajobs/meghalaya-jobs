import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSiteConfig } from "./lib/site-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDirectories = [path.join(__dirname, "dist"), path.join(__dirname, "docs")];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const categoryOrder = ["recruitment", "admit_card", "result", "other_notice"];
const categoryLabels = {
  recruitment: "Recruitment",
  admit_card: "Admit Card",
  result: "Result",
  other_notice: "Other Notice"
};

const categoryKeywords = {
  recruitment: [
    "recruitment",
    "advertisement",
    "vacancy",
    "vacancies",
    "apply",
    "application",
    "applications invited",
    "appointment",
    "engagement",
    "walk-in",
    "walk in",
    "post of",
    "posts of",
    "contract basis",
    "invited for the post",
    "invites applications"
  ],
  admit_card: [
    "admit card",
    "hall ticket",
    "call letter",
    "e-admit",
    "download admit",
    "exam admit",
    "written test admit"
  ],
  result: [
    "result",
    "results",
    "merit list",
    "select list",
    "selected candidates",
    "successful candidates",
    "shortlist",
    "shortlisted",
    "marks of candidates",
    "rejection list",
    "final list"
  ],
  other_notice: [
    "notice",
    "notification",
    "press release",
    "answer key",
    "corrigendum",
    "addendum",
    "schedule",
    "interview",
    "exam date",
    "document verification"
  ]
};

const noticeKeywords = Array.from(
  new Set(
    Object.values(categoryKeywords)
      .flat()
      .concat(["notice board", "recruitment update"])
  )
);

const noisePatterns = [
  /^home$/i,
  /^about(?: us)?$/i,
  /^contact(?: us)?$/i,
  /^search$/i,
  /^login$/i,
  /^register$/i,
  /^skip to/i,
  /^back to top$/i,
  /^read more$/i,
  /^view$/i,
  /^details$/i,
  /^next$/i,
  /^previous$/i,
  /^page \d+$/i,
  /^image:/i
];

const genericTitlePatterns = [
  /^(view|download|details|open|apply)(?:\s*\([^)]*\))?$/i,
  /^click here$/i,
  /^view\s+\(\d+\s*(kb|mb)\)$/i
];

const months = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12
};

function normalizeSpace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeEntities(value) {
  const named = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'"
  };

  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function stripTags(html) {
  return normalizeSpace(
    decodeEntities(
      String(html ?? "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|li|tr|td|th|h\d|section|article|ul|ol)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function cleanUrl(value) {
  const url = new URL(value);
  url.hash = "";
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(
    (key) => url.searchParams.delete(key)
  );
  return url.href;
}

function textContainsKeyword(text, keywords) {
  const lower = String(text ?? "").toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function extractAnchors(html, pageUrl) {
  const anchors = [];
  const anchorPattern =
    /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = anchorPattern.exec(html)) !== null) {
    const href = decodeEntities(match[1] ?? match[2] ?? match[3] ?? "");
    const text = normalizeSpace(stripTags(match[4] ?? ""));
    if (!href || !text) {
      continue;
    }

    let absoluteUrl;
    try {
      absoluteUrl = new URL(href, pageUrl).href;
    } catch {
      continue;
    }

    const start = match.index;
    const end = anchorPattern.lastIndex;
    const before = stripTags(html.slice(Math.max(0, start - 520), start));
    const after = stripTags(html.slice(end, Math.min(html.length, end + 520)));

    anchors.push({
      url: absoluteUrl,
      text,
      before,
      after,
      order: start
    });
  }

  return anchors;
}

function buildUtcDate(year, month, day) {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function parseDateCandidate(candidate) {
  const value = candidate.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return buildUtcDate(year, month, day);
  }

  const separatorDate = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (separatorDate) {
    const day = Number(separatorDate[1]);
    const month = Number(separatorDate[2]);
    const rawYear = Number(separatorDate[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return buildUtcDate(year, month, day);
  }

  const monthFirst = value.match(
    /^(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})$/i
  );
  if (monthFirst) {
    const month = months[monthFirst[1].toLowerCase()];
    return buildUtcDate(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }

  const dayFirst = value.match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{4})$/i
  );
  if (dayFirst) {
    const month = months[dayFirst[2].toLowerCase()];
    return buildUtcDate(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }

  return null;
}

function detectDate(text) {
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
    /\b(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}\b/gi,
    /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+\d{4}\b/gi
  ];

  for (const pattern of patterns) {
    const matches = String(text ?? "").match(pattern);
    if (!matches) {
      continue;
    }

    for (const raw of matches) {
      const parsed = parseDateCandidate(raw);
      if (parsed && !Number.isNaN(parsed.getTime())) {
        return {
          raw,
          iso: parsed.toISOString(),
          sortValue: parsed.getTime(),
          label: formatDisplayDate(parsed)
        };
      }
    }
  }

  return null;
}

function formatDisplayDate(date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function categorizeNotice(text) {
  const lower = String(text ?? "").toLowerCase();

  if (textContainsKeyword(lower, categoryKeywords.admit_card)) {
    return "admit_card";
  }

  if (textContainsKeyword(lower, categoryKeywords.result)) {
    return "result";
  }

  if (textContainsKeyword(lower, categoryKeywords.recruitment)) {
    return "recruitment";
  }

  return "other_notice";
}

function isGenericTitle(title) {
  return genericTitlePatterns.some((pattern) => pattern.test(title.trim()));
}

function looksLikeNoticeTitle(text) {
  if (text.length < 18) {
    return false;
  }

  if (noisePatterns.some((pattern) => pattern.test(text))) {
    return false;
  }

  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 3) {
    return false;
  }

  return textContainsKeyword(text, noticeKeywords) || words >= 5;
}

function cleanTitleCandidate(text) {
  return normalizeSpace(
    String(text ?? "")
      .replace(/^[A-Za-z]>\s*/g, " ")
      .replace(/\[[^\]]*new[^\]]*\]/gi, " ")
      .replace(/\(\d+\s*(kb|mb)\)/gi, " ")
      .replace(/\b(?:new|latest)\b/gi, " ")
      .replace(/[|]+/g, " ")
      .replace(/\s+/g, " ")
  );
}

function splitTitleCandidates(text) {
  const context = cleanTitleCandidate(text)
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " | ")
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " | ")
    .replace(
      /\b(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}\b/gi,
      " | "
    )
    .replace(
      /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+\d{4}\b/gi,
      " | "
    );

  return context
    .split(/\|+/)
    .map((segment) => cleanTitleCandidate(segment))
    .filter(Boolean);
}

function scoreDerivedTitleCandidate(candidate, origin) {
  let score = 0;

  if (looksLikeNoticeTitle(candidate)) {
    score += 4;
  }

  if (textContainsKeyword(candidate, noticeKeywords)) {
    score += 4;
  }

  if (/^(recruitment|result|notice|notification|admit|advertisement|provisionally selected)/i.test(candidate)) {
    score += 2;
  }

  if (/https?:\/\//i.test(candidate)) {
    score -= 8;
  }

  if (/^[a-z]/.test(candidate)) {
    score -= 2;
  }

  if (origin === "after") {
    score += 1;
  }

  return score;
}

function finalizeDerivedTitle(candidate) {
  let title = candidate.replace(/[.:\s]+$/g, "").trim();
  title = title.replace(/\b\d{1,2}\/\d{0,2}$/g, "").trim();

  const doubledPhrase = title.match(/^(.{24,}?)\s+\1(?:\s+\d.*)?$/i);
  if (doubledPhrase) {
    title = doubledPhrase[1].trim();
  }

  const words = title.split(/\s+/);
  if (words.length >= 8 && words.length % 2 === 0) {
    const midpoint = words.length / 2;
    const firstHalf = words.slice(0, midpoint).join(" ");
    const secondHalf = words.slice(midpoint).join(" ");
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      title = firstHalf;
    }
  }

  if (/^(?:the )?post of /i.test(title)) {
    title = `Recruitment for ${title.toLowerCase().startsWith("the ") ? title : `the ${title}`}`;
  }

  if (/^[a-z]/.test(title)) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return title;
}

function deriveTitleFromContext(anchor) {
  const candidates = [
    ...splitTitleCandidates(anchor.before).slice(-4).map((candidate) => ({
      candidate,
      origin: "before"
    })),
    ...splitTitleCandidates(anchor.after).slice(0, 4).map((candidate) => ({
      candidate,
      origin: "after"
    }))
  ].filter(({ candidate }) => !isGenericTitle(candidate));

  let best = null;
  for (const entry of candidates) {
    const score = scoreDerivedTitleCandidate(entry.candidate, entry.origin);
    if (!best || score > best.score) {
      best = {
        score,
        candidate: entry.candidate
      };
    }
  }

  if (best && best.score >= 4) {
    return finalizeDerivedTitle(best.candidate);
  }

  return null;
}

function scoreAnchor(anchor, source) {
  const combined = `${anchor.text} ${anchor.before} ${anchor.after}`.toLowerCase();
  let score = 0;

  if (noisePatterns.some((pattern) => pattern.test(anchor.text))) {
    score -= 10;
  }

  if (cleanUrl(anchor.url) === cleanUrl(source.url)) {
    score -= 8;
  }

  if (/^(javascript:|mailto:|tel:)/i.test(anchor.url)) {
    score -= 20;
  }

  if (/\.(pdf|doc|docx|xls|xlsx|zip)(?:$|[?#])/i.test(anchor.url)) {
    score += 5;
  }

  if (textContainsKeyword(combined, noticeKeywords)) {
    score += 4;
  }

  if (anchor.text.length >= 22) {
    score += 1;
  }

  if (detectDate(`${anchor.text} ${anchor.after}`)) {
    score += 2;
  }

  if (/facebook|twitter|instagram|youtube|whatsapp/i.test(anchor.url)) {
    score -= 20;
  }

  if (/privacy policy|copyright|tender|gallery|site map|sitemap|faq/i.test(anchor.text)) {
    score -= 8;
  }

  return score;
}

function dedupeNotices(items) {
  const seen = new Map();

  for (const item of items) {
    const key = [
      item.department.toLowerCase(),
      item.title.toLowerCase(),
      item.publishedAt ?? ""
    ].join("|");
    const existing = seen.get(key);
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
      seen.set(key, item);
    }
  }

  return Array.from(seen.values());
}

async function fetchSource(source, siteConfig) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), siteConfig.requestTimeoutMs);

  try {
    const response = await fetch(source.url, {
      headers: {
        "user-agent": USER_AGENT,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-IN,en;q=0.9"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractNoticesFromHtml(source, html) {
  const anchors = extractAnchors(html, source.url);
  const notices = [];

  for (const anchor of anchors) {
    const score = scoreAnchor(anchor, source);
    if (score < 5) {
      continue;
    }

    const rawTitle = normalizeSpace(anchor.text);
    const title = isGenericTitle(rawTitle) ? deriveTitleFromContext(anchor) ?? rawTitle : rawTitle;
    if (title.length < 10 || isGenericTitle(title)) {
      continue;
    }

    const published =
      detectDate(anchor.after) ??
      detectDate(anchor.text) ??
      detectDate(`${anchor.before} ${anchor.after}`);

    notices.push({
      department: source.department,
      sourceUrl: source.url,
      url: cleanUrl(anchor.url),
      title,
      category: categorizeNotice(title),
      publishedAt: published?.iso ?? null,
      publishedLabel: published?.label ?? "Latest",
      sortValue: published?.sortValue ?? 0,
      score,
      context: normalizeSpace(`${anchor.before} ${anchor.after}`)
    });
  }

  return dedupeNotices(notices)
    .sort((left, right) => {
      if (right.sortValue !== left.sortValue) {
        return right.sortValue - left.sortValue;
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.title.localeCompare(right.title);
    })
    .slice(0, source.limit ?? 8);
}

async function collectNotices(siteConfig) {
  const allNotices = [];
  const failedSources = [];
  const activeSources = siteConfig.sources.filter((source) => source.enabled !== false);

  for (const source of activeSources) {
    try {
      const html = await fetchSource(source, siteConfig);
      const notices = extractNoticesFromHtml(source, html);
      allNotices.push(...notices);
      console.log(`${source.department}: ${notices.length} notices`);
    } catch (error) {
      failedSources.push({
        department: source.department,
        url: source.url,
        reason: error.message
      });
      console.warn(`${source.department}: failed (${error.message})`);
    }
  }

  const deduped = dedupeNotices(allNotices);
  const grouped = Object.fromEntries(
    categoryOrder.map((category) => [
      category,
      deduped
        .filter((item) => item.category === category)
        .sort((left, right) => {
          if (right.sortValue !== left.sortValue) {
            return right.sortValue - left.sortValue;
          }
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          return left.department.localeCompare(right.department);
        })
        .slice(0, siteConfig.maxItemsPerCategory)
    ])
  );

  return {
    grouped,
    failedSources,
    activeSources
  };
}

function buildStyles() {
  return `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap');

.mjg-shell,
.mjg-shell * {
  box-sizing: border-box;
}

.mjg-shell {
  --mjg-ink: #10233b;
  --mjg-muted: #5d6c80;
  --mjg-accent: #0d5ea8;
  --mjg-accent-dark: #083b6d;
  --mjg-success: #15803d;
  --mjg-paper: #ffffff;
  --mjg-line: #d7e3ef;
  --mjg-soft: #eef6ff;
  --mjg-warm: #fff7ea;
  --mjg-shadow: 0 18px 42px rgba(16, 35, 59, 0.1);
  margin: 0 auto;
  max-width: 1180px;
  padding: 18px 12px 34px;
  color: var(--mjg-ink);
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at top left, rgba(13, 94, 168, 0.14), transparent 28%),
    radial-gradient(circle at bottom right, rgba(21, 128, 61, 0.12), transparent 26%),
    linear-gradient(180deg, #f7fbff 0%, #edf4fb 100%);
  border-radius: 28px;
}

.mjg-hero {
  position: relative;
  overflow: hidden;
  border-radius: 24px;
  padding: 28px 22px;
  background:
    radial-gradient(circle at 16% 12%, rgba(255, 255, 255, 0.14), transparent 16%),
    linear-gradient(135deg, #083b6d 0%, #0d5ea8 54%, #1577c7 100%);
  color: #f8fbff;
  box-shadow: 0 24px 56px rgba(16, 35, 59, 0.16);
}

.mjg-hero::after {
  content: "";
  position: absolute;
  width: 240px;
  height: 240px;
  right: -90px;
  bottom: -96px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.07);
}

.mjg-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  padding: 7px 14px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mjg-hero h2 {
  margin: 0;
  font-family: "Space Grotesk", "Segoe UI", sans-serif;
  font-size: clamp(28px, 5vw, 46px);
  line-height: 1;
}

.mjg-hero p {
  margin: 14px 0 0;
  max-width: 780px;
  font-size: 15px;
  line-height: 1.7;
  color: rgba(248, 251, 255, 0.9);
}

.mjg-meta {
  margin-top: 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.mjg-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #f8fbff;
  font-size: 13px;
}

.mjg-stack {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.mjg-card,
.mjg-section {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--mjg-line);
  border-radius: 22px;
  box-shadow: var(--mjg-shadow);
}

.mjg-card {
  padding: 18px;
}

.mjg-card h3,
.mjg-section-head h3 {
  margin: 0;
  font-family: "Space Grotesk", "Segoe UI", sans-serif;
  color: var(--mjg-accent-dark);
}

.mjg-card h3 {
  margin-bottom: 12px;
  font-size: 22px;
}

.mjg-summary-grid,
.mjg-quick-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.mjg-summary-card,
.mjg-quick-card {
  border-radius: 18px;
  border: 1px solid var(--mjg-line);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 1) 0%, rgba(247, 251, 255, 1) 100%);
  padding: 16px;
  text-decoration: none;
  color: inherit;
}

.mjg-summary-label,
.mjg-quick-title {
  display: block;
  font-size: 13px;
}

.mjg-summary-label {
  color: var(--mjg-muted);
}

.mjg-summary-value {
  display: block;
  margin-top: 8px;
  font-size: 30px;
  line-height: 1;
  color: var(--mjg-accent-dark);
}

.mjg-quick-title {
  font-family: "Space Grotesk", "Segoe UI", sans-serif;
  font-size: 18px;
  color: var(--mjg-accent-dark);
}

.mjg-quick-text {
  display: block;
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--mjg-muted);
}

.mjg-alert {
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid #f1cf8a;
  background: var(--mjg-warm);
  color: #7a4d00;
  font-size: 14px;
  line-height: 1.6;
}

.mjg-section {
  overflow: hidden;
}

.mjg-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 0;
}

.mjg-section-head h3 {
  font-size: 23px;
}

.mjg-count {
  color: var(--mjg-muted);
  font-size: 13px;
}

.mjg-table-wrap {
  overflow-x: auto;
  padding: 16px 18px 18px;
}

.mjg-table {
  width: 100%;
  border-collapse: collapse;
  background: #ffffff;
}

.mjg-table th {
  padding: 13px 12px;
  background: #eaf4ff;
  color: var(--mjg-accent-dark);
  text-align: left;
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-bottom: 1px solid var(--mjg-line);
}

.mjg-table td {
  padding: 13px 12px;
  font-size: 14px;
  line-height: 1.6;
  border-bottom: 1px solid #edf2f7;
  vertical-align: top;
}

.mjg-table tbody tr:hover {
  background: #f7fbff;
}

.mjg-link {
  color: var(--mjg-accent);
  font-weight: 600;
  text-decoration: none;
  word-break: break-word;
}

.mjg-link:hover {
  text-decoration: underline;
}

.mjg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 74px;
  padding: 8px 13px;
  border-radius: 999px;
  background: var(--mjg-success);
  color: #ffffff !important;
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
}

.mjg-empty {
  text-align: center;
  color: var(--mjg-muted);
}

.mjg-foot {
  margin: 0;
  color: var(--mjg-muted);
  font-size: 13px;
  line-height: 1.7;
}

@media (max-width: 820px) {
  .mjg-shell {
    padding: 12px 8px 24px;
    border-radius: 18px;
  }

  .mjg-hero {
    padding: 20px 16px;
    border-radius: 18px;
  }

  .mjg-card,
  .mjg-section {
    border-radius: 18px;
  }

  .mjg-section-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .mjg-table-wrap {
    padding: 12px;
  }

  .mjg-table,
  .mjg-table thead,
  .mjg-table tbody,
  .mjg-table tr,
  .mjg-table td {
    display: block;
    width: 100%;
  }

  .mjg-table thead {
    display: none;
  }

  .mjg-table tbody {
    display: grid;
    gap: 12px;
  }

  .mjg-table tr {
    border: 1px solid var(--mjg-line);
    border-radius: 16px;
    background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
    padding: 10px 12px;
    box-shadow: 0 10px 22px rgba(16, 35, 59, 0.06);
  }

  .mjg-table td {
    border: 0;
    padding: 8px 0;
  }

  .mjg-table td::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 5px;
    color: var(--mjg-muted);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .mjg-btn {
    width: 100%;
  }
}
  `.trim();
}

function renderQuickLinks(siteConfig) {
  const quickLinks = siteConfig.quickLinks.filter((item) => item.enabled !== false);
  return `
    <div class="mjg-quick-grid">
      ${quickLinks
        .map(
          (link) => `
            <a class="mjg-quick-card" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
              <span class="mjg-quick-title">${escapeHtml(link.title)}</span>
              <span class="mjg-quick-text">${escapeHtml(link.description)}</span>
            </a>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSummaryCards(grouped, sourceCount) {
  return `
    <div class="mjg-summary-grid">
      ${categoryOrder
        .map(
          (category) => `
            <div class="mjg-summary-card">
              <span class="mjg-summary-label">${categoryLabels[category]}</span>
              <strong class="mjg-summary-value">${grouped[category].length}</strong>
            </div>
          `
        )
        .join("")}
      <div class="mjg-summary-card">
        <span class="mjg-summary-label">Official Sites Tracked</span>
        <strong class="mjg-summary-value">${sourceCount}</strong>
      </div>
    </div>
  `;
}

function renderTableRows(items) {
  if (!items.length) {
    return `
      <tr>
        <td colspan="4" class="mjg-empty">No notices were detected during this refresh.</td>
      </tr>
    `;
  }

  return items
    .map(
      (item) => `
        <tr>
          <td data-label="Department">${escapeHtml(item.department)}</td>
          <td data-label="Notice">
            <a class="mjg-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(item.title)}
            </a>
          </td>
          <td data-label="Published">${escapeHtml(item.publishedLabel)}</td>
          <td data-label="Action">
            <a class="mjg-btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">View</a>
          </td>
        </tr>
      `
    )
    .join("");
}

function renderCategorySection(category, items) {
  return `
    <section class="mjg-section">
      <div class="mjg-section-head">
        <h3>${categoryLabels[category]}</h3>
        <span class="mjg-count">${items.length} updates</span>
      </div>
      <div class="mjg-table-wrap">
        <table class="mjg-table">
          <thead>
            <tr>
              <th>Department</th>
              <th>Notice</th>
              <th>Published</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${renderTableRows(items)}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderFailedSources(failedSources) {
  if (!failedSources.length) {
    return "";
  }

  return `
    <div class="mjg-alert">
      Some official sources could not be fetched during the last refresh:
      ${failedSources.map((item) => escapeHtml(item.department)).join(", ")}.
    </div>
  `;
}

function renderAppMarkup({ grouped, failedSources, generatedAt, siteConfig, sourceCount }) {
  const generatedLabel = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  }).format(generatedAt);

  return `
<div class="mjg-shell">
  <section class="mjg-hero">
    <div class="mjg-kicker">Official Meghalaya Job Watch</div>
    <h2>${escapeHtml(siteConfig.siteName)}</h2>
    <p>
      This page collects notice links from official Meghalaya government and department websites,
      then arranges them into Recruitment, Admit Card, Result, and Other Notice.
      Every link opens the official source, so candidates can verify dates, eligibility, and instructions directly.
    </p>
    <div class="mjg-meta">
      <span class="mjg-chip">Last refreshed: ${escapeHtml(generatedLabel)}</span>
      <span class="mjg-chip">Official links only</span>
      <span class="mjg-chip">
        <a href="${escapeHtml(siteConfig.latestJobsUrl)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;">
          Visit MeghalayaJobs.in
        </a>
      </span>
    </div>
  </section>

  <div class="mjg-stack">
    <section class="mjg-card">
      <h3>Quick Links</h3>
      ${renderQuickLinks(siteConfig)}
    </section>

    <section class="mjg-card">
      <h3>Live Summary</h3>
      ${renderSummaryCards(grouped, sourceCount)}
    </section>

    ${renderFailedSources(failedSources)}

    ${categoryOrder.map((category) => renderCategorySection(category, grouped[category])).join("")}

    <p class="mjg-foot">
      Generated automatically from official Meghalaya source pages. If a department changes its website layout,
      that source may need a small rule update in the admin panel or config file.
    </p>
  </div>
</div>
  `.trim();
}

function renderStaticSnippet(payload) {
  return `
<style>
${buildStyles()}
</style>
${renderAppMarkup(payload)}
  `.trim();
}

function buildWidgetScript(staticSnippet) {
  return `
(() => {
  const html = ${JSON.stringify(staticSnippet)};

  function mount(target) {
    if (!target || target.dataset.mjgMounted === "true") {
      return;
    }

    target.innerHTML = html;
    target.dataset.mjgMounted = "true";
  }

  function bootstrap() {
    const targets = document.querySelectorAll("[data-meghalaya-jobs-widget]");
    if (targets.length) {
      targets.forEach(mount);
      return;
    }

    const script = document.currentScript;
    if (!script || !script.parentNode) {
      return;
    }

    const fallbackTarget = document.createElement("div");
    fallbackTarget.setAttribute("data-meghalaya-jobs-widget", "");
    script.parentNode.insertBefore(fallbackTarget, script);
    mount(fallbackTarget);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
  `.trim();
}

function renderBloggerLiveSnippet(siteConfig, staticSnippet) {
  return `
<div data-meghalaya-jobs-widget>
${staticSnippet}
</div>
<script defer src="${escapeHtml(siteConfig.publicBaseUrl)}/meghalaya-jobs-widget.js"></script>
<noscript>
  <p>
    Meghalaya jobs widget requires JavaScript. Open
    <a href="${escapeHtml(siteConfig.publicBaseUrl)}" target="_blank" rel="noopener noreferrer">the live jobs page</a>.
  </p>
</noscript>
  `.trim();
}

function renderPreviewDocument(title, body, background = "#e8f0f7") {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:24px;background:${background};">
    ${body}
  </body>
</html>
  `.trim();
}

function renderPagesIndex(siteConfig, staticSnippet) {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(siteConfig.siteName)} Live Widget</title>
  </head>
  <body style="margin:0;padding:24px;background:#e8f0f7;">
    <div data-meghalaya-jobs-widget>${staticSnippet}</div>
    <script defer src="./meghalaya-jobs-widget.js"></script>
  </body>
</html>
  `.trim();
}

function renderSnippetHelpDocument(siteConfig, snippet) {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(siteConfig.siteName)} Blogger Live Snippet</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        font-family: "Segoe UI", sans-serif;
        background: #eef5fb;
        color: #10233b;
      }

      .box {
        max-width: 980px;
        margin: 0 auto;
        padding: 22px;
        border-radius: 20px;
        background: #fff;
        box-shadow: 0 18px 42px rgba(16, 35, 59, 0.1);
      }

      h1 {
        margin-top: 0;
      }

      pre {
        overflow: auto;
        padding: 16px;
        border-radius: 14px;
        background: #0f172a;
        color: #dbeafe;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .note {
        padding: 14px 16px;
        border-radius: 14px;
        background: #fff7ea;
        color: #7a4d00;
      }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>Blogger Live Snippet</h1>
      <p>
        This file is a Blogger embed snippet, not a standalone preview page.
        Paste the code below into Blogger HTML view.
      </p>
      <div class="note">
        For local preview use <strong>dist/meghalaya-jobs-live-local-preview.html</strong> or <strong>docs/index.html</strong>.
        For the live Blogger widget to work, GitHub Pages must be deployed at
        <strong>${escapeHtml(siteConfig.publicBaseUrl)}</strong>.
      </div>
      <pre>${escapeHtml(snippet)}</pre>
    </div>
  </body>
</html>
  `.trim();
}

async function writeOutputs(files) {
  for (const outputDirectory of outputDirectories) {
    await mkdir(outputDirectory, { recursive: true });
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(path.join(outputDirectory, name), contents, "utf8");
    }
  }
}

async function main() {
  const siteConfig = await loadSiteConfig();
  const generatedAt = new Date();
  const { grouped, failedSources, activeSources } = await collectNotices(siteConfig);

  const payload = {
    grouped,
    failedSources,
    generatedAt,
    siteConfig,
    sourceCount: activeSources.length
  };

  const staticSnippet = renderStaticSnippet(payload);
  const bloggerLiveSnippet = renderBloggerLiveSnippet(siteConfig, staticSnippet);
  const widgetScript = buildWidgetScript(staticSnippet);
  const preview = renderPreviewDocument("Meghalaya Jobs Preview", staticSnippet);
  const localLivePreview = renderPreviewDocument(
    "Meghalaya Jobs Live Local Preview",
    `<div data-meghalaya-jobs-widget></div><script defer src="./meghalaya-jobs-widget.js"></script>`
  );
  const bloggerLiveHelp = renderSnippetHelpDocument(siteConfig, bloggerLiveSnippet);
  const pagesIndex = renderPagesIndex(siteConfig, staticSnippet);
  const dataJson = `${JSON.stringify(
    {
      generatedAt: generatedAt.toISOString(),
      generatedAtLabel: new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata"
      }).format(generatedAt),
      siteName: siteConfig.siteName,
      latestJobsUrl: siteConfig.latestJobsUrl,
      publicBaseUrl: siteConfig.publicBaseUrl,
      counts: Object.fromEntries(
        categoryOrder.map((category) => [category, grouped[category].length])
      ),
      sourceCount: activeSources.length,
      grouped,
      failedSources,
      sources: activeSources
    },
    null,
    2
  )}\n`;

  await writeOutputs({
    "meghalaya-jobs-blogger.html": staticSnippet,
    "meghalaya-jobs-blogger-live.html": bloggerLiveSnippet,
    "meghalaya-jobs-blogger-live-help.html": bloggerLiveHelp,
    "meghalaya-jobs-live-local-preview.html": localLivePreview,
    "meghalaya-jobs-preview.html": preview,
    "meghalaya-jobs-widget.js": `${widgetScript}\n`,
    "meghalaya-jobs-data.json": dataJson,
    "index.html": pagesIndex,
    ".nojekyll": ""
  });

  console.log("\nGenerated files in dist/ and docs/:");
  console.log("- meghalaya-jobs-blogger.html");
  console.log("- meghalaya-jobs-blogger-live.html");
  console.log("- meghalaya-jobs-blogger-live-help.html");
  console.log("- meghalaya-jobs-live-local-preview.html");
  console.log("- meghalaya-jobs-preview.html");
  console.log("- meghalaya-jobs-widget.js");
  console.log("- meghalaya-jobs-data.json");
  console.log("- index.html");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
