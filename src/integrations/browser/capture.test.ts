import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import { chromium, type Page, type PageScreenshotOptions } from "playwright";
import { captureRuntimeContext } from "@/integrations/browser/capture";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";

const artifactKey = "12345678-1234-4234-8234-123456789abc";
const hostContext = { version: 1, applicationId: "proof", route: "/", featureIds: ["form"] };
const html = `<title>Proof</title><h1>Before</h1>
<script id="docsyde-context" type="application/json">${JSON.stringify(hostContext)}</script>
<input aria-label="Name"><select aria-label="Choice"><option value="A">A</option><option value="B">B</option></select>
<input type="checkbox" aria-label="Enabled">
<button onclick="document.querySelector('h1').textContent='After'">Change</button>`;

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "docsyde-capture-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputDirectory = join(root, "manifests");
  const server = createServer((req, res) => {
    if (req.url === "/failure") res.writeHead(500);
    res.end(req.url === "/invalid-context" ? html.replace(JSON.stringify(hostContext), "{}") : html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const stored = new Map<string, Uint8Array>();
  const state = { screenshotCalls: 0, closeCalls: 0, closed: false, png: undefined as Buffer | undefined };
  const storage: ArtifactStorage = {
    async store(bytes) {
      assert.equal(state.closed, true);
      assert.strictEqual(bytes, state.png);
      stored.set(artifactKey, bytes);
      return { key: artifactKey };
    },
    async read(key) { return stored.get(key) ?? null; },
  };
  const store = t.mock.method(storage, "store", storage.store);
  let preparePage: (page: Page) => void = () => {};
  let afterClose = async () => {};
  const launch = chromium.launch.bind(chromium);
  t.mock.method(chromium, "launch", async (...args: Parameters<typeof chromium.launch>) => {
    const browser = await launch(...args);
    // Always release the real browser even when a test makes close reject.
    const close = browser.close.bind(browser);
    t.after(() => close());
    t.mock.method(browser, "close", async () => {
      state.closeCalls++;
      await close();
      await afterClose();
      state.closed = true;
    });
    const newContext = browser.newContext.bind(browser);
    t.mock.method(browser, "newContext", async (...args: Parameters<typeof browser.newContext>) => {
      const context = await newContext(...args);
      const newPage = context.newPage.bind(context);
      t.mock.method(context, "newPage", async () => {
        const page = await newPage();
        const screenshot = page.screenshot.bind(page);
        t.mock.method(page, "screenshot", async (options?: PageScreenshotOptions) => {
          state.screenshotCalls++;
          assert.equal(options?.path, undefined);
          state.png = await screenshot(options);
          return state.png;
        });
        preparePage(page);
        return page;
      });
      return context;
    });
    return browser;
  });
  return { root, outputDirectory, baseUrl, storage, store, stored, state,
    preparePage(fn: typeof preparePage) { preparePage = fn; },
    afterClose(fn: typeof afterClose) { afterClose = fn; } };
}

async function assertAbsent(path: string) {
  await assert.rejects(fs.stat(path), { code: "ENOENT" });
}

test("one in-memory PNG is stored after cleanup; evidence and manifest reference only its key", async (t) => {
  const f = await fixture(t);
  let captureFinishedAt = 0;
  f.preparePage(page => {
    const title = page.title.bind(page);
    t.mock.method(page, "title", async () => { captureFinishedAt = Date.now(); return title(); });
  });
  let cleanupAt = 0;
  f.afterClose(async () => { cleanupAt = Date.now(); });
  const result = await captureRuntimeContext({ baseUrl: f.baseUrl,
    outputDirectory: relative(process.cwd(), f.outputDirectory),
    readySelector: "h1", steps: [
      { type: "fill", selector: "input[aria-label=Name]", value: "Ada" },
      { type: "select", selector: "select", value: "B" },
      { type: "check", selector: "input[type=checkbox]", checked: true },
      { type: "click", selector: "button" }, { type: "waitFor", selector: "h1" },
    ], regions: [{ name: "heading", selector: "h1" },
      { name: "selection", selector: "select:has(option:checked[value=B])" },
      { name: "enabled", selector: "input:checked" }],
  }, f.storage);
  assert.equal(f.state.screenshotCalls, 1);
  assert.equal(f.store.mock.callCount(), 1);
  assert.equal(f.state.closeCalls, 1);
  const png = f.state.png; assert.ok(png);
  assert.strictEqual(f.store.mock.calls[0].arguments[0], png);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1440); assert.equal(png.readUInt32BE(20), 900);
  assert.deepEqual(result.screenshot, { artifactKey, mimeType: "image/png",
    sha256: crypto.createHash("sha256").update(png).digest("hex") });
  assert.ok(Date.parse(result.capturedAt) >= captureFinishedAt);
  assert.ok(Date.parse(result.capturedAt) <= cleanupAt);
  assert.deepEqual(result.dom.headings, ["After"]);
  assert.equal(result.dom.truncated, false);
  assert.deepEqual(result.hostContext, hostContext);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.title, "Proof"); assert.equal(result.finalUrl, `${f.baseUrl}/`);
  assert.equal(result.navigationStatus, 200);
  assert.equal(result.regions[0].text, "After"); assert.ok(result.regions[0].bounds);
  const directory = join(f.outputDirectory, result.captureId);
  const manifest = JSON.parse(await fs.readFile(join(directory, "evidence.json"), "utf8"));
  assert.deepEqual(manifest, result);
  assert.equal("path" in result.screenshot, false);
  assert.equal("path" in manifest.screenshot, false);
  assert.deepEqual(await fs.readdir(directory), ["evidence.json"]);
});

