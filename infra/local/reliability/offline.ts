import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { scenarioWorkflow, REQUEST_DESK_BASE, type Scenario } from "./workflows";
import { runRuntimeConfigSchema } from "@/features/documentation/runs/run-runtime-config";
import { captureWorkflowWithRuntime } from "@/runner/runtime/capture-workflow";
import { createLocalStorage } from "@/integrations/storage/local-storage";
import { bytesHash } from "@/features/documentation/runs/reliability-baseline";
import { parseReliabilityContext, requireReliabilityContext, assertScenarioContext } from "@/integrations/reliability/execution-context";
import { freshEvidence, ownedPath, reserveAttempt } from "@/integrations/reliability/owned-resources";
import { reliabilityEnvironment, reliabilityBrowserOptions } from "@/integrations/reliability/subprocess-environment";
import { spawnOwned, closeBrowserAndChild } from "@/integrations/reliability/process-ownership";
import { verifyRuntimeIdentity } from "@/integrations/reliability/runtime-identity";
import { runTool, buildRequestDesk, verifyScenarioCheckout } from "./build-runtime";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { documentationHash } from "@/features/documentation/documents/document-identity";
const exec = promisify(execFile);

export async function exportScenario(scenario: Scenario, destination: string) {
  const context = requireReliabilityContext(["offline"]), root = context.repositoryRoot;
  assertScenarioContext(context, scenario);
  await ownedPath(context, destination);
  await mkdir(destination, { recursive: false });
  const archive = join(destination, "baseline.tar");
  await runTool(context, "git", ["archive", "--format=tar", `--output=${archive}`, REQUEST_DESK_BASE, "test-app"], root);
  await runTool(context, "tar", ["-xf", archive, "-C", destination]);
  await runTool(context, "git", ["apply", "--check", "--unsafe-paths", `--directory=${destination}`, resolve(root, `infra/local/reliability/scenarios/${scenario}.patch`)], root);
  await runTool(context, "git", ["apply", "--unsafe-paths", `--directory=${destination}`, resolve(root, `infra/local/reliability/scenarios/${scenario}.patch`)], root);
}
async function requireFreePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(45873, "127.0.0.1", resolve); });
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function ready(child: ReturnType<typeof spawnOwned>) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Owned Request Desk process exited before readiness.");
    try { if ((await fetch("http://127.0.0.1:45873/health", { redirect: "error", signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* bounded readiness only */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Request Desk readiness timeout.");
}
export async function verifyOfflineScenario(scenario: Scenario, checkout: string, output: string, requireCommit = true) {
  const context = requireReliabilityContext(["offline"]), root = context.repositoryRoot;
  assertScenarioContext(context, scenario);
  const head = requireCommit ? await verifyScenarioCheckout(context, checkout) : null;
  await reserveAttempt(context, "offline", { head, checkout });
  const evidence = await freshEvidence(context, output);
  const directory = evidence.path;
  try {
    if (requireCommit) {
      const changed = (await runTool(context, "git", ["diff", "--name-only", REQUEST_DESK_BASE, head!], checkout)).stdout.trim().split("\n");
      assert.ok(changed.every(path => ["test-app/src/public/app.ts", "test-app/src/public/requests.ts", "test-app/tests/requests.test.ts", "test-app/README.md"].includes(path)));
      const expected = join(directory, "expected"); await exportScenario(scenario, expected);
      for (const path of ["test-app/src/public/app.ts", "test-app/src/public/requests.ts", "test-app/tests/requests.test.ts", "test-app/README.md"]) {
        assert.equal(bytesHash(await readFile(join(checkout, path))), bytesHash(await readFile(join(expected, path))), "Scenario commit differs from its reviewed patch");
      }
    }
    const contractPaths = ["src/integrations/ai/inference-budget.test.ts", "src/features/sources/analysis/product-change.test.ts",
      "src/features/sources/runtime/inspection-decision.test.ts", "src/features/documentation/planning/documentation-impact.test.ts",
      "src/features/documentation/transformation/transformation.test.ts", "infra/local/documentation/priority-contract.test.ts"];
    const contracts = await exec(process.execPath, ["--conditions=react-server", "--import", "tsx", "--import", resolve(root, "infra/local/reliability/offline-preload.ts"), "--test", ...contractPaths],
      { cwd: root, env: reliabilityEnvironment(context, process.env.DOCSYDE_RELIABILITY_CONTEXT!, "contracts"), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    await writeFile(join(directory, "contracts.txt"), contracts.stdout + contracts.stderr, { flag: "wx", mode: 0o600 });
    const built = await buildRequestDesk(context, checkout, join(directory, "build"), requireCommit);
    await writeFile(join(directory, "build.txt"), built.buildLog, { flag: "wx", mode: 0o600 });
    await writeFile(join(directory, "tests.txt"), built.testLog, { flag: "wx", mode: 0o600 });
    const fixtureContext = parseReliabilityContext({ ...context, runtimeIdentity: built.identity });
    const contextPath = join(directory, "fixture-context.json");
    await writeFile(contextPath, JSON.stringify(fixtureContext), { flag: "wx", mode: 0o600 });
    await requireFreePort();
    const child = spawnOwned(context, process.execPath, ["--conditions=react-server", "--import", "tsx", resolve(root, "infra/local/reliability/request-desk-host.ts"), built.app],
      { cwd: root, stdio: "ignore", env: reliabilityEnvironment(fixtureContext, contextPath, "host", {
        DOCSYDE_REPOSITORY_OWNER: "abishek1303", DOCSYDE_REPOSITORY_NAME: "docsyde", DOCSYDE_DELIVERY_ENDPOINT: "http://127.0.0.1:3000/api/documentation/context" }) });
    const childError = new Promise<never>((_, reject) => child.once("error", reject));
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await Promise.race([ready(child), childError]);
      await verifyRuntimeIdentity("http://127.0.0.1:45873", built.identity);
      assert.equal(child.exitCode, null, "Owned Request Desk process must still be running");
      browser = await chromium.launch({ headless: true, ...await reliabilityBrowserOptions(context) });
      const browserVersion = browser.version();
      const browserContext = await browser.newContext();
      await browserContext.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:45873" ? route.continue() : route.abort());
      const page = await browserContext.newPage();
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      for (const path of ["/requests", "/requests/new", "/requests/r-001", "/requests/r-002"]) {
        assert.equal((await page.goto(`http://127.0.0.1:45873${path}`))?.status(), 200);
        await page.locator('[data-ready="true"]').waitFor();
        assert.equal((await page.reload())?.status(), 200);
        await page.locator('[data-ready="true"]').waitFor();
      }
      const stored = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("request-desk-baseline") ?? "[]") as { id: string; status: string; priority?: string }[]);
      if (scenario === "A") {
        await page.goto("http://127.0.0.1:45873/requests/new");
        assert.equal(await page.locator("#priority").inputValue(), "urgent");
        await page.screenshot({ path: join(directory, "initial-default.png") });
        await page.locator("#title").fill("Default priority"); await page.locator('button[type="submit"]').click();
        await page.locator("#request-detail").waitFor();
        assert.equal((await stored()).find(request => request.id === "r-003")?.priority, "urgent");
        await page.goto("http://127.0.0.1:45873/requests/new");
        await page.locator("#priority").selectOption("normal"); await page.locator("#title").fill("Explicit normal"); await page.locator('button[type="submit"]').click();
        await page.locator("#request-detail").waitFor();
        assert.equal((await stored()).find(request => request.id === "r-004")?.priority, "normal");
        await page.evaluate(() => sessionStorage.setItem("request-desk-baseline", JSON.stringify([{ id: "r-001", title: "Legacy", description: "", status: "open" }])));
        await page.goto("http://127.0.0.1:45873/requests/r-001");
        assert.match(await page.locator("#request-detail").innerText(), /Priority: Normal/);
      } else if (scenario === "B") {
        await page.goto("http://127.0.0.1:45873/requests/r-001");
        assert.equal(await page.locator("#request-status").innerText(), "Status: open");
        await page.locator("#close-request").click(); await page.locator("#close-confirmation").waitFor();
        assert.equal(await page.locator("#request-status").innerText(), "Status: open");
        await page.screenshot({ path: join(directory, "confirmation.png") });
        await page.locator("#cancel-close").click(); assert.equal(await page.locator("#request-status").innerText(), "Status: open");
        await page.locator("#close-request").click(); await page.locator("#confirm-close").click();
        assert.equal(await page.locator("#request-status").innerText(), "Status: closed");
        assert.equal((await stored()).find(request => request.id === "r-001")?.status, "closed");
        await page.locator("#reopen-request").click(); assert.equal(await page.locator("#request-status").innerText(), "Status: open");
      } else {
        await page.goto("http://127.0.0.1:45873/requests"); assert.match(await page.locator("#request-list").innerText(), /Resolved/);
        await page.goto("http://127.0.0.1:45873/requests/r-002"); assert.equal(await page.locator("#request-status").innerText(), "Status: Resolved");
        await page.screenshot({ path: join(directory, "resolved.png") });
        await page.goto("http://127.0.0.1:45873/requests/r-001"); await page.locator("#close-request").click();
        assert.equal((await stored()).find(request => request.id === "r-001")?.status, "closed");
        assert.equal(await page.locator("#request-status").innerText(), "Status: Resolved");
        await page.reload(); assert.equal(await page.locator("#request-status").innerText(), "Status: Resolved");
        await page.locator("#reopen-request").click(); assert.equal((await stored()).find(request => request.id === "r-001")?.status, "open");
        assert.ok((await stored()).every(request => request.status !== "resolved"));
      }
      assert.deepEqual(errors, []);
      await browserContext.close(); await browser.close(); browser = undefined;
      const runtime = runRuntimeConfigSchema.parse(scenarioWorkflow(scenario));
      const runtimeText = JSON.stringify(runtime, null, 2);
      await writeFile(join(directory, "runtime.json"), runtimeText, { mode: 0o600 });
      const capture = await captureWorkflowWithRuntime(runtime, createLocalStorage(join(directory, "images")), undefined, built.identity);
      assert.equal(child.exitCode, null, "Runner must inspect the owned host process");
      assert.equal(capture.trace.coverage.pageErrors, 0);
      assert.equal(capture.trace.coverage.dismissedDialogs, 0);
      assert.ok(capture.trace.checkpoints.some(checkpoint => checkpoint.eligible));
      const texts = capture.trace.states.map(state => state.snapshot.text);
      if (scenario === "A") assert.ok(texts.some(text => text.includes("Priority: Urgent")));
      if (scenario === "B") { assert.ok(texts.some(text => text.includes("Confirm close") && text.includes("Cancel"))); assert.ok(texts.some(text => text.includes("Status: closed"))); }
      if (scenario === "C") assert.ok(texts.some(text => text.includes("Status: Resolved")));
      await writeFile(join(directory, "trace.json"), JSON.stringify(capture, null, 2), { mode: 0o600 });
      const sourceHashes = Object.fromEntries(await Promise.all(["src/public/app.ts", "src/public/requests.ts", "tests/requests.test.ts", "README.md"].map(async path => [path, bytesHash(await readFile(join(checkout, "test-app", path)))])));
      const files = ["contracts.txt", "build.txt", "tests.txt", "runtime.json", "trace.json", ...(scenario === "A" ? ["initial-default.png"] : scenario === "B" ? ["confirmation.png"] : ["resolved.png"]), ...(await readdir(join(directory, "images"))).map(name => `images/${name}`)];
      const evidenceFiles = await Promise.all(files.sort().map(async path => ({ path, sha256: bytesHash(await readFile(join(directory, path))) })));
      const contractConfigSha256 = documentationHash(await Promise.all(contractPaths.map(async path => ({ path, sha256: bytesHash(await readFile(join(root, path))) }))));
      const receipt = { version: 2, experimentId: context.experimentId, docsydeSha: context.docsydeSha,
        browserVersion, directoryId: evidence.token, evidenceDirectory: evidence.target, runtimeIdentity: built.identity, evidenceFiles, contractConfigSha256,
        workflowSha256: documentationHash(runtime), capabilitiesSha256: documentationHash(runtime.capabilities), passed: true, scenario, base: REQUEST_DESK_BASE, head, runtimeSha256: bytesHash(runtimeText), sourceHashes,
        checkedAt: new Date().toISOString(), inferenceCalls: 0, checks: ["build", "tests", "direct-navigation", "refresh", "scenario-behavior", "trusted-workflow", "docsyde-contracts"] };
      await closeBrowserAndChild(context, browser, child);
      await evidence.finalize(receipt);
      return receipt;
    } finally {
      await closeBrowserAndChild(context, browser, child);
    }
  } catch (error) {
    const detail = error instanceof Error && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
    await writeFile(join(directory, "failure.json"), JSON.stringify({ experimentId: context.experimentId, scenario,
      outcome: "harness-check-failed", paidCalls: 0 }), { flag: "wx", mode: 0o600 }).catch(() => {});
    if (detail) await writeFile(join(directory, "failure-output.txt"), detail, { flag: "wx", mode: 0o600 }).catch(() => {});
    throw error;
  }
}
