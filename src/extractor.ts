import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import * as cheerio from "cheerio";
import { createHash } from "crypto";
import { detectLang } from "./utils/langDetect.js";
import { classifyContent } from "./utils/classify.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB cap
const USER_AGENT = "Mozilla/5.0 (compatible; YaraBot/1.0; +https://github.com/yara-search)";

export interface ExtractedPage {
  url:         string;
  domain:      string;
  title:       string;
  content:     string; // full text for indexing
  snippet:     string; // first ~300 chars for display
  lang:        string;
  contentType: string;
  crawledAt:   number;
  contentHash: string;
}

// ── Main extraction function ──────────────────────────────────────────────────
// Never throws — returns null if the page can't be extracted usefully.
export async function extractPage(
  url: string,
  html: string,
  maxChars: number = 8000
): Promise<ExtractedPage | null> {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, "");
    const text   = extractText(url, html);

    if (!text || text.length < 50) return null; // skip near-empty pages

    const title       = extractTitle(html);
    const content     = text.slice(0, maxChars);
    const snippet     = text.slice(0, 300).replace(/\s+/g, " ").trim();
    const lang        = detectLang(text);
    const contentType = classifyContent(url, html);
    const contentHash = createHash("sha256").update(content).digest("hex");

    return {
      url,
      domain,
      title,
      content,
      snippet,
      lang,
      contentType,
      crawledAt: Date.now(),
      contentHash,
    };
  } catch {
    return null;
  }
}

// ── Fetch HTML from a URL ─────────────────────────────────────────────────────
// Returns null on network error, non-HTML, or oversized response.
export async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    // Stream with size cap to avoid loading huge pages into memory
    const reader = res.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        chunks.push(value);
        if (totalBytes >= MAX_RESPONSE_BYTES) {
          await reader.cancel();
          break;
        }
      }
    }

    const buffer = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder().decode(buffer);
  } catch {
    return null;
  }
}

// ── Text extraction: Readability first, Cheerio fallback ─────────────────────
function extractText(url: string, html: string): string {
  // Primary: Mozilla Readability (best for articles/docs)
  try {
    const dom    = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();
    if (parsed?.textContent && parsed.textContent.trim().length > 100) {
      return parsed.textContent.replace(/\s+/g, " ").trim();
    }
  } catch {
    // fall through to Cheerio
  }

  // Fallback: Cheerio body strip
  try {
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header, aside, noscript, [aria-hidden='true']").remove();
    return $("body").text().replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

// ── SPA / JS-heavy page detection ────────────────────────────────────────────
// Returns true when the page likely needs a headless browser to render its content.
// Called by the crawler to decide whether to queue a Playwright fallback pass.
export function detectSPA(html: string): boolean {
  // Framework markers written into the raw HTML by SSR/hydration
  const markers = [
    "__NEXT_DATA__",       // Next.js
    "data-reactroot",      // React (legacy)
    "data-react-helmet",   // React Helmet
    "ng-version",          // Angular
    "__NUXT__",            // Nuxt.js
    "__vue_root",          // Vue 3
    "data-server-rendered", // Vue SSR (still JS-driven)
    "gatsby-focus-wrapper", // Gatsby
  ];
  if (markers.some((m) => html.includes(m))) return true;

  // Structural heuristic: body visible text < 5% of total HTML size
  // (page is mostly script/style tags with minimal pre-rendered content)
  if (html.length > 5_000) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      const bodyText = bodyMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (bodyText.length / html.length < 0.05) return true;
    }
  }

  return false;
}

// ── Title extraction ──────────────────────────────────────────────────────────
function extractTitle(html: string): string {
  // Try og:title first (usually cleaner)
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i
  )?.[1];
  if (og) return og.trim();

  // Fall back to <title> tag
  const tag = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1];
  return (tag ?? "Untitled").trim();
}
