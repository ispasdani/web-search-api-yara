import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Re-crawl pages older than 7 days — runs daily at 03:00 UTC.
// Note: crons.daily() is prohibited by Convex guidelines; use crons.cron() instead.
crons.cron(
  "recrawl-stale-pages",
  "0 3 * * *",
  internal.crawler.recrawlStalePages,
  {},
);

export default crons;
