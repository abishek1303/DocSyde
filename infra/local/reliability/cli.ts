import "dotenv/config";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { z } from "zod";
import { closeDatabase } from "@/integrations/database/client";
import { readCleanCheckoutIdentity } from "@/integrations/local-git/checkout-identity";
import { reliabilityBaselineSchema, reliabilityManifestSchema, baselineInventory, baselineInference, baselineEnvironment,
  databaseServerIdentity, fileReceipt, assertReliabilityBaseline } from "@/features/documentation/runs/reliability-baseline";
import { inspectTransformationBatches } from "@/features/documentation/transformation/transform-documentation";
import { compareCommits } from "@/integrations/github/source-reader";
import { exportScenario, verifyOfflineScenario } from "./offline";
import { REQUEST_DESK_BASE, scenarios } from "./workflows";

async function json(path: string) { return JSON.parse(await readFile(path, "utf8")) as unknown; }
async function output(path: string, value: unknown) {
  await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "scenarios" && args.length <= 1) {
    const directory = resolve(args[0] ?? `.artifacts/reliability/offline-${Date.now()}`);
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory, { recursive: false, mode: 0o700 });
    for (const scenario of scenarios) {
      const checkout = resolve(directory, scenario);
      try {
      await exportScenario(scenario, checkout);
      const receipt = await verifyOfflineScenario(scenario, checkout, resolve(directory, `${scenario}-evidence`), false);
      console.log(JSON.stringify({ scenario, passed: receipt.passed, paidCalls: 0, evidence: resolve(directory, `${scenario}-evidence`) }));
      } finally { await rm(checkout, { recursive: true, force: true }); }
    }
    return;
  }
  if (command === "offline" && args.length === 3) {
    const scenario = z.enum(scenarios).parse(args[0]);
    await verifyOfflineScenario(scenario, resolve(args[1]), resolve(args[2]));
    console.log("Offline gate passed; no inference was called."); return;
  }
  if (command === "freeze" && args.length === 1) {
    const code = await readCleanCheckoutIdentity(process.cwd());
    const inventory = await baselineInventory("https://github.com/abishek1303/docsyde");
    const manifest = reliabilityBaselineSchema.parse({ version: 1, runContext: null, docsydeSha: code.sha, requestDeskBase: REQUEST_DESK_BASE,
      repository: "https://github.com/abishek1303/docsyde", sourceDatabase: inventory.databaseName, serverIdentity: databaseServerIdentity(),
      code: await Promise.all(code.files.map(fileReceipt)), inference: baselineInference(), environment: baselineEnvironment(),
      documents: inventory.documents, publications: inventory.publications, contextSha256: inventory.contextSha256, schemaSha256: inventory.schemaSha256 });
    await output(args[0], manifest); console.log("Frozen read-only baseline inventory; no database mutation or inference."); return;
  }
  if (command === "batch" && args.length === 2) {
    // Trusted local representative input: { impact, plan, context? }. Existing validators run inside inspection.
    const input = z.object({ impact: z.unknown(), plan: z.unknown(), context: z.array(z.unknown()).optional() }).strict().parse(await json(args[0]));
    const { validateProductImpact } = await import("@/features/sources/product-analysis");
    const { validateDocumentationImpactPlan } = await import("@/features/documentation/planning/validate-documentation-impact-plan");
    const { associationChoice } = await import("@/features/documentation/documents/document");
    const impact = validateProductImpact(input.impact), plan = validateDocumentationImpactPlan(impact, input.plan);
    const result = await inspectTransformationBatches({ impact, plan, context: z.array(associationChoice).parse(input.context ?? []) });
    await output(args[1], { ...result, source: plan.source, input: await fileReceipt(args[0]), inspectedAt: new Date().toISOString(), inferenceCalls: 0 });
    console.log(result.eligible ? "Single-batch admission passed; zero inference calls." : "Outside single-batch baseline scope; zero inference calls.");
    if (!result.eligible) process.exitCode = 2;
    return;
  }
  if (command === "github" && args.length === 3) {
    const [branch, head, path] = args;
    z.string().regex(/^[a-f0-9]{40}$/).parse(head);
    const { createGithubClient } = await import("@/integrations/github/client");
    const client = await createGithubClient();
    const ref = await client.rest.git.getRef({ owner: "abishek1303", repo: "docsyde", ref: `heads/${branch}` });
    if (ref.data.object.sha !== head) throw new Error("Remote branch does not match pinned head.");
    const commit = await client.rest.repos.getCommit({ owner: "abishek1303", repo: "docsyde", ref: head });
    if (commit.data.parents.length !== 1 || commit.data.parents[0].sha !== REQUEST_DESK_BASE) throw new Error("Scenario must have exactly one parent: the common base.");
    const comparison = await compareCommits({ owner: "abishek1303", repo: "docsyde", base: REQUEST_DESK_BASE, head });
    if (comparison.head.commitId !== head || comparison.base.commitId !== REQUEST_DESK_BASE || comparison.commits.length !== 1) throw new Error("GitHub comparison must contain exactly the independent scenario commit.");
    await output(path, { passed: true, base: REQUEST_DESK_BASE, head, branch, checkedAt: new Date().toISOString() });
    console.log("GitHub comparison readable; no refs changed and no inference."); return;
  }
  if (command === "seal" && args.length === 3) {
    const baseline = reliabilityBaselineSchema.parse(await json(args[0]));
    const spec = z.object({ scenario: z.enum(scenarios), databaseName: z.string(), head: z.string(), branch: z.string(), runContext: z.string().nullable(),
      runtimePath: z.string(), batchReportPath: z.string(), offlineGatePath: z.string(), githubGatePath: z.string() }).strict().parse(await json(args[1]));
    const { runRuntimeConfigSchema } = await import("@/features/documentation/runs/run-runtime-config");
    const { documentationHash } = await import("@/features/documentation/documents/document-identity");
    const runtime = runRuntimeConfigSchema.parse(await json(spec.runtimePath));
    const manifest = reliabilityManifestSchema.parse({ version: 1, baseline, scenario: spec.scenario, databaseName: spec.databaseName,
      head: spec.head, branch: spec.branch, runContext: spec.runContext,
      runtime: await fileReceipt(spec.runtimePath), runtimeDescriptor: { id: runtime.id, version: runtime.version, sha256: documentationHash(runtime), capabilitiesSha256: documentationHash(runtime.capabilities) }, representativeBatchCheck: await fileReceipt(spec.batchReportPath),
      offlineGate: await fileReceipt(spec.offlineGatePath), githubGate: await fileReceipt(spec.githubGatePath) });
    await assertReliabilityBaseline(manifest);
    await output(args[2], manifest); console.log("Scenario manifest sealed. Starting inference still requires separate authorization."); return;
  }
  if (command === "clone" && args.length === 3) {
    const { createDatabaseCopies } = await import("./database-copies");
    await createDatabaseCopies(args[0], args[1], args[2]);
    console.log("Three new isolated databases restored from one snapshot. Original publications unchanged."); return;
  }
  if (command === "report" && args.length === 4) {
    const { reportScenario } = await import("./report");
    await output(args[3], await reportScenario(args[0], args[1], args[2] === "-" ? null : args[2]));
    console.log("Read-only scenario report written."); return;
  }
  if (command === "compare" && args.length === 4) {
    const { writeComparison } = await import("./report");
    await writeComparison(args.slice(0, 3), args[3]); console.log("Comparison written; no inference."); return;
  }
  throw new Error("Usage: reliability scenarios [output-directory] | offline A|B|C checkout output | freeze output.json | batch input.json output.json | github branch head output.json | seal baseline.json spec.json output.json | clone baseline.json new-output-directory docsyde_reliability_unique_prefix | report manifest run-id publication-proof-or-dash output.json | compare A.json B.json C.json output.md");
}
main().catch(error => {
  // Never print provider/driver messages that may contain credentials or source payloads.
  console.error(error instanceof z.ZodError ? "Reliability input/evidence schema rejected." : "Reliability command stopped. Check documented inputs, clean checkouts and local prerequisites. No inference is performed by this CLI.");
  if (["scenarios", "offline"].includes(process.argv[2]) && error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}).finally(closeDatabase);
