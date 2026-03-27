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
const displayCategoryOrder = ["recruitment", "result", "admit_card"];
const recentWindowDays = 15;
const resultPageWindowDays = 30;
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

function extractTableRowNotices(html, source) {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const notices = [];

  for (const rowHtml of rows) {
    const cells = Array.from(rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(
      (match) => stripTags(match[1] ?? "")
    );

    if (cells.length < 2) {
      continue;
    }

    const anchors = extractAnchors(rowHtml, source.url).filter((anchor) =>
      /\.(pdf|doc|docx|xls|xlsx|zip)(?:$|[?#])/i.test(anchor.url)
    );

    if (!anchors.length) {
      continue;
    }

    const title = normalizeSpace(cells[0]);
    const description = normalizeSpace(cells[1]);
    if (!title || isGenericTitle(title) || noisePatterns.some((pattern) => pattern.test(title))) {
      continue;
    }

    const published =
      detectDate(cells.slice(2).join(" ")) ??
      detectDate(`${title} ${description}`) ??
      detectDate(stripTags(rowHtml));

    const link = anchors[0];
    notices.push({
      department: source.department,
      sourceUrl: source.url,
      url: cleanUrl(link.url),
      title,
      category: categorizeNotice(`${title} ${description}`),
      publishedAt: published?.iso ?? null,
      publishedLabel: published?.label ?? "Latest",
      sortValue: published?.sortValue ?? 0,
      score: 40,
      context: normalizeSpace(`${description} ${cells.slice(2).join(" ")}`)
    });
  }

  return notices;
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
    const key = [item.department.toLowerCase(), item.url.toLowerCase()].join("|");
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
  const rowNotices = extractTableRowNotices(html, source);
  const anchors = extractAnchors(html, source.url);
  const notices = [...rowNotices];

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

function filterRecentItems(items, generatedAt, dayWindow = recentWindowDays) {
  const threshold = generatedAt.getTime() - dayWindow * 24 * 60 * 60 * 1000;
  return items.filter((item) => item.sortValue && item.sortValue >= threshold);
}

function buildDisplayGrouped(grouped, generatedAt, siteConfig) {
  return Object.fromEntries(
    displayCategoryOrder.map((category) => [
      category,
      filterRecentItems(grouped[category] ?? [], generatedAt).slice(0, siteConfig.maxItemsPerCategory)
    ])
  );
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
  width: 100%;
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

.mjg-quick-grid,
.mjg-tab-nav {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scrollbar-width: thin;
  scroll-behavior: smooth;
  scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
  touch-action: pan-x;
  padding: 2px 2px 6px;
  margin: 0 -2px;
}

.mjg-quick-grid::-webkit-scrollbar,
.mjg-tab-nav::-webkit-scrollbar {
  height: 6px;
}

.mjg-quick-grid::-webkit-scrollbar-thumb,
.mjg-tab-nav::-webkit-scrollbar-thumb {
  background: rgba(13, 94, 168, 0.22);
  border-radius: 999px;
}

.mjg-quick-card,
.mjg-tab-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  border-radius: 999px;
  border: 1px solid var(--mjg-line);
  background: linear-gradient(180deg, #ffffff 0%, #f7fbff 100%);
  padding: 10px 14px;
  text-decoration: none;
  color: var(--mjg-accent-dark);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  scroll-snap-align: start;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.mjg-quick-card:hover,
.mjg-tab-btn:hover {
  border-color: rgba(13, 94, 168, 0.28);
  box-shadow: 0 10px 18px rgba(13, 94, 168, 0.08);
  transform: translateY(-1px);
}

.mjg-quick-title {
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  font-size: 13px;
  color: var(--mjg-accent-dark);
}

.mjg-quick-text {
  display: none;
}

.mjg-tabs {
  display: grid;
  gap: 14px;
}

.mjg-tab-toggle {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.mjg-tab-btn {
  cursor: pointer;
}

.mjg-tab-badge {
  margin-left: 8px;
  min-width: 22px;
  padding: 2px 7px;
  border-radius: 999px;
  background: #eaf4ff;
  color: var(--mjg-accent);
  font-size: 12px;
}

.mjg-tab-panel {
  display: none;
}

#mjg-tab-recruitment:checked ~ .mjg-tab-nav label[for="mjg-tab-recruitment"],
#mjg-tab-result:checked ~ .mjg-tab-nav label[for="mjg-tab-result"],
#mjg-tab-admit_card:checked ~ .mjg-tab-nav label[for="mjg-tab-admit_card"] {
  background: linear-gradient(135deg, #083b6d 0%, #0d5ea8 100%);
  border-color: transparent;
  color: #ffffff;
}

#mjg-tab-recruitment:checked ~ .mjg-tab-nav label[for="mjg-tab-recruitment"] .mjg-tab-badge,
#mjg-tab-result:checked ~ .mjg-tab-nav label[for="mjg-tab-result"] .mjg-tab-badge,
#mjg-tab-admit_card:checked ~ .mjg-tab-nav label[for="mjg-tab-admit_card"] .mjg-tab-badge {
  background: rgba(255, 255, 255, 0.16);
  color: #ffffff;
}

#mjg-tab-recruitment:checked ~ .mjg-tab-panels .mjg-panel-recruitment,
#mjg-tab-result:checked ~ .mjg-tab-panels .mjg-panel-result,
#mjg-tab-admit_card:checked ~ .mjg-tab-panels .mjg-panel-admit_card {
  display: block;
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
  font-size: 21px;
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
  padding: 11px 12px;
  font-size: 13px;
  line-height: 1.5;
  border-bottom: 1px solid #edf2f7;
  vertical-align: top;
}

.mjg-cell-department {
  width: 180px;
}

.mjg-department-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 5px 10px;
  background: #eef6ff;
  color: var(--mjg-accent-dark);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.mjg-cell-notice .mjg-link {
  display: inline-block;
  font-size: 14px;
  line-height: 1.45;
}

.mjg-cell-date {
  width: 110px;
}

.mjg-date {
  color: var(--mjg-accent-dark);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.mjg-cell-action {
  width: 88px;
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
  min-width: 62px;
  padding: 7px 11px;
  border-radius: 999px;
  background: var(--mjg-success);
  color: #ffffff !important;
  text-decoration: none;
  font-size: 12px;
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
    width: 100vw;
    max-width: 100vw;
    margin-left: calc(50% - 50vw);
    margin-right: calc(50% - 50vw);
    padding: 0 0 18px;
    border-radius: 0;
    background: transparent;
  }

  .mjg-hero {
    padding: 18px 14px 16px;
    border-radius: 0 0 18px 18px;
  }

  .mjg-hero h2 {
    font-size: clamp(24px, 8vw, 34px);
    line-height: 1.02;
  }

  .mjg-hero p {
    font-size: 13px;
    line-height: 1.55;
  }

  .mjg-card,
  .mjg-section {
    border-radius: 18px;
  }

  .mjg-section-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .mjg-meta {
    gap: 8px;
  }

  .mjg-chip {
    padding: 7px 10px;
    font-size: 12px;
  }

  .mjg-stack {
    gap: 12px;
    margin-top: 12px;
    padding: 0 8px;
  }

  .mjg-card {
    padding: 12px;
  }

  .mjg-quick-card,
  .mjg-tab-btn {
    min-height: 36px;
    padding: 8px 11px;
    font-size: 12px;
  }

  .mjg-tab-badge {
    margin-left: 6px;
    padding: 2px 6px;
    font-size: 11px;
  }

  .mjg-quick-grid,
  .mjg-tab-nav {
    gap: 8px;
    padding: 0 2px 2px;
    margin: 0;
    scroll-padding-inline: 10px;
  }

  .mjg-section-head {
    padding: 14px 14px 0;
    gap: 6px;
  }

  .mjg-section-head h3 {
    font-size: 18px;
  }

  .mjg-count {
    font-size: 12px;
  }

  .mjg-table-wrap {
    padding: 8px;
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
    gap: 8px;
  }

  .mjg-table tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "department date"
      "notice notice"
      "action action";
    gap: 6px 10px;
    border: 1px solid var(--mjg-line);
    border-radius: 16px;
    background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
    padding: 10px;
    box-shadow: 0 8px 18px rgba(16, 35, 59, 0.05);
  }

  .mjg-table td {
    border: 0;
    padding: 0;
  }

  .mjg-table td::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 3px;
    color: var(--mjg-muted);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .mjg-cell::before {
    display: none;
  }

  .mjg-cell-department {
    grid-area: department;
    width: auto;
  }

  .mjg-cell-notice {
    grid-area: notice;
  }

  .mjg-cell-notice .mjg-link {
    font-size: 13px;
  }

  .mjg-cell-date {
    grid-area: date;
    width: auto;
    text-align: right;
  }

  .mjg-date {
    font-size: 11px;
  }

  .mjg-cell-action {
    grid-area: action;
    width: auto;
    padding-top: 2px;
  }

  .mjg-department-tag {
    padding: 4px 9px;
    font-size: 10px;
  }

  .mjg-btn {
    width: auto;
    min-width: 52px;
    padding: 7px 10px;
    font-size: 11px;
  }

  .mjg-foot {
    padding: 0 10px;
    font-size: 12px;
  }
}
  `.trim();
}

function renderTableRows(items, dayWindow = recentWindowDays) {
  if (!items.length) {
    return `
      <tr>
        <td colspan="4" class="mjg-empty">No updates found in the last ${dayWindow} days.</td>
      </tr>
    `;
  }

  return items
    .map(
      (item) => `
        <tr>
          <td class="mjg-cell mjg-cell-department" data-label="Department">
            <span class="mjg-department-tag">${escapeHtml(item.department)}</span>
          </td>
          <td class="mjg-cell mjg-cell-notice" data-label="Notice">
            <a class="mjg-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(item.title)}
            </a>
          </td>
          <td class="mjg-cell mjg-cell-date" data-label="Published">
            <span class="mjg-date">${escapeHtml(item.publishedLabel)}</span>
          </td>
          <td class="mjg-cell mjg-cell-action" data-label="Action">
            <a class="mjg-btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">View</a>
          </td>
        </tr>
      `
    )
    .join("");
}

function renderTabbedSections(grouped) {
  return `
    <div class="mjg-tabs">
      ${displayCategoryOrder
        .map(
          (category, index) => `
            <input class="mjg-tab-toggle" type="radio" name="mjg-tabset" id="mjg-tab-${category}" ${
              index === 0 ? "checked" : ""
            } />
          `
        )
        .join("")}

      <div class="mjg-tab-nav" role="tablist" aria-label="Latest job updates">
        ${displayCategoryOrder
          .map(
            (category) => `
              <label class="mjg-tab-btn" for="mjg-tab-${category}">
                ${categoryLabels[category]}
                <span class="mjg-tab-badge">${grouped[category].length}</span>
              </label>
            `
          )
          .join("")}
      </div>

      <div class="mjg-tab-panels">
        ${displayCategoryOrder
          .map(
            (category) => `
              <div class="mjg-tab-panel mjg-panel-${category}">
                ${renderCategorySection(category, grouped[category])}
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderCategorySection(category, items, dayWindow = recentWindowDays) {
  return `
    <section class="mjg-section">
      <div class="mjg-section-head">
        <h3>${categoryLabels[category]}</h3>
        <span class="mjg-count">${items.length} in last ${dayWindow} days</span>
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
            ${renderTableRows(items, dayWindow)}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAutoRefreshLoader(
  scriptUrl,
  {
    widgetAttribute = "data-meghalaya-jobs-widget",
    scriptId = "mjg-remote-script"
  } = {}
) {
  return `
<script>
  (function () {
    var src = ${JSON.stringify(scriptUrl)};
    var widgetSelector = ${JSON.stringify(`[${widgetAttribute}]`)};
    var scriptId = ${JSON.stringify(scriptId)};
    function reloadWidget() {
      var target = document.querySelector(widgetSelector);
      if (target) {
        target.dataset.mjgMounted = 'false';
      }

      var oldScript = document.getElementById(scriptId);
      if (oldScript) {
        oldScript.remove();
      }

      var script = document.createElement('script');
      script.id = scriptId;
      script.defer = true;
      script.src = src + (src.indexOf('?') === -1 ? '?' : '&') + 'v=' + Date.now();
      document.body.appendChild(script);
    }

    reloadWidget();
    window.setInterval(reloadWidget, 900000);
  })();
</script>
  `.trim();
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

function formatGeneratedLabel(generatedAt) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  }).format(generatedAt);
}

function renderAppMarkup({ grouped, failedSources, generatedAt, siteConfig }) {
  const generatedLabel = formatGeneratedLabel(generatedAt);

  return `
<div class="mjg-shell">
  <section class="mjg-hero">
    <div class="mjg-kicker">Official Meghalaya Job Watch</div>
    <h2>${escapeHtml(siteConfig.siteName)}</h2>
    <p>
      Latest Meghalaya job updates from official government websites.
      Recruitment, Result, and Admit Card tabs below show only the last ${recentWindowDays} days in a mobile-friendly live layout.
    </p>
    <div class="mjg-meta">
      <span class="mjg-chip">Last refreshed: ${escapeHtml(generatedLabel)}</span>
      <span class="mjg-chip">Official links only</span>
      <span class="mjg-chip">Showing last ${recentWindowDays} days</span>
      <span class="mjg-chip">Auto updates every hour</span>
    </div>
  </section>

  <div class="mjg-stack">
    ${renderFailedSources(failedSources)}

    ${renderTabbedSections(grouped)}

    <p class="mjg-foot">
      Generated automatically from official Meghalaya source pages. If a department changes its website layout,
      that source may need a small rule update in the admin panel or config file.
    </p>
  </div>
</div>
  `.trim();
}

function renderSingleCategoryAppMarkup({
  category,
  items,
  failedSources,
  generatedAt,
  siteConfig,
  pageTitle,
  description,
  dayWindow = recentWindowDays
}) {
  const generatedLabel = formatGeneratedLabel(generatedAt);

  return `
<div class="mjg-shell">
  <section class="mjg-hero">
    <div class="mjg-kicker">Official Meghalaya ${escapeHtml(categoryLabels[category])} Watch</div>
    <h2>${escapeHtml(pageTitle)}</h2>
    <p>${escapeHtml(description)}</p>
    <div class="mjg-meta">
      <span class="mjg-chip">Last refreshed: ${escapeHtml(generatedLabel)}</span>
      <span class="mjg-chip">Official links only</span>
      <span class="mjg-chip">${escapeHtml(categoryLabels[category])} only</span>
      <span class="mjg-chip">Showing last ${dayWindow} days</span>
      <span class="mjg-chip">Auto updates every hour</span>
    </div>
  </section>

  <div class="mjg-stack">
    ${renderFailedSources(failedSources)}

    ${renderCategorySection(category, items, dayWindow)}

    <p class="mjg-foot">
      Generated automatically from official Meghalaya source pages. This page shows only
      ${escapeHtml(categoryLabels[category].toLowerCase())} notices from the latest ${dayWindow} days.
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

function renderSingleCategoryStaticSnippet(payload) {
  return `
<style>
${buildStyles()}
</style>
${renderSingleCategoryAppMarkup(payload)}
  `.trim();
}

function buildWidgetScript(staticSnippet, widgetAttribute = "data-meghalaya-jobs-widget") {
  return `
(() => {
  const html = ${JSON.stringify(staticSnippet)};
  const selector = "[${widgetAttribute}]";

  function mount(target) {
    if (!target || target.dataset.mjgMounted === "true") {
      return;
    }

    target.innerHTML = html;
    target.dataset.mjgMounted = "true";
  }

  function bootstrap() {
    const targets = document.querySelectorAll(selector);
    if (targets.length) {
      targets.forEach(mount);
      return;
    }

    const script = document.currentScript;
    if (!script || !script.parentNode) {
      return;
    }

    const fallbackTarget = document.createElement("div");
    fallbackTarget.setAttribute(${JSON.stringify(widgetAttribute)}, "");
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

function renderBloggerLiveSnippet(
  siteConfig,
  staticSnippet,
  {
    widgetAttribute = "data-meghalaya-jobs-widget",
    widgetScriptUrl = `${siteConfig.publicBaseUrl}/meghalaya-jobs-widget.js`,
    livePageUrl = siteConfig.publicBaseUrl,
    scriptId = "mjg-remote-script"
  } = {}
) {
  return `
<div ${widgetAttribute}>
${staticSnippet}
</div>
${renderAutoRefreshLoader(widgetScriptUrl, { widgetAttribute, scriptId })}
<noscript>
  <p>
    Meghalaya jobs widget requires JavaScript. Open
    <a href="${escapeHtml(livePageUrl)}" target="_blank" rel="noopener noreferrer">the live jobs page</a>.
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

function renderPagesIndex(
  siteConfig,
  staticSnippet,
  {
    pageTitle = `${siteConfig.siteName} Live Widget`,
    widgetAttribute = "data-meghalaya-jobs-widget",
    widgetScriptUrl = "./meghalaya-jobs-widget.js",
    scriptId = "mjg-remote-script"
  } = {}
) {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(pageTitle)}</title>
  </head>
  <body style="margin:0;padding:24px;background:#e8f0f7;">
    <div ${widgetAttribute}>${staticSnippet}</div>
    ${renderAutoRefreshLoader(widgetScriptUrl, { widgetAttribute, scriptId })}
  </body>
</html>
  `.trim();
}

function renderSnippetHelpDocument(
  siteConfig,
  snippet,
  {
    title = `${siteConfig.siteName} Blogger Live Snippet`,
    previewPaths = "dist/meghalaya-jobs-live-local-preview.html or docs/index.html",
    livePageUrl = siteConfig.publicBaseUrl
  } = {}
) {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
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
      <h1>${escapeHtml(title)}</h1>
      <p>
        This file is a Blogger embed snippet, not a standalone preview page.
        Paste the code below into Blogger HTML view.
      </p>
      <div class="note">
        For local preview use <strong>${escapeHtml(previewPaths)}</strong>.
        For the live Blogger widget to work, GitHub Pages must be deployed at
        <strong>${escapeHtml(livePageUrl)}</strong>.
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
  const displayGrouped = buildDisplayGrouped(grouped, generatedAt, siteConfig);

  const payload = {
    grouped: displayGrouped,
    failedSources,
    generatedAt,
    siteConfig
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
  const resultPayload = {
    category: "result",
    items: filterRecentItems(grouped.result ?? [], generatedAt, resultPageWindowDays).slice(
      0,
      siteConfig.maxItemsPerCategory
    ),
    failedSources,
    generatedAt,
    siteConfig,
    pageTitle: "Meghalaya Results 2026",
    description: `Latest Meghalaya result notices from official government websites. This page shows only result updates from the last ${resultPageWindowDays} days in a mobile-friendly layout.`,
    dayWindow: resultPageWindowDays
  };
  const resultStaticSnippet = renderSingleCategoryStaticSnippet(resultPayload);
  const resultBloggerLiveSnippet = renderBloggerLiveSnippet(siteConfig, resultStaticSnippet, {
    widgetAttribute: "data-meghalaya-results-widget",
    widgetScriptUrl: `${siteConfig.publicBaseUrl}/meghalaya-results-widget.js`,
    livePageUrl: `${siteConfig.publicBaseUrl}/results.html`,
    scriptId: "mjg-results-remote-script"
  });
  const resultWidgetScript = buildWidgetScript(
    resultStaticSnippet,
    "data-meghalaya-results-widget"
  );
  const resultPreview = renderPreviewDocument(
    "Meghalaya Results Preview",
    resultStaticSnippet
  );
  const resultLocalLivePreview = renderPreviewDocument(
    "Meghalaya Results Live Local Preview",
    `<div data-meghalaya-results-widget></div><script defer src="./meghalaya-results-widget.js"></script>`
  );
  const resultBloggerLiveHelp = renderSnippetHelpDocument(siteConfig, resultBloggerLiveSnippet, {
    title: "Meghalaya Results Blogger Live Snippet",
    previewPaths: "dist/meghalaya-results-live-local-preview.html or docs/results.html",
    livePageUrl: `${siteConfig.publicBaseUrl}/results.html`
  });
  const resultsPage = renderPagesIndex(siteConfig, resultStaticSnippet, {
    pageTitle: "Meghalaya Results 2026",
    widgetAttribute: "data-meghalaya-results-widget",
    widgetScriptUrl: "./meghalaya-results-widget.js",
    scriptId: "mjg-results-remote-script"
  });
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
      displayCounts: Object.fromEntries(
        displayCategoryOrder.map((category) => [category, displayGrouped[category].length])
      ),
      sourceCount: activeSources.length,
      grouped,
      displayGrouped,
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
    "meghalaya-results-blogger.html": resultStaticSnippet,
    "meghalaya-results-blogger-live.html": resultBloggerLiveSnippet,
    "meghalaya-results-blogger-live-help.html": resultBloggerLiveHelp,
    "meghalaya-results-live-local-preview.html": resultLocalLivePreview,
    "meghalaya-results-preview.html": resultPreview,
    "meghalaya-results-widget.js": `${resultWidgetScript}\n`,
    "meghalaya-jobs-data.json": dataJson,
    "index.html": pagesIndex,
    "result.html": resultsPage,
    "results.html": resultsPage,
    ".nojekyll": ""
  });

  // Keep a guaranteed local copy for Blogger paste workflows even if sync tooling
  // skips the live snippet in dist for any reason.
  await writeFile(
    path.join(__dirname, "dist", "meghalaya-jobs-blogger-live.html"),
    bloggerLiveSnippet,
    "utf8"
  );
  await writeFile(
    path.join(__dirname, "dist", "meghalaya-results-blogger-live.html"),
    resultBloggerLiveSnippet,
    "utf8"
  );

  console.log("\nGenerated files in dist/ and docs/:");
  console.log("- meghalaya-jobs-blogger.html");
  console.log("- meghalaya-jobs-blogger-live.html");
  console.log("- meghalaya-jobs-blogger-live-help.html");
  console.log("- meghalaya-jobs-live-local-preview.html");
  console.log("- meghalaya-jobs-preview.html");
  console.log("- meghalaya-jobs-widget.js");
  console.log("- meghalaya-results-blogger.html");
  console.log("- meghalaya-results-blogger-live.html");
  console.log("- meghalaya-results-blogger-live-help.html");
  console.log("- meghalaya-results-live-local-preview.html");
  console.log("- meghalaya-results-preview.html");
  console.log("- meghalaya-results-widget.js");
  console.log("- meghalaya-jobs-data.json");
  console.log("- index.html");
  console.log("- result.html");
  console.log("- results.html");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
