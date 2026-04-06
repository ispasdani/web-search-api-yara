import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// ── Upsert a crawled page ─────────────────────────────────────────────────────
// Called by the local crawler after extracting a page.
// Skips writing if the content hash hasn't changed (page unchanged).
export const upsertPage = mutation({
  args: {
    url:         v.string(),
    domain:      v.string(),
    title:       v.string(),
    content:     v.string(),
    snippet:     v.string(),
    lang:        v.string(),
    contentType: v.string(),
    crawledAt:   v.number(),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pages")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .first();

    if (existing) {
      if (existing.contentHash === args.contentHash) {
        return existing._id; // unchanged — skip
      }
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return await ctx.db.insert("pages", args);
  },
});

// ── Search pages ──────────────────────────────────────────────────────────────
// Full-text BM25 search on the content field with optional equality filters.
// Date range (after/before) is applied as a post-search filter since
// Convex search indexes only support equality filters.
export const searchPages = query({
  args: {
    q:           v.string(),
    domain:      v.optional(v.string()),
    lang:        v.optional(v.string()),
    contentType: v.optional(v.string()),
    after:       v.optional(v.number()), // Unix ms — include pages crawled after this
    before:      v.optional(v.number()), // Unix ms — include pages crawled before this
    sort:        v.optional(v.string()), // "relevance" (default) | "date"
    page:        v.optional(v.number()),
    limit:       v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 10, 50);
    const page  = Math.max(args.page  ?? 1,  1);

    // Build the search query with optional equality filters
    const results = await ctx.db
      .query("pages")
      .withSearchIndex("search_content", (q) => {
        let s = q.search("content", args.q);
        if (args.domain)      s = s.eq("domain",      args.domain);
        if (args.lang)        s = s.eq("lang",         args.lang);
        if (args.contentType) s = s.eq("contentType",  args.contentType);
        return s;
      })
      .collect();

    // Post-filter: date range
    const filtered = results.filter((r) => {
      if (args.after  !== undefined && r.crawledAt <= args.after)  return false;
      if (args.before !== undefined && r.crawledAt >= args.before) return false;
      return true;
    });

    // Sort by date if requested (default is BM25 relevance from Convex)
    if (args.sort === "date") {
      filtered.sort((a, b) => b.crawledAt - a.crawledAt);
    }

    // Paginate
    const start     = (page - 1) * limit;
    const paginated = filtered.slice(start, start + limit);

    return {
      results: paginated.map((r) => ({
        id:          r._id,
        url:         r.url,
        domain:      r.domain,
        title:       r.title,
        snippet:     r.snippet,
        lang:        r.lang,
        contentType: r.contentType,
        crawledAt:   r.crawledAt,
      })),
      total: filtered.length,
      page,
      limit,
    };
  },
});

// ── Internal: stale pages for re-crawl ───────────────────────────────────────
// Returns pages whose crawledAt is older than `olderThanMs` (unix ms).
// Used by the daily cron re-crawl action.
export const getStalePagesForRecrawl = internalQuery({
  args: {
    olderThanMs: v.number(),
    limit:       v.optional(v.number()),
  },
  handler: async (ctx, { olderThanMs, limit }) => {
    return ctx.db
      .query("pages")
      .withIndex("by_crawledAt", (q) => q.lt("crawledAt", olderThanMs))
      .take(limit ?? 50);
  },
});

// ── Internal: upsert for use inside Convex actions ────────────────────────────
// Actions cannot call public mutations via `api.*`; they use `internal.*`.
export const upsertPageInternal = internalMutation({
  args: {
    url:         v.string(),
    domain:      v.string(),
    title:       v.string(),
    content:     v.string(),
    snippet:     v.string(),
    lang:        v.string(),
    contentType: v.string(),
    crawledAt:   v.number(),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pages")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .first();

    if (existing) {
      if (existing.contentHash === args.contentHash) return existing._id;
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return await ctx.db.insert("pages", args);
  },
});

// ── Stats ─────────────────────────────────────────────────────────────────────
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("pages").collect();
    const byDomain: Record<string, number> = {};
    for (const p of all) {
      byDomain[p.domain] = (byDomain[p.domain] ?? 0) + 1;
    }
    return {
      total: all.length,
      byDomain,
    };
  },
});
