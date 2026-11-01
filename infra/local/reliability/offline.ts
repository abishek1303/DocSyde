import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, cp, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { scenarioWorkflow, REQUEST_DESK_BASE, type Scenario } from "./workflows";
import { runRuntimeConfigSchema } from "@/features/documentation/runs/run-runtime-config";
import { captureWorkflowWithRuntime } from "@/runner/runtime/capture-workflow";
import { createLocalStorage } from "@/integrations/storage/local-storage";
import { bytesHash } from "@/features/documentation/runs/reliability-baseline";
const exec = promisify(execFile);
const root = process.cwd();

export async function exportScenario(scenario: Scenario, destination: string) {
  await mkdir(destination, { recursive: false });
  const archive = join(destination, "baseline.tar");
  await exec("git", ["archive", "--format=tar", `--output=${archive}`, REQUEST_DESK_BASE, "test-app"], { cwd: root });
  await exec("tar", ["-xf", archive, "-C", destination]);
  await exec("git", ["apply", "--check", "--unsafe-paths", `--directory=${destination}`, resolve(root, `infra/local/reliability/scenarios/${scenario}.patch`)], { cwd: root });
  await exec("git", ["apply", "--unsafe-paths", `--directory=${destination}`, resolve(root, `infra/local/reliability/scenarios/${scenario}.patch`)], { cwd: root });
}
async function requireFreePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(45873, "127.0.0.1", resolve); });
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function ready(child: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Owned Request Desk process exited before readiness.");
    try { if ((await fetch("http://127.0.0.1:45873/health")).ok) return; } catch { /* bounded readiness only */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Request Desk readiness timeout.");
}
export async function verifyOfflineScenario(scenario: Scenario, checkout: string, output: string, requireCommit = true) {
  let head: string | null = null;
  if (requireCommit) {
    head = (await exec("git", ["rev-parse", "HEAD"], { cwd: checkout })).stdout.trim();
    assert.match(head, /^[a-f0-9]{40}$/);
    assert.equal((await exec("git", ["rev-parse", "HEAD^"], { cwd: checkout })).stdout.trim(), REQUEST_DESK_BASE);
    assert.equal((await exec("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: checkout })).stdout, "", "Scenario checkout must be clean");
    const actual = (await exec("git", ["diff", "--no-ext-diff", "--binary", REQUEST_DESK_BASE, head], { cwd: checkout })).stdout;
    // Exact tree equality below is stronger than matching patch formatting.
    assert.ok(actual.includes("test-app/src/public/app.ts"));
    const changed = (await exec("git", ["diff", "--name-only", REQUEST_DESK_BASE, head], { cwd: checkout })).stdout.trim().split("\n");
    assert.ok(changed.every(path => ["test-app/src/public/app.ts", "test-app/src/public/requests.ts", "test-app/tests/requests.test.ts", "test-app/README.md"].includes(path)));
    const temporary = await mkdtemp(resolve(root, ".artifacts/reliability/expected-"));
    try {
      const expected = join(temporary, "checkout"); await exportScenario(scenario, expected);
      for (const path of ["test-app/src/public/app.ts", "test-app/src/public/requests.ts", "test-app/tests/requests.test.ts", "test-app/README.md"]) {
        assert.equal(bytesHash(await readFile(join(checkout, path))), bytesHash(await readFile(join(expected, path))), "Scenario commit differs from its reviewed patch");
      }
    } finally { await rm(temporary, { recursive: true }); }

  }
  await mkdir(output, { recursive: true, mode: 0o700 });
  const contracts = await exec(process.execPath, ["--conditions=react-server", "--import", "tsx", "--test",
    "src/integrations/ai/inference-budget.test.ts", "src/features/sources/analysis/product-change.test.ts",
    "src/features/sources/runtime/inspection-decision.test.ts", "src/features/documentation/planning/documentation-impact.test.ts",
    "src/features/documentation/transformation/transformation.test.ts", "infra/local/documentation/priority-contract.test.ts"], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(join(output, "contracts.txt"), contracts.stdout + contracts.stderr, { mode: 0o600 });
  await exec(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", resolve(root, "infra/local/sdk/tsconfig.json")]);
  await cp(resolve(root, ".artifacts/sdk"), join(checkout, "test-app/.artifacts/sdk"), { recursive: true });
  const build = await exec(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", join(checkout, "test-app/tsconfig.json")]);
  const tests = await exec(process.execPath, ["--test", join(checkout, "test-app/dist/tests/requests.test.js")]);
  await writeFile(join(output, "build.txt"), build.stdout + build.stderr, { mode: 0o600 });
  await writeFile(join(output, "tests.txt"), tests.stdout + tests.stderr, { mode: 0o600 });
  await requireFreePort();
  const child = spawn(process.execPath, [join(checkout, "test-app/dist/src/server.js")], { stdio: "ignore", env: { ...process.env,
    DOCSYDE_REPOSITORY_OWNER: "abishek1303", DOCSYDE_REPOSITORY_NAME: "docsyde", DOCSYDE_DELIVERY_ENDPOINT: "http://127.0.0.1:3000/api/documentation/context" } });
  const childError = new Promise<never>((_, reject) => child.once("error", reject));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await Promise.race([ready(child), childError]);
    assert.equal(child.exitCode, null, "Owned Request Desk process must still be running");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:45873" ? route.continue() : route.abort());
    const page = await context.newPage();
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
      await page.screenshot({ path: join(output, "initial-default.png") });
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
      await page.screenshot({ path: join(output, "confirmation.png") });
      await page.locator("#cancel-close").click(); assert.equal(await page.locator("#request-status").innerText(), "Status: open");
      await page.locator("#close-request").click(); await page.locator("#confirm-close").click();
      assert.equal(await page.locator("#request-status").innerText(), "Status: closed");
      assert.equal((await stored()).find(request => request.id === "r-001")?.status, "closed");
      await page.locator("#reopen-request").click(); assert.equal(await page.locator("#request-status").innerText(), "Status: open");
    } else {
      await page.goto("http://127.0.0.1:45873/requests"); assert.match(await page.locator("#request-list").innerText(), /Resolved/);
      await page.goto("http://127.0.0.1:45873/requests/r-002"); assert.equal(await page.locator("#request-status").innerText(), "Status: Resolved");
      await page.screenshot({ path: join(output, "resolved.png") });
      await page.goto("http://127.0.0.1:45873/requests/r-001"); await page.locator("#close-request").click();
      assert.equal((await stored()).find(request => request.id === "r-001")?.status, "closed");
      assert.equal(await page.locator("#request-status").innerText(), "Status: Resolved");
      await page.reload(); assert.equal(await page.locator("#request-status").innerText(), "Status: Resolved");
      await page.locator("#reopen-request").click(); assert.equal((await stored()).find(request => request.id === "r-001")?.status, "open");
      assert.ok((await stored()).every(request => request.status !== "resolved"));
    }
    assert.deepEqual(errors, []);
    await context.close(); await browser.close(); browser = undefined;
    const runtime = runRuntimeConfigSchema.parse(scenarioWorkflow(scenario));
    const runtimeText = JSON.stringify(runtime, null, 2);
    await writeFile(join(output, "runtime.json"), runtimeText, { mode: 0o600 });
    const capture = await captureWorkflowWithRuntime(runtime, createLocalStorage(join(output, "images")));
    assert.equal(child.exitCode, null, "Runner must inspect the owned host process");
    assert.equal(capture.trace.coverage.pageErrors, 0);
    assert.equal(capture.trace.coverage.dismissedDialogs, 0);
    assert.ok(capture.trace.checkpoints.some(checkpoint => checkpoint.eligible));
    const texts = capture.trace.states.map(state => state.snapshot.text);
    if (scenario === "A") assert.ok(texts.some(text => text.includes("Priority: Urgent")));
    if (scenario === "B") { assert.ok(texts.some(text => text.includes("Confirm close") && text.includes("Cancel"))); assert.ok(texts.some(text => text.includes("Status: closed"))); }
    if (scenario === "C") assert.ok(texts.some(text => text.includes("Status: Resolved")));
    await writeFile(join(output, "trace.json"), JSON.stringify(capture, null, 2), { mode: 0o600 });
    const sourceHashes = Object.fromEntries(await Promise.all(["src/public/app.ts", "src/public/requests.ts", "tests/requests.test.ts", "README.md"].map(async path => [path, bytesHash(await readFile(join(checkout, "test-app", path)))])));
    const receipt = { passed: true, scenario, base: REQUEST_DESK_BASE, head, runtimeSha256: bytesHash(runtimeText), sourceHashes,
      checkedAt: new Date().toISOString(), inferenceCalls: 0, checks: ["build", "tests", "direct-navigation", "refresh", "scenario-behavior", "trusted-workflow", "docsyde-contracts"] };
    await writeFile(join(output, "offline-gate.json"), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    return receipt;
  } finally {
    await browser?.close();
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise<void>(resolve => child.once("exit", () => resolve())); }
  }
}