test("invalid-context warnings and diagnostics remain bounded and snapshotted", async (t) => {
  for (const count of [1, 101]) {
    await t.test(`${count} capture diagnostics`, async t => {
      const f = await fixture(t);
      let diagnostic: (() => void) | undefined;
      f.preparePage(page => {
        const on = page.on.bind(page);
        t.mock.method(page, "on", (event: "pageerror", listener: (error: Error) => void) => {
          if (event === "pageerror") diagnostic = () => listener(new Error("private error"));
          return on(event, listener);
        });
        const screenshot = page.screenshot.bind(page);
        t.mock.method(page, "screenshot", async (options?: PageScreenshotOptions) => {
          for (let i = 0; i < count; i++) diagnostic?.();
          return screenshot(options);
        });
      });
      // Errors during cleanup must not mutate the captured snapshot.
      f.afterClose(async () => { diagnostic?.(); });
      const result = await captureRuntimeContext({ baseUrl: f.baseUrl, path: "/invalid-context",
        outputDirectory: f.outputDirectory }, f.storage);
      assert.equal(result.hostContext, null);
      assert.deepEqual(result.warnings, ["Invalid SDK context"]);
      assert.equal(result.diagnostics.length, Math.min(count, 100));
      assert.ok(result.diagnostics.every(value => value === "Page script error"));
      assert.equal(result.diagnosticsTruncated, count > 100);
    });
  }
});

test("capture and screenshot failures close the browser without storing or creating manifests", async (t) => {
  for (const stage of ["navigation", "screenshot"] as const) {
    await t.test(stage, async t => {
      const f = await fixture(t);
      if (stage === "screenshot") f.preparePage(page => {
        t.mock.method(page, "screenshot", async () => { throw new Error("Screenshot failed"); });
      });
      await assert.rejects(captureRuntimeContext({ baseUrl: f.baseUrl,
        path: stage === "navigation" ? "/failure" : "/", outputDirectory: f.outputDirectory }, f.storage), /Browser capture failed/);
      assert.equal(f.state.closed, true);
      assert.equal(f.store.mock.callCount(), 0);
      await assertAbsent(f.outputDirectory);
    });
  }
});

test("cleanup rejection prevents storage and manifests", async (t) => {
  const f = await fixture(t);
  const failure = new Error("Cleanup failed");
  f.afterClose(async () => { throw failure; });
  await assert.rejects(captureRuntimeContext({ baseUrl: f.baseUrl, outputDirectory: f.outputDirectory }, f.storage), error => error === failure);
  assert.equal(f.state.screenshotCalls, 1);
  assert.equal(f.state.closeCalls, 1);
  assert.equal(f.store.mock.callCount(), 0);
  await assertAbsent(f.outputDirectory);
});

test("storage rejection propagates unchanged and cannot create a manifest directory", async (t) => {
  const f = await fixture(t);
  const failure = new Error("Storage failed");
  f.store.mock.mockImplementation(async bytes => {
    assert.equal(f.state.closed, true);
    assert.strictEqual(bytes, f.state.png);
    await assertAbsent(f.outputDirectory);
    throw failure;
  });
  await assert.rejects(captureRuntimeContext({ baseUrl: f.baseUrl, outputDirectory: f.outputDirectory }, f.storage), error => error === failure);
  assert.equal(f.store.mock.callCount(), 1);
  await assertAbsent(f.outputDirectory);
});

test("exclusive manifest failure rejects after storage without rollback or replacing content", async (t) => {
  const f = await fixture(t);
  const captureId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  t.mock.method(crypto, "randomUUID", () => captureId);
  const directory = join(f.outputDirectory, captureId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(join(directory, "evidence.json"), "existing manifest");
  await assert.rejects(captureRuntimeContext({ baseUrl: f.baseUrl, outputDirectory: f.outputDirectory }, f.storage), { code: "EEXIST" });
  assert.equal(f.store.mock.callCount(), 1);
  assert.strictEqual(await f.storage.read(artifactKey), f.state.png);
  assert.equal(await fs.readFile(join(directory, "evidence.json"), "utf8"), "existing manifest");
  assert.deepEqual(await fs.readdir(directory), ["evidence.json"]);
});

test("invalid input and off-origin targets fail before browser launch or storage", async (t) => {
  const launch = t.mock.method(chromium, "launch", async () => { throw new Error("Unexpected launch"); });
  const storage: ArtifactStorage = { async store() { throw new Error("Unexpected store"); }, async read() { return null; } };
  const store = t.mock.method(storage, "store", storage.store);
  for (const input of [
    { baseUrl: "http://127.0.0.1:3000", steps: [{ type: "evaluate", script: "alert(1)" }] },
    { baseUrl: "http://127.0.0.1:3000", steps: [{ type: "click", selector: "button", script: "alert(1)" }] },
    { baseUrl: "http://127.0.0.1:3000", viewport: { width: 0, height: 0 } },
    { baseUrl: "http://127.0.0.1:3000", path: "https://example.com" },
  ]) {
    await assert.rejects(captureRuntimeContext(JSON.parse(JSON.stringify(input)), storage));
  }
  assert.equal(launch.mock.callCount(), 0);
  assert.equal(store.mock.callCount(), 0);
});
