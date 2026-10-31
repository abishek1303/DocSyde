import "dotenv/config";
import { readFile } from "node:fs/promises";
import { captureWorkflowWithRuntime } from "@/runner/runtime/capture-workflow";
import { workflowRuntimeConfigSchema } from "@/runner/runtime/workflow-config";
import { getArtifactStorage } from "@/integrations/storage/storage";
import { analyzeRuntimeVisuals } from "@/features/sources/analyze-runtime-visuals";
import { validateProductResult } from "@/features/sources/validate-product-result";
import { synthesizeProductImpact } from "@/features/sources/synthesize-product-impact";
import { planDocumentationImpact } from "@/features/documentation/plan-documentation-impact";

const configSchema = workflowRuntimeConfigSchema;

async function main() {
  const [configPath, sourcePath, ...extra] = process.argv.slice(2);
  if (!configPath || !sourcePath || extra.length) throw new Error("Expected trusted workflow configuration and validated source-result JSON paths.");
  const config = configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  const source = validateProductResult(JSON.parse(await readFile(sourcePath, "utf8")));
  if (source.status === "no-change") throw new Error("The proof requires source findings for impact synthesis.");
  const storage = getArtifactStorage(), controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  // Manifests are ordinary local artifacts, not a run-record repository. They
  // contain no launch configuration, environment values, selectors or input values.
  const save = async (value: unknown) => (await storage.store(Buffer.from(JSON.stringify(value)))).key;
  try {
    const { trace } = await captureWorkflowWithRuntime(config, storage, controller.signal);
    const traceArtifact = await save(trace);
    const secrets = [...config.workflow.secrets, ...config.workflow.steps.flatMap(step => step.type === "fill" || step.type === "select" ? [step.value] : [])];
    const result = await analyzeRuntimeVisuals({ source, trace, description: config.description,
      maxSelectedScreenshots: config.maxSelectedScreenshots, secrets }, storage, controller.signal);
    const analysisArtifact = await save(result);
    console.log(JSON.stringify({ traceArtifact, analysisArtifact, status: result.status, reason: result.reason, selected: result.runtime.length }));
    if (result.status === "incomplete") { process.exitCode = 1; return; }
    if (result.status === "disabled") return;
    const impact = await synthesizeProductImpact({ source, runtime: result.runtime }, { signal: controller.signal });
    const impactArtifact = await save(impact);
    // Planning only. Existing persistence operations load saved candidates and
    // preserve source-support restrictions; this never mutates documentation.
    const plan = await planDocumentationImpact({ impact: impact.impact }, { signal: controller.signal });
    console.log(JSON.stringify({ impactArtifact, planArtifact: await save(plan), assessment: impact.impact.assessment, decisions: plan.plan.decisions.length }));
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  }
}

main().catch(() => {
  console.error("Visual workflow proof failed or is incomplete. Check trusted configuration, source evidence, Chromium, storage, providers and documentation candidates. Nothing was published.");
  process.exitCode = 1;
});
