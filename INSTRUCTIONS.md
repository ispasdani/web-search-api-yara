# Yara Search Engine — Instructions

## Your deployment URL

Find your Convex URL in `.env.local`:
```
CONVEX_URL=https://quiet-tern-434.eu-west-1.convex.cloud
```

Your **search URL** is the same but with `.site` instead of `.cloud`:
```
https://quiet-tern-434.eu-west-1.convex.site/search
```

---

## 1. Start Convex (required before anything else)

```bash
npx convex dev
```

Wait until it prints "Ready". This deploys your schema and functions to Convex.
You can stop it after it's ready — your deployment stays live.

---

## 2. Crawl websites

```bash
npm run crawl
```

Reads `seeds/urls.txt`, crawls every site listed, and indexes the pages into Convex.

**Safe to run multiple times** — pages that haven't changed are skipped (content hash check). New and updated pages are inserted/updated. Nothing is ever duplicated.

### Add more sites to crawl

Edit `seeds/urls.txt` and add one URL per line:
```
https://www.juridice.ro
https://lege5.ro
https://react.dev/learn
```

Then run `npm run crawl` again.

### Control how deep and how many pages

Edit `.env.local`:
```bash
CRAWL_MAX_PAGES=2000     # total pages per crawl run (default: 500)
CRAWL_MAX_DEPTH=5        # how many link-hops from seed URL (default: 3)
CRAWL_CONCURRENCY=5      # parallel requests (default: 5)
```

---

## 3. Search

### Basic search
```
GET https://quiet-tern-434.eu-west-1.convex.site/search?q=contract+de+munca
```

### All available filters

| Parameter | Description | Example |
|---|---|---|
| `q` | Search query (required) | `q=codul+muncii` |
| `site` | Filter by domain | `site=juridice.ro` |
| `lang` | Filter by language (ISO 639-1) | `lang=ro` |
| `type` | Filter by content type | `type=article` |
| `after` | Only pages crawled after date | `after=2024-01-01` |
| `before` | Only pages crawled before date | `before=2025-01-01` |
| `sort` | Sort order | `sort=relevance` or `sort=date` |
| `page` | Page number | `page=2` |
| `limit` | Results per page (max 50) | `limit=20` |

### Example searches

```bash
# Search everything
curl "https://quiet-tern-434.eu-west-1.convex.site/search?q=contract+de+munca"

# Search only one site
curl "https://quiet-tern-434.eu-west-1.convex.site/search?q=codul+muncii&site=legislatie.just.ro"

# Romanian language only
curl "https://quiet-tern-434.eu-west-1.convex.site/search?q=drept+civil&lang=ro"

# Sort by date, get page 2
curl "https://quiet-tern-434.eu-west-1.convex.site/search?q=neconstitutional&sort=date&page=2"

# Date range
curl "https://quiet-tern-434.eu-west-1.convex.site/search?q=gdpr&after=2023-01-01&before=2025-01-01"

# Combined filters
curl "https://quiet-tern-434.eu-west-1.convex.site/search?q=raspundere+civila&site=juridice.ro&lang=ro&sort=date"
```

### Response format

```json
{
  "query": "contract de munca",
  "results": [
    {
      "title": "Codul Muncii — Contractul individual de munca",
      "url": "https://legislatie.just.ro/...",
      "snippet": "Contractul individual de muncă este contractul...",
      "domain": "legislatie.just.ro",
      "lang": "ro",
      "contentType": "article",
      "crawledAt": 1712275200000
    }
  ],
  "total": 24,
  "page": 1,
  "limit": 10
}
```

---

## 4. Check your index

### Stats endpoint
```bash
curl "https://quiet-tern-434.eu-west-1.convex.site/stats"
```
Returns total pages indexed and a breakdown by domain.

### Health check
```bash
curl "https://quiet-tern-434.eu-west-1.convex.site/health"
```

### Convex dashboard
Go to [convex.dev](https://convex.dev) → your project → **Data** tab → `pages` table to browse all indexed pages.

---

## 5. Automatic re-crawling (already set up)

Every day at **03:00 UTC**, Convex automatically re-crawls pages older than 7 days and updates anything that changed. You don't need to do anything.

To verify it's active:
- Go to [convex.dev](https://convex.dev) → your project → **Cron Jobs** tab
- You should see `recrawl-stale-pages` listed

To trigger it manually:
```bash
npx convex run crawler:recrawlStalePages
```

---

## 6. Currently indexed sites

| Site | Content |
|---|---|
| `legislatie.just.ro` | Official Romanian legislation — all laws |
| `portal.just.ro` | Romanian courts portal |
| `ccr.ro` | Constitutional Court decisions |
| `csm1909.ro` | Superior Council of Magistracy |
| `juridice.ro` | Romanian legal news and jurisprudence |
| `avocatnet.ro` | Legal guides in plain language |
| `dreptonline.ro` | Romanian legal codes reference |
| `lege5.ro` | Romanian legislation database |

---

## 7. Common issues

**404 on search URL** — you're using `.cloud` instead of `.site`, or `npx convex dev` hasn't been run yet.

**Empty results** — run `npm run crawl` first to populate the index.

**Site not indexed** — add its URL to `seeds/urls.txt` and re-run `npm run crawl`.

**JS-heavy site has no content** — the Playwright fallback handles this automatically. Make sure you've run `npx playwright install chromium` once.

```bash
npx playwright install chromium
```
