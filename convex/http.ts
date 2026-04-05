import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

// ── GET /search ───────────────────────────────────────────────────────────────
// Main search endpoint. All parameters are query string params.
//
// Required:
//   ?q=your+query
//
// Optional filters:
//   &site=nodejs.org          filter to a specific domain
//   &lang=en                  ISO 639-1 language code
//   &type=docs                article | news | docs | forum | other
//   &after=2024-01-01         only pages crawled after this date (ISO 8601)
//   &before=2025-01-01        only pages crawled before this date (ISO 8601)
//   &sort=relevance           relevance (default) | date
//   &page=1
//   &limit=10                 max 50
//
// Example:
//   GET https://<deployment>.convex.site/search?q=streams&site=nodejs.org&lang=en
http.route({
  path: "/search",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url    = new URL(request.url);
    const params = url.searchParams;

    const q = params.get("q")?.trim();
    if (!q) {
      return json({ error: "q parameter is required" }, 400);
    }

    const domain      = params.get("site")   ?? undefined;
    const lang        = params.get("lang")   ?? undefined;
    const contentType = params.get("type")   ?? undefined;
    const sort        = params.get("sort")   ?? undefined;
    const page        = parseInt(params.get("page")  ?? "1");
    const limit       = Math.min(parseInt(params.get("limit") ?? "10"), 50);

    const afterStr  = params.get("after");
    const beforeStr = params.get("before");
    const after  = afterStr  ? new Date(afterStr).getTime()  : undefined;
    const before = beforeStr ? new Date(beforeStr).getTime() : undefined;

    if (afterStr  && isNaN(after!))  return json({ error: "Invalid after date" },  400);
    if (beforeStr && isNaN(before!)) return json({ error: "Invalid before date" }, 400);

    const result = await ctx.runQuery(api.pages.searchPages, {
      q,
      domain,
      lang,
      contentType,
      after,
      before,
      sort,
      page,
      limit,
    });

    return json({
      query:   q,
      results: result.results,
      total:   result.total,
      page:    result.page,
      limit:   result.limit,
    });
  }),
});

// ── GET /health ───────────────────────────────────────────────────────────────
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => json({ status: "ok" })),
});

// ── GET /stats ────────────────────────────────────────────────────────────────
http.route({
  path: "/stats",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const result = await ctx.runQuery(api.pages.stats, {});
    return json(result);
  }),
});

// ── Helper ────────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default http;
