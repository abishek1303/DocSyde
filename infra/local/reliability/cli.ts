import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { parseReliabilityContext, requireReliabilityContext, assertScenarioContext, type ReliabilityContext } from "@/integrations/reliability/execution-context";
import { prepareOwnedRoot, ownedPath, writeOwnedJson, freshEvidence } from "@/integrations/reliability/owned-resources";
import { reliabilityEnvironment } from "@/integrations/reliability/subprocess-environment";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildRequestDesk } from "./build-runtime";
import { spawnOwned, stopOwned } from "@/integrations/reliability/process-ownership";
import { verifyOfflineReceipt } from "@/integrations/reliability/evidence";
import { assertRuntimeIdentity } from "@/integrations/reliability/runtime-identity";
import { documentationHash } from "@/features/documentation/documents/document-identity";
import { scenarioWorkflow } from "./workflows";
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
  await writeOwnedJson(requireReliabilityContext(), path, value);
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  const modes: Record<string, ReliabilityContext["mode"]> = { scenarios: "offline", offline: "offline", freeze: "baseline-read", clone: "provision", batch: "scenario", seal: "scenario", github: "scenario", host: "scenario", serve: "scenario", report: "report", compare: "report" };
  const context = requireReliabilityContext(modes[command] ? [modes[command]] : []);
  const code = await readCleanCheckoutIdentity(context.repositoryRoot);
  if (code.sha !== context.docsydeSha || process.cwd() !== context.repositoryRoot) throw new Error("Expected clean DocSyde checkout required.");
  for (const key of ["PLAYWRIGHT_BROWSERS_PATH", "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"]) if (process.env[key]) throw new Error("Ambient browser override rejected.");
  await prepareOwnedRoot(context);
  if (command === "scenarios" && args.length <= 1) {
    if (!context.scenario) {
      for (const scenario of scenarios) {
        const childContext = parseReliabilityContext({ ...context, scenario, requestDeskSha: REQUEST_DESK_BASE,
          outputRoot: join(dirname(context.outputRoot), scenario), runtimeIdentity: null });
        const contextPath = join(context.outputRoot, `context-${scenario}.json`);
        await output(contextPath, childContext);
        await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", resolve(context.repositoryRoot, "infra/local/reliability/cli.ts"), "scenarios"],
          { cwd: context.repositoryRoot, env: reliabilityEnvironment(childContext, contextPath, "tools"), timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
      }
    } else {
      const checkout = join(context.outputRoot, "fixture-checkout");
      await exportScenario(context.scenario, checkout);
      const destination = args[0] ? resolve(args[0]) : join(context.outputRoot, "offline");
      await verifyOfflineScenario(context.scenario, checkout, destination, false);
      console.log(JSON.stringify({ scenario: context.scenario, paidCalls: 0, evidence: destination }));
    }
    return;
  }
  if (command === "offline" && args.length === 3) {
    const scenario = z.enum(scenarios).parse(args[0]);
    await verifyOfflineScenario(scenario, resolve(args[1]), resolve(args[2]));
    console.log("Offline gate passed; no inference was called."); return;
  }
  if (command === "freeze" && args.length === 1) {
    const inventory = await baselineInventory("https://github.com/abishek1303/docsyde");
    const manifest = reliabilityBaselineSchema.parse({ version: 1, specificationVersion: 2, experimentId: context.experimentId,
      runtimePolicySha256: documentationHash(scenarios.map(scenario => Object.fromEntries(Object.entries(scenarioWorkflow(scenario)).filter(([key]) => key !== "runtime")))), runContext: null, docsydeSha: code.sha, requestDeskBase: REQUEST_DESK_BASE,
      repository: "https://github.com/abishek1303/docsyde", sourceDatabase: inventory.databaseName, serverIdentity: databaseServerIdentity(),
      code: await Promise.all(code.files.map(fileReceipt)), inference: baselineInference(), environment: baselineEnvironment(),
      documents: inventory.documents, publications: inventory.publications, contextSha256: inventory.contextSha256, schemaFingerprintVersion: inventory.schemaFingerprintVersion, schemaSha256: inventory.schemaSha256 });
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
    await output(args[1], { experimentId: context.experimentId, scenario: context.scenario, docsydeSha: context.docsydeSha, ...result, source: plan.source, input: await fileReceipt(args[0]), inspectedAt: new Date().toISOString(), inferenceCalls: 0 });
    console.log(result.eligible ? "Single-batch admission passed; zero inference calls." : "Outside single-batch baseline scope; zero inference calls.");
    if (!result.eligible) process.exitCode = 2;
    return;
  }
  if (command === "github" && args.length === 3) {
    const [branch, head, path] = args;
    if (!context.scenario) throw new Error("Scenario context required.");
    assertScenarioContext(context, context.scenario, head);
    z.string().regex(/^[a-f0-9]{40}$/).parse(head);
    const { createGithubClient } = await import("@/integrations/github/client");
    const client = await createGithubClient();
    const ref = await client.rest.git.getRef({ owner: "abishek1303", repo: "docsyde", ref: `heads/${branch}` });
    if (ref.data.object.sha !== head) throw new Error("Remote branch does not match pinned head.");
    const commit = await client.rest.repos.getCommit({ owner: "abishek1303", repo: "docsyde", ref: head });
    if (commit.data.parents.length !== 1 || commit.data.parents[0].sha !== REQUEST_DESK_BASE) throw new Error("Scenario must have exactly one parent: the common base.");
    const comparison = await compareCommits({ owner: "abishek1303", repo: "docsyde", base: REQUEST_DESK_BASE, head });
    if (comparison.head.commitId !== head || comparison.base.commitId !== REQUEST_DESK_BASE || comparison.commits.length !== 1) throw new Error("GitHub comparison must contain exactly the independent scenario commit.");
    await output(path, { version: 2, experimentId: context.experimentId, scenario: context.scenario, docsydeSha: context.docsydeSha, passed: true, base: REQUEST_DESK_BASE, head, branch, checkedAt: new Date().toISOString() });
    console.log("GitHub comparison readable; no refs changed and no inference."); return;
  }
  if (command === "seal" && args.length === 3) {
    const baseline = reliabilityBaselineSchema.parse(await json(args[0]));
    const spec = z.object({ scenario: z.enum(scenarios), databaseName: z.string(), head: z.string(), branch: z.string(), runContext: z.string().nullable(),
      runtimePath: z.string(), batchReportPath: z.string(), offlineGatePath: z.string(), githubGatePath: z.string() }).strict().parse(await json(args[1]));
    const { runRuntimeConfigSchema } = await import("@/features/documentation/runs/run-runtime-config");
    const { documentationHash } = await import("@/features/documentation/documents/document-identity");
    assertScenarioContext(context, spec.scenario, spec.head);
    if (resolve(args[2]) !== context.manifestPath) throw new Error("Manifest output does not match context.");
    const runtime = runRuntimeConfigSchema.parse(await json(spec.runtimePath));
    const manifest = reliabilityManifestSchema.parse({ version: 2, experimentId: context.experimentId, runtimeIdentity: context.runtimeIdentity, baseline, scenario: spec.scenario, databaseName: spec.databaseName,
      head: spec.head, branch: spec.branch, runContext: spec.runContext,
      runtime: await fileReceipt(spec.runtimePath), runtimeDescriptor: { id: runtime.id, version: runtime.version, sha256: documentationHash(runtime), capabilitiesSha256: documentationHash(runtime.capabilities) }, representativeBatchCheck: await fileReceipt(spec.batchReportPath),
      offlineGate: await fileReceipt(spec.offlineGatePath), githubGate: await fileReceipt(spec.githubGatePath) });
    await assertReliabilityBaseline(manifest);
    await output(args[2], manifest); console.log("Scenario manifest sealed. Starting inference still requires separate authorization."); return;
  }
  if (command === "serve" && args.length >= 1 && args.length <= 2) {
    const port = z.string().regex(/^[1-9][0-9]{3,4}$/).parse(args[1] ?? "3000");
    if (Number(port) > 65535 || resolve(args[0]) !== context.manifestPath || !process.env.DATABASE_URL) throw new Error("Explicit application configuration required.");
    const manifest = reliabilityManifestSchema.parse(await json(args[0]));
    await assertReliabilityBaseline(manifest);
    const child = spawnOwned(context, process.execPath, [resolve(context.repositoryRoot, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", port],
      { cwd: context.repositoryRoot, env: reliabilityEnvironment(context, process.env.DOCSYDE_RELIABILITY_CONTEXT!, "application", {
        NODE_ENV: "production", DATABASE_URL: process.env.DATABASE_URL, DOCSYDE_RELIABILITY_MANIFEST: context.manifestPath!, DOCSYDE_RUN_RUNTIME_CONFIG: manifest.runtime.path }), stdio: "ignore" });
    const stop = () => { void stopOwned(context, child).catch(() => { process.exitCode = 1; }); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    try {
      await output(join(context.outputRoot, "docsyde-process.json"), { pid: child.pid, port, experimentId: context.experimentId, scenario: context.scenario, docsydeSha: context.docsydeSha });
      console.log("Owned DocSyde server starting; no run or inference is started by this command.");
      await new Promise<void>((resolve, reject) => { child.once("exit", code => code ? reject(new Error("Owned DocSyde exited.")) : resolve()); child.once("error", reject); });
    } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); await stopOwned(context, child); }
    return;
  }
  if (command === "host" && args.length >= 2 && args.length <= 3) {
    if (!context.runtimeIdentity || resolve(args[0]) !== context.manifestPath) throw new Error("Host context mismatch.");
    try {
      const manifest = reliabilityManifestSchema.parse(await json(args[0]));
      assertScenarioContext(context, manifest.scenario, manifest.head);
      if (manifest.experimentId !== context.experimentId) throw new Error("Host experiment mismatch.");
      assertRuntimeIdentity(context.runtimeIdentity, manifest.runtimeIdentity);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      await verifyOfflineReceipt(context, args[2] ?? join(context.outputRoot, "offline/offline-gate.json"));
    }
    const directory = await freshEvidence(context, join(context.outputRoot, "host"));
    const built = await buildRequestDesk(context, resolve(args[1]), join(directory.path, "build"), true);
    assertRuntimeIdentity(context.runtimeIdentity, built.identity);
    const child = spawnOwned(context, process.execPath, ["--conditions=react-server", "--import", "tsx", resolve(context.repositoryRoot, "infra/local/reliability/request-desk-host.ts"), built.app],
      { cwd: context.repositoryRoot, env: reliabilityEnvironment(context, process.env.DOCSYDE_RELIABILITY_CONTEXT!, "host", {
        DOCSYDE_REPOSITORY_OWNER: "abishek1303", DOCSYDE_REPOSITORY_NAME: "docsyde", DOCSYDE_DELIVERY_ENDPOINT: process.env.DOCSYDE_DELIVERY_ENDPOINT ?? "http://127.0.0.1:3000/api/documentation/context" }), stdio: "ignore" });
    const stop = () => { void stopOwned(context, child).catch(() => { process.exitCode = 1; }); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    try {
      await output(join(context.outputRoot, "host-process.json"), { pid: child.pid, experimentId: context.experimentId, scenario: context.scenario, runtimeIdentity: built.identity });
      // Querying identity is mandatory before this host can be used by capture.
      console.log("Owned Request Desk starting; capture independently verifies /health identity.");
      await new Promise<void>((resolve, reject) => { child.once("exit", code => code ? reject(new Error("Owned host exited.")) : resolve()); child.once("error", reject); });
    } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); await stopOwned(context, child); }
    return;
  }
  if (command === "clone" && args.length === 3) {
    const { createDatabaseCopies } = await import("./database-copies");
    await ownedPath(context, args[1]);
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
    await ownedPath(context, args[3]);
    await writeComparison(args.slice(0, 3), args[3]); console.log("Comparison written; no inference."); return;
  }
  throw new Error("Usage: reliability scenarios [output-directory] | offline A|B|C checkout output | freeze output.json | batch input.json output.json | github branch head output.json | seal baseline.json spec.json output.json | host manifest.json checkout [offline-gate.json] | serve manifest.json [port] | clone baseline.json new-output-directory docsyde_reliability_unique_prefix | report manifest run-id publication-proof-or-dash output.json | compare A.json B.json C.json output.md");
}
main().catch(error => {
  // Never print provider/driver messages that may contain credentials or source payloads.
  console.error(error instanceof z.ZodError ? "Reliability input/evidence schema rejected." : "Reliability command stopped. Check documented inputs, clean checkouts and local prerequisites. No inference is performed by this CLI.");
  if (["scenarios", "offline"].includes(process.argv[2]) && error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}).finally(closeDatabase);
