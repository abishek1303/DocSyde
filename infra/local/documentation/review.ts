import "dotenv/config";
import { readFile } from "node:fs/promises";
import { getDocumentationReview } from "@/features/documentation/review/review-proposal-operations";
import { applyDocumentationReview } from "@/features/documentation/review/apply-documentation-review";
import { closeDatabase } from "@/integrations/database/client";

// No unsigned proposal import and no inference imports. Retention is available
// only at the trusted transformation producer via --retain on transform:verify.
async function main() {
  const [command, input, ...extra] = process.argv.slice(2);
  if (!input || extra.length || !["show", "receipts", "apply"].includes(command)) throw new Error("Usage: documentation:review show|receipts <proposal-uuid> OR apply <selection.json>");
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    if (command === "apply") {
      const stat = await import("node:fs/promises").then(fs => fs.stat(input));
      if (stat.size > 32 * 1024) throw new Error("Review selection exceeds 32 KiB.");
      const result = await applyDocumentationReview(JSON.parse(await readFile(input, "utf8")), { signal: controller.signal });
      console.log(JSON.stringify(result, null, 2)); if (result.status !== "complete") process.exitCode = 1;
    } else {
      const result = await getDocumentationReview(input);
      console.log(JSON.stringify(command === "receipts" && result.status === "found" ? { proposalId: result.proposalId, proposalHash: result.proposalHash, review: result.review } : result, null, 2));
      if (result.status === "missing") process.exitCode = 1;
    }
  } finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Review command failed."); process.exitCode = 1; }).finally(closeDatabase);
