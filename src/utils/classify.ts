// Classify a page into one of: article | news | docs | forum | other
// Uses URL patterns first (fast), then falls back to meta/schema.org signals.
export function classifyContent(url: string, html: string): string {
  const u = url.toLowerCase();

  // ── URL pattern matching (most reliable signal) ───────────────────────────
  if (/\/(news|press|announcement|release|breaking)\b/i.test(u))       return "news";
  if (/\/(blog|posts?|articles?|stories|journal|essay)\b/i.test(u))    return "article";
  if (/\/(docs?|documentation|guides?|tutorials?|reference|api|manual|handbook|wiki|learn)\b/i.test(u)) return "docs";
  if (/\/(forum|discuss|community|qa|questions?|thread|topic)\b/i.test(u)) return "forum";

  // ── Well-known forum/discussion domains ───────────────────────────────────
  if (/stackoverflow\.com|reddit\.com\/r\/|discourse\.|community\.|discuss\./i.test(u)) return "forum";

  // ── og:type meta tag ──────────────────────────────────────────────────────
  const ogType =
    html.match(/<meta[^>]+property=["']og:type["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:type["']/i)?.[1];

  if (ogType) {
    const t = ogType.toLowerCase();
    if (t.includes("article") || t.includes("news") || t.includes("blog")) return "article";
  }

  // ── schema.org @type ──────────────────────────────────────────────────────
  if (/"@type"\s*:\s*"(NewsArticle|Article|BlogPosting)"/i.test(html))          return "article";
  if (/"@type"\s*:\s*"TechArticle"/i.test(html))                                return "docs";
  if (/"@type"\s*:\s*"(DiscussionForumPosting|QAPage|Question)"/i.test(html))   return "forum";

  return "other";
}
