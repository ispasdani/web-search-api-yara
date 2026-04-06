import { CheerioCrawler, PlaywrightCrawler, Configuration } from "crawlee";
import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { api } from "../convex/_generated/api.js";
import { extractPage, detectSPA } from "./extractor.js";
import { pLimit } from "./utils/pLimit.js";

// ── Config ────────────────────────────────────────────────────────────────────
const CONVEX_URL        = process.env.CONVEX_URL!;
const MAX_PAGES         = parseInt(process.env.CRAWL_MAX_PAGES          ?? "500");
const MAX_DEPTH         = parseInt(process.env.CRAWL_MAX_DEPTH          ?? "3");
const CONCURRENCY       = parseInt(process.env.CRAWL_CONCURRENCY        ?? "5");
const CONTENT_MAX_CHARS = parseInt(process.env.CONTENT_MAX_CHARS        ?? "8000");
const PW_TIMEOUT_MS     = parseInt(process.env.CRAWL_PLAYWRIGHT_TIMEOUT ?? "15000");

if (!CONVEX_URL) {
  console.error("❌  CONVEX_URL is not set. Copy .env.example → .env.local and fill it in.");
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
let spaCount  = 0;

// URLs detected as SPAs during the Cheerio pass — queued for the Playwright pass
const spaUrls = new Set<string>();

// ── Push a single page to Convex ─────────────────────────────────────────────
async function pushToConvex(page: Awaited<ReturnType<typeof extractPage>>) {
  if (!page) return;
  try {
    await convex.mutation(api.pages.upsertPage, page);
    indexed++;
    if (indexed % 10 === 0) {
      console.log(`📦  Indexed: ${indexed}  Skipped: ${skipped}  Failed: ${failed}  SPA queued: ${spaUrls.size}`);
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

// ── Pass 1: CheerioCrawler (fast, no browser) ─────────────────────────────────
const limit = pLimit(CONCURRENCY);

const cheerioCrawler = new CheerioCrawler({
  maxRequestsPerCrawl:      MAX_PAGES,
  maxConcurrency:           CONCURRENCY,
  requestHandlerTimeoutSecs: 30,
  minConcurrency:            1,

  async requestHandler({ request, $, enqueueLinks }) {
    total++;
    const url   = request.loadedUrl ?? request.url;
    const depth = (request.userData.depth as number | undefined) ?? 0;
    const html  = $.html();

    // Detect SPA — queue for Playwright pass instead of extracting now
    if (detectSPA(html)) {
      spaUrls.add(url);
      spaCount++;
      return;
    }

    const page = await extractPage(url, html, CONTENT_MAX_CHARS);

    if (!page || page.content.length < 200) {
      // Content too sparse — also try with Playwright
      spaUrls.add(url);
      skipped++;
      return;
    }

    limit(() => pushToConvex(page)).catch(() => { failed++; });

    if (depth < MAX_DEPTH) {
      await enqueueLinks({
        strategy: "same-domain",
        transformRequestFunction(req) {
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

console.log("🕷️  Pass 1: CheerioCrawler (static pages)...\n");
const startedAt = Date.now();
await cheerioCrawler.run(seedUrls.map((url) => ({ url, userData: { depth: 0 } })));
await new Promise((r) => setTimeout(r, 1000));

// ── Pass 2: PlaywrightCrawler (JS-heavy / SPA pages) ─────────────────────────
if (spaUrls.size > 0) {
  console.log(`\n🎭  Pass 2: PlaywrightCrawler for ${spaUrls.size} SPA/JS-heavy page(s)...\n`);

  const playwrightCrawler = new PlaywrightCrawler({
    maxConcurrency:            2,  // browsers are heavy — keep concurrency low
    requestHandlerTimeoutSecs: Math.ceil(PW_TIMEOUT_MS / 1000) + 5,
    launchContext: {
      launchOptions: {
        headless: true,
        timeout:  PW_TIMEOUT_MS,
      },
    },

    async requestHandler({ request, page }) {
      const url = request.loadedUrl ?? request.url;

      // Wait for the network to settle so JS can finish rendering
      await page.waitForLoadState("networkidle", { timeout: PW_TIMEOUT_MS });

      const html      = await page.content();
      const extracted = await extractPage(url, html, CONTENT_MAX_CHARS);

      if (!extracted || extracted.content.length < 100) {
        skipped++;
        return;
      }

      limit(() => pushToConvex(extracted)).catch(() => { failed++; });
    },

    failedRequestHandler({ request }, err) {
      failed++;
      console.warn(`❌  Playwright failed: ${request.url} — ${(err as Error).message}`);
    },
  });

  await playwrightCrawler.run([...spaUrls].map((url) => ({ url })));
  await new Promise((r) => setTimeout(r, 1000));
}

// ── Done ──────────────────────────────────────────────────────────────────────
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n✅  Crawl complete in ${elapsed}s`);
console.log(`    Indexed     : ${indexed}`);
console.log(`    Skipped     : ${skipped}  (empty/unchanged pages)`);
console.log(`    SPA (Pass 2): ${spaCount} pages rendered with Playwright`);
console.log(`    Failed      : ${failed}`);
console.log(`    Total req   : ${total}`);
console.log(`\n🔍  Search at: ${CONVEX_URL.replace(".cloud", ".site")}/search?q=your+query`);
