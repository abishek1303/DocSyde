import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureRuntimeContext } from "@/integrations/browser/capture";
test("scripted capture records screenshots and DOM evidence independently of models and runner", async () => {
  const server = createServer((_req, res) => res.end('<title>Proof</title><h1>Before</h1><button onclick="document.querySelector(\'h1\').textContent=\'After\'">Change</button>'));
  const outputDirectory = await mkdtemp(join(tmpdir(), "docsyde-capture-"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const result = await captureRuntimeContext({ baseUrl, outputDirectory, steps: [{ type: "click", selector: "button" }], regions: [{ name: "heading", selector: "h1" }] });
    assert.deepEqual(result.dom.headings, ["After"]); assert.equal(result.hostContext, null); assert.equal(result.regions[0].text, "After");
    const png = await readFile(result.screenshot.path);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), 1440); assert.equal(png.readUInt32BE(20), 900);
    assert.ok(result.regions[0].bounds);
    await assert.rejects(captureRuntimeContext({ baseUrl, path: "https://example.com" }));
    await assert.rejects(captureRuntimeContext({ baseUrl, steps: [{ type: "click", selector: "missing" }], readySelector: "h1", outputDirectory, ...{ viewport: { width: 0, height: 0 } } }));
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(outputDirectory, { recursive: true, force: true }); }
});

test("capture rejects arbitrary JavaScript and unknown action fields before browser launch", async () => {
  await assert.rejects(captureRuntimeContext(JSON.parse('{"baseUrl":"http://127.0.0.1:3000","steps":[{"type":"evaluate","script":"alert(1)"}]}')));
  await assert.rejects(captureRuntimeContext(JSON.parse('{"baseUrl":"http://127.0.0.1:3000","steps":[{"type":"click","selector":"button","script":"alert(1)"}]}')));
});
