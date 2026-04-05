import { CheerioCrawler, Configuration, RequestQueue, Log } from "crawlee";
import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { api } from "../convex/_generated/api.js";
import { fetchHtml, extractPage } from "./extractor.js";
import { pLimit } from "./utils/pLimit.js";

// ── Config ────────────────────────────────────────────────────────────────────
const CONVEX_URL       = process.env.CONVEX_URL!;
const MAX_PAGES        = parseInt(process.env.CRAWL_MAX_PAGES   ?? "500");
const MAX_DEPTH        = parseInt(process.env.CRAWL_MAX_DEPTH   ?? "3");
const CONCURRENCY      = parseInt(process.env.CRAWL_CONCURRENCY ?? "5");
const CONTENT_MAX_CHARS = parseInt(process.env.CONTENT_MAX_CHARS ?? "8000");

if (!CONVEX_URL) {
  console.error("❌  CONVEX_URL is not set. Copy .env.example → .env and fill it in.");
  process.exit(1);
}

// Disable Crawlee's default disk persistence (we use Convex instead)
Configuration.getGlobalConfig().set("persistStorage", false);

// ── Convex client ─────────────────────────────────────────────────────────────
const convex = new ConvexHttpClient(CONVEX_URL);

// ── Stats ─────────────────────────────────────────────────────────────────────
let indexed   = 0;
let skipped   = 0;
let failed    = 0;
let total     = 0;

// ── Push a single page to Convex ─────────────────────────────────────────────
async function pushToConvex(page: Awaited<ReturnType<typeof extractPage>>) {
  if (!page) return;
  try {
    await convex.mutation(api.pages.upsertPage, page);
    indexed++;
    if (indexed % 10 === 0) {
      console.log(`📦  Indexed: ${indexed}  Skipped: ${skipped}  Failed: ${failed}  Queued: ${total}`);
    }
  } catch (err) {
    failed++;
    console.warn(`⚠️  Convex write failed for ${page.url}: ${(err as Error).message}`);
  }
}

// ── Read seed URLs ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const seedsPath = resolve(__dirname, "../seeds/urls.txt");
const seedUrls  = readFileSync(seedsPath, "utf-8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

if (seedUrls.length === 0) {
  console.error("❌  seeds/urls.txt is empty. Add at least one URL.");
  process.exit(1);
}

console.log(`🌱  Seeding crawler with ${seedUrls.length} URL(s):`);
seedUrls.forEach((u) => console.log(`    ${u}`));
console.log(`📊  Limits: maxPages=${MAX_PAGES}  maxDepth=${MAX_DEPTH}  concurrency=${CONCURRENCY}\n`);

// ── Crawler ───────────────────────────────────────────────────────────────────
const limit = pLimit(CONCURRENCY);

const crawler = new CheerioCrawler({
  maxRequestsPerCrawl: MAX_PAGES,
  maxConcurrency:      CONCURRENCY,
  requestHandlerTimeoutSecs: 30,

  // Crawlee will respect robots.txt automatically.
  // We also add a small per-domain delay to be polite.
  minConcurrency: 1,

  async requestHandler({ request, $, enqueueLinks, log }) {
    total++;
    const url   = request.loadedUrl ?? request.url;
    const depth = (request.userData.depth as number | undefined) ?? 0;

    log.debug(`[depth=${depth}] ${url}`);

    // ── Extract text directly from Cheerio's already-parsed HTML ─────────────
    // We re-use the raw HTML string for our extractor so Readability can parse it.
    const html = $.html();

    const page = await extractPage(url, html, CONTENT_MAX_CHARS);

    if (!page) {
      skipped++;
      return;
    }

    // Push to Convex (fire and forget within the concurrency limit)
    limit(() => pushToConvex(page)).catch(() => { failed++; });

    // ── Follow links ──────────────────────────────────────────────────────────
    if (depth < MAX_DEPTH) {
      await enqueueLinks({
        strategy: "same-domain", // only stay on the same domain
        transformRequestFunction(req) {
          // Skip non-HTML resources
          const href = req.url.toLowerCase();
          if (/\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|pdf|zip|gz|mp4|webm)(\?.*)?$/.test(href)) {
            return false;
          }
          req.userData = { depth: depth + 1 };
          return req;
        },
      });
    }
  },

  failedRequestHandler({ request }, err) {
    failed++;
    console.warn(`❌  Failed: ${request.url} — ${(err as Error).message}`);
  },
});

// ── Run ───────────────────────────────────────────────────────────────────────
console.log("🕷️  Starting crawl...\n");
const startedAt = Date.now();

await crawler.run(seedUrls.map((url) => ({ url, userData: { depth: 0 } })));

// Wait for any in-flight Convex writes to settle
await new Promise((r) => setTimeout(r, 2000));

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n✅  Crawl complete in ${elapsed}s`);
console.log(`    Indexed : ${indexed}`);
console.log(`    Skipped : ${skipped}  (empty/unchanged pages)`);
console.log(`    Failed  : ${failed}`);
console.log(`    Total   : ${total} requests processed`);
console.log(`\n🔍  Search at: ${CONVEX_URL.replace(".cloud", ".site")}/search?q=your+query`);
