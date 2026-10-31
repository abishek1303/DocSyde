import "dotenv/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { validateProductImpact } from "@/features/sources/product-analysis";
import { planDocumentationImpact } from "@/features/documentation/plan-documentation-impact";
import { validateDocumentationImpactPlan } from "@/features/documentation/validate-documentation-impact-plan";
import { transformDocumentation } from "@/features/documentation/transform-documentation";

async function main() {
  const [impactPath, planPath, ...extra] = process.argv.slice(2);
  if (!impactPath || extra.length) throw new Error("Expected trusted impact JSON and optional plan JSON paths.");
  const impact = validateProductImpact(JSON.parse(await readFile(impactPath, "utf8")));
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    const plan = planPath ? validateDocumentationImpactPlan(impact, JSON.parse(await readFile(planPath, "utf8")))
      : (await planDocumentationImpact({ impact }, { signal: controller.signal })).plan;
    const proposal = await transformDocumentation({ impact, plan }, { signal: controller.signal });
    const directory = resolve(".artifacts/documentation-transformations");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${proposal.proposalId}.json`);
    await writeFile(path, JSON.stringify(proposal, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ proposalId: proposal.proposalId, status: proposal.status, artifact: path,
      generationCalls: proposal.batches.filter(batch => batch.status !== "not-attempted").length,
      supportCalls: proposal.supportAttempted ? 1 : 0, candidates: proposal.candidates.length,
      decisions: proposal.results.map(result => ({ decisionId: result.decisionId, generation: result.generation, support: result.support, materialization: result.materialization })) }));
    if (proposal.status !== "complete") process.exitCode = 1;
  } finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
}
main().catch(() => { console.error("Documentation transformation proof failed. Check trusted inputs, exact saved targets, provider configuration and request limits. Nothing was saved or published."); process.exitCode = 1; });
