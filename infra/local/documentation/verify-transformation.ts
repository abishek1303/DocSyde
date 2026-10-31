import "dotenv/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { validateProductImpact } from "@/features/sources/product-analysis";
import { planDocumentationImpact } from "@/features/documentation/plan-documentation-impact";
import { validateDocumentationImpactPlan } from "@/features/documentation/validate-documentation-impact-plan";
import { closeDatabase } from "@/integrations/database/client";
import { retainDocumentationProposal } from "@/features/documentation/review-proposal-operations";
import { transformDocumentation } from "@/features/documentation/transform-documentation";

async function main() {
  const args = process.argv.slice(2), retain = args.includes("--retain");
  const [impactPath, planPath, ...extra] = args.filter(arg => arg !== "--retain");
  if (!impactPath || extra.length) throw new Error("Expected trusted impact JSON and optional plan JSON paths.");
  const impact = validateProductImpact(JSON.parse(await readFile(impactPath, "utf8")));
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    const plan = planPath ? validateDocumentationImpactPlan(impact, JSON.parse(await readFile(planPath, "utf8")))
      : (await planDocumentationImpact({ impact }, { signal: controller.signal })).plan;
    const proposal = await transformDocumentation({ impact, plan }, { signal: controller.signal });
    const retained = retain ? await retainDocumentationProposal(proposal) : null;
    const directory = resolve(".artifacts/documentation-transformations");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${proposal.proposalId}.json`);
    await writeFile(path, JSON.stringify(proposal, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ proposalId: proposal.proposalId, status: proposal.status, artifact: path, retained: retained ? { proposalId: retained.proposalId, proposalHash: retained.proposalHash, expiresAt: retained.expiresAt } : null,
      generationCalls: proposal.batches.filter(batch => batch.status !== "not-attempted").length,
      supportCalls: proposal.supportAttempted ? 1 : 0, candidates: proposal.candidates.length,
      decisions: proposal.results.map(result => ({ decisionId: result.decisionId, generation: result.generation, support: result.support, materialization: result.materialization })) }));
    if (proposal.status !== "complete") process.exitCode = 1;
  } finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
}
main().catch(() => { console.error("Documentation transformation proof failed. Check trusted inputs, exact saved targets, provider configuration and request limits. Inspect retained review state if --retain was requested; no documentation was saved or published."); process.exitCode = 1; }).finally(closeDatabase);
