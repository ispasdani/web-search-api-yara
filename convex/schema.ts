import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  pages: defineTable({
    url:         v.string(),
    domain:      v.string(),
    title:       v.string(),
    content:     v.string(), // title + body text, truncated — this is what gets searched
    snippet:     v.string(), // first ~300 chars shown in results
    lang:        v.string(), // ISO 639-1: "en", "fr", etc.
    contentType: v.string(), // "article" | "news" | "docs" | "forum" | "other"
    crawledAt:   v.number(), // Unix ms timestamp
    contentHash: v.string(), // SHA-256 of content — used to skip unchanged pages
  })
    .index("by_url",    ["url"])
    .index("by_domain", ["domain"])
    .searchIndex("search_content", {
      searchField:  "content",
      filterFields: ["domain", "lang", "contentType"],
    }),
});
