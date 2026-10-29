import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import assert from "node:assert/strict";
async function main() {
  const code = await readFile(".artifacts/sdk/context-client.js", "utf8");
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/client.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/client.js" ? code : '<h1>SDK verification</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch(); const page = await browser.newPage();
    const address = server.address(); assert.ok(address && typeof address !== "string");
    await page.goto(`http://127.0.0.1:${address.port}`);
    const result = await page.evaluate(async () => {
      // Load the independently compiled browser ESM entry, not a test reimplementation.
      const url = new URL('/client.js', location.href).href;
      const sdk = await import(/* webpackIgnore: true */ url);
      const client = sdk.createDocsydeClient({ applicationId: "proof" });
      const routes: string[] = []; const unsubscribe = client.subscribe((c: { route: string }) => routes.push(c.route));
      client.setContext({ route: "/first" }); client.setContext({ route: "/second", featureIds: ["settings"] }); unsubscribe();
      const snapshot = JSON.parse(document.getElementById("docsyde-context")!.textContent!);
      client.destroy(); return { routes, snapshot, removed: !document.getElementById("docsyde-context") };
    });
    assert.deepEqual(result.routes, ["/first", "/second"]); assert.equal(result.snapshot.route, "/second"); assert.ok(result.removed);
    console.log("PASS: browser SDK registration, subscriptions, snapshot, cleanup");
  } finally { await browser?.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}
main().catch(() => { console.error("SDK browser proof failed; build SDK and install Chromium first."); process.exitCode = 1; });
