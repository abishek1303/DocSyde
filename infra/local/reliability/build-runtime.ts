import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { reliabilityEnvironment } from "@/integrations/reliability/subprocess-environment";
import { ownedPath, assertNoSymlink } from "@/integrations/reliability/owned-resources";
import { assertScenarioContext, type ReliabilityContext, type ReliabilityRuntimeIdentity } from "@/integrations/reliability/execution-context";
import { REQUEST_DESK_BASE } from "./workflows";

const exec = promisify(execFile);
export function runTool(context: ReliabilityContext, command: string, args: string[], cwd = context.repositoryRoot) {
  return exec(command, args, { cwd, env: reliabilityEnvironment(context, process.env.DOCSYDE_RELIABILITY_CONTEXT!, "tools"), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
}
export async function verifyScenarioCheckout(context: ReliabilityContext, checkout: string) {
  if (!context.scenario || !context.requestDeskSha) throw new Error("Scenario checkout identity required.");
  await assertNoSymlink(checkout);
  const head = (await runTool(context, "git", ["rev-parse", "HEAD"], checkout)).stdout.trim();
  assertScenarioContext(context, context.scenario, head);
  if ((await runTool(context, "git", ["rev-list", "--parents", "-n", "1", "HEAD"], checkout)).stdout.trim() !== `${head} ${REQUEST_DESK_BASE}`) throw new Error("Scenario requires exactly the common-base parent.");
  if ((await runTool(context, "git", ["status", "--porcelain", "--untracked-files=normal"], checkout)).stdout.trim()) throw new Error("Scenario checkout must be clean.");
  return head;
}
const runtimeFiles = ["dist/src/server.js", "dist/src/public/app.js", "dist/src/public/requests.js", "dist/src/public/contextual-help.js", "public/index.html", "public/styles.css", ".artifacts/sdk/context-client.js", ".artifacts/sdk/documentation-client.js"];
export async function requestDeskBuildHash(app: string) {
  const hash = createHash("sha256");
  for (const path of runtimeFiles) { await assertNoSymlink(join(app, path)); hash.update(path).update("\0").update(await readFile(join(app, path))).update("\0"); }
  return hash.digest("hex");
}
export async function buildRequestDesk(context: ReliabilityContext, checkout: string, destination: string, committed: boolean) {
  if (!context.scenario || !context.requestDeskSha) throw new Error("Scenario build identity required.");
  await ownedPath(context, destination);
  await mkdir(destination, { mode: 0o700 });
  if (committed) {
    await verifyScenarioCheckout(context, checkout);
    const archive = join(destination, "source.tar");
    await runTool(context, "git", ["archive", "--format=tar", `--output=${archive}`, context.requestDeskSha, "test-app"], checkout);
    await runTool(context, "tar", ["-xf", archive, "-C", destination]);
  } else {
    const { cp } = await import("node:fs/promises");
    await cp(join(checkout, "test-app"), join(destination, "test-app"), { recursive: true, errorOnExist: true, force: false });
  }
  const app = join(destination, "test-app");
  const sdk = await runTool(context, process.execPath, [resolve(context.repositoryRoot, "node_modules/typescript/bin/tsc"), "-p", resolve(context.repositoryRoot, "infra/local/sdk/tsconfig.json"), "--outDir", join(app, ".artifacts/sdk")]);
  const build = await runTool(context, process.execPath, [resolve(context.repositoryRoot, "node_modules/typescript/bin/tsc"), "-p", join(app, "tsconfig.json"), "--typeRoots", resolve(context.repositoryRoot, "node_modules/@types")]);
  const tests = await runTool(context, process.execPath, ["--test", join(app, "dist/tests/requests.test.js")]);
  const identity: ReliabilityRuntimeIdentity = Object.freeze({ version: 1, experimentId: context.experimentId, scenario: context.scenario,
    docsydeSha: context.docsydeSha, requestDeskSha: context.requestDeskSha, buildSha256: await requestDeskBuildHash(app), workflowVersion: "1", runtimeVersion: "request-desk-reliability-v1" });
  return { app, identity, buildLog: sdk.stdout + sdk.stderr + build.stdout + build.stderr, testLog: tests.stdout + tests.stderr };
}
