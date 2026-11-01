import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseReliabilityContext, requireReliabilityContext } from "@/integrations/reliability/execution-context";
import { prepareOwnedRoot, writeOwnedJson } from "@/integrations/reliability/owned-resources";
import { reliabilityEnvironment } from "@/integrations/reliability/subprocess-environment";

async function main() {
  const browser = process.argv[2] === "browser", root = process.cwd(), experimentId = `test-suite-${randomUUID()}`;
  const context = parseReliabilityContext({ version: 1, experimentId, scenario: null, mode: "offline", repositoryRoot: root,
    docsydeSha: "0".repeat(40), requestDeskSha: null, outputRoot: join(root, ".artifacts/reliability", experimentId, "shared"), runtimeIdentity: null, manifestPath: null });
  await prepareOwnedRoot(context);
  const contextPath = join(context.outputRoot, "context.json");
  await writeOwnedJson(context, contextPath, context);
  process.env.DOCSYDE_RELIABILITY_CONTEXT = contextPath; requireReliabilityContext(["offline"]);
  const tests = browser ? ["infra/local/reliability/offline-fixture.integration.ts"]
    : ["src/integrations/ai/inference-budget.test.ts", ...(await readdir(join(root, "infra/local/reliability"))).filter(file => file.endsWith(".test.ts")).sort().map(file => `infra/local/reliability/${file}`)];
  const result = await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "--test", ...tests],
    { cwd: root, env: reliabilityEnvironment(context, contextPath, "tools"), timeout: browser ? 360_000 : 120_000, maxBuffer: 16 * 1024 * 1024 });
  await writeFile(join(context.outputRoot, "tests.txt"), result.stdout + result.stderr, { flag: "wx", mode: 0o600 });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
}
main().catch(error => {
  // Child environments contain no provider/database credentials. Preserve test
  // assertion output, without serializing the command options/environment.
  if (error instanceof Error && "stdout" in error && typeof error.stdout === "string") process.stdout.write(error.stdout);
  if (error instanceof Error && "stderr" in error && typeof error.stderr === "string") process.stderr.write(error.stderr);
  console.error("Reliability verification stopped."); process.exitCode = 1;
});
