"use node";
// This file must ONLY contain actions — "use node" is incompatible with
// queries and mutations in the same file (Convex constraint).

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { createHash } from "crypto";
import * as cheerio from "cheerio";

const USER_AGENT = "Mozilla/5.0 (compatible; YaraBot/1.0; +https://github.com/yara-search)";
const MAX_BYTES  = 2 * 1024 * 1024; // 2 MB cap

// ── Fetch HTML (serverless-safe, no JSDOM) ────────────────────────────────────
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        "User-Agent":      USER_AGENT,
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) return null;

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        chunks.push(value);
        if (total >= MAX_BYTES) { await reader.cancel(); break; }
      }
    }

    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  }
}

// ── Scheduled re-crawl action ─────────────────────────────────────────────────
// Fetches up to 50 pages that haven't been re-crawled in 7 days.
// Uses Cheerio only (no JSDOM/Readability — too heavy for serverless).
// Skips pages whose content hash hasn't changed.
export const recrawlStalePages = internalAction({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago

    const stale = await ctx.runQuery(internal.pages.getStalePagesForRecrawl, {
      olderThanMs: cutoff,
      limit: 50,
    });

    console.log(`🔄  Re-crawling ${stale.length} stale page(s)...`);

    let updated = 0;
    let skipped = 0;
    let failed  = 0;

    for (const page of stale) {
      const html = await fetchHtml(page.url);
      if (!html) { failed++; continue; }

      const $ = cheerio.load(html);
      $("script, style, nav, footer, header, aside, noscript").remove();
      const text    = $("body").text().replace(/\s+/g, " ").trim().slice(0, 8000);
      const hash    = createHash("sha256").update(text).digest("hex");

      if (hash === page.contentHash) { skipped++; continue; }

      const domain  = new URL(page.url).hostname.replace(/^www\./, "");
      const titleM  = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
      const title   = titleM?.[1]?.trim() ?? "Untitled";
      const snippet = text.slice(0, 300).replace(/\s+/g, " ").trim();

      await ctx.runMutation(internal.pages.upsertPageInternal, {
        url:         page.url,
        domain,
        title,
        content:     text,
        snippet,
        lang:        page.lang,        // preserve — franc not available serverless
        contentType: page.contentType,
        crawledAt:   Date.now(),
        contentHash: hash,
      });

      updated++;
    }

    console.log(`✅  Re-crawl done — updated: ${updated}  unchanged: ${skipped}  failed: ${failed}`);
  },
});
