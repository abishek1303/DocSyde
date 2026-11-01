import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { captureWorkflowWithRuntime } from "@/runner/runtime/capture-workflow";
import { analyzeRuntimeVisuals } from "@/features/sources/runtime/analyze-runtime-visuals";
import { synthesizeProductImpact } from "@/features/sources/impact/synthesize-product-impact";
import { visualSourceFixture } from "./visual-fixtures";
import { draftFixture } from "../documentation/draft-fixture";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";

test("real workflow → selection → vision → synthesis → existing documentation planner retains grounding", async t => {
  const source = visualSourceFixture(); source.bundle.repository = "https://github.com/abishek1303/DocSyde";
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end('<h1>Create request</h1><input aria-label="Name"><button id="open" onclick="document.querySelector(\'dialog\').showModal()">Details</button><dialog><p>Request guidance</p><button id="close" onclick="document.querySelector(\'dialog\').close()">Close</button></dialog>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const bytes = new Map<string, Uint8Array>();
  const storage: ArtifactStorage = { async store(value) { const key = randomUUID(); bytes.set(key, value); return { key }; }, async read(key) { return bytes.get(key) ?? null; } };
  const originalFetch = globalThis.fetch;
  let completed = false, mode: "supported" | "visual-only" | "contradiction" = "supported", textCalls = 0, visionCalls = 0;
  for (const key of ["BASETEN_API_KEY", "META_API_KEY"] as const) {
    const old = process.env[key]; process.env[key] = "fixture";
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  let selectedCapture = "";
  const document = draftFixture();
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url).startsWith(baseUrl)) return originalFetch(String(url), init);
    assert.equal(completed, true, "No inference during browser/runtime execution");
    const body = JSON.parse(String(init?.body)), input = String(url).includes("baseten") ? JSON.parse(body.messages[1].content) : null;
    let output: unknown;
    if (!input) {
      visionCalls++;
      output = { elements: [], observations: ["Request guidance is visible."], limitations: ["Visible state only."] };
    } else {
      textCalls++;
      if (input.candidates) {
        const cp = input.candidates.find((cp: { stateId: string }) => input.states.some((state: { stateId: string; overlays: string[] }) => state.stateId === cp.stateId && state.overlays.length));
        assert.ok(cp, "Transient dialog checkpoint available without replay"); selectedCapture = cp.checkpointId;
        output = { decision: "analyze", reason: "Visible dialog guidance", selected: [{ checkpointId: selectedCapture, sourceRefs: ["source-1"], reason: "Check guidance", question: "What guidance is visible?" }], uncertainties: [] };
      } else if (input.visualReferences) {
        const visual = `visual:${selectedCapture}:observations:0`;
        output = { assessment: mode === "supported" ? "product-change" : "insufficient-evidence", summary: "Request form evidence",
          claims: [{ description: "Request form label", kind: mode === "visual-only" ? "visual-observation" : "ui-change", confidence: "medium", confidenceReason: "Supplied evidence",
            before: null, after: null, uncertainties: [], references: mode === "visual-only" ? [visual] : ["source-1", visual] }],
          contradictions: mode === "contradiction" ? [{ description: "Source and rendered text disagree", status: "unresolved", references: ["source-1", visual] }] : [], uncertainties: [] };
      } else {
        output = { decisions: [{ action: "revise", documentId: document.id, sectionId: document.sections[0].id,
          reason: "Update the changed request label", updateIntent: "Clarify the label", claimRefs: ["claim-1"] }], uncertainties: [] };
      }
    }
    return Response.json({ model: "fixture-vision", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] });
  });

  // Replace only database transport. Real documentation read validation and the
  // existing impact planner run against a canonical immutable saved fixture.
  const load = createRequire(join(process.cwd(), "package.json")), databasePath = load.resolve("./src/integrations/database/documentation-drafts.ts");
  const queries: typeof import("@/integrations/database/documentation-drafts") = load(databasePath), databaseModule = load.cache[databasePath]!, original = databaseModule.exports;
  databaseModule.exports = { ...queries, searchDocumentationSections: async () => [],
    selectDocumentationDrafts: async () => [{ id: document.id, document, savedAt: new Date() }],
    findDocumentationDraft: async () => ({ id: document.id, document, savedAt: new Date() }),
    insertDocumentationDraft: () => { throw new Error("Planning cannot write"); },
  };
  const reload = ["./src/features/documentation/operations.ts", "./src/features/documentation/documentation-impact-input.ts", "./src/features/documentation/select-documentation-candidates.ts", "./src/features/documentation/plan-documentation-impact.ts"].map(path => load.resolve(path));
  const originals = reload.map(path => load.cache[path]); reload.forEach(path => { delete load.cache[path]; });
  t.after(() => { databaseModule.exports = original; reload.forEach((path, i) => { if (originals[i]) load.cache[path] = originals[i]; else delete load.cache[path]; }); });
  const { planDocumentationImpact }: typeof import("@/features/documentation/plan-documentation-impact") = load(reload[3]);

  const { trace } = await captureWorkflowWithRuntime({ runtime: { mode: "attach", options: { baseUrl } },
    workflow: { steps: [{ type: "fill", selector: "input", value: "private" }, { type: "click", selector: "#open" }, { type: "click", selector: "#close" }] } }, storage);
  completed = true;
  for (const current of ["supported", "visual-only", "contradiction"] as const) {
    mode = current;
    const visuals = await analyzeRuntimeVisuals({ source, trace, description: "Inspect request guidance" }, storage);
    assert.equal(visuals.status, "complete"); assert.equal(visuals.runtime.length, 1);
    const { impact } = await synthesizeProductImpact({ source, runtime: visuals.runtime });
    assert.equal(impact.provenance.captures[0].captureId, selectedCapture);
    if (current === "supported") {
      assert.equal((await planDocumentationImpact({ impact })).plan.decisions[0].action, "revise");
    } else {
      await assert.rejects(planDocumentationImpact({ impact }), current === "visual-only" ? /Uncertain ProductImpact|source-supported/ : /Uncertain ProductImpact/);
    }
  }
  assert.equal(textCalls, 9); assert.equal(visionCalls, 3);
});
