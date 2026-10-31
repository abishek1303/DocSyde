// Test-only evidence. Never used by product execution or the live verification CLI.
import { createHash, randomUUID } from "node:crypto";
import type { ProductResult } from "@/features/sources/product-change-analysis";
import type { RuntimeTrace } from "@/integrations/browser/runtime-trace";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";

export function visualSourceFixture(): ProductResult {
  return { status: "analyzed", bytes: 0, bundle: {
    repository: "https://github.com/example/project", base: "a".repeat(40), head: "b".repeat(40), limited: false, notice: "Selected source only",
    inventory: [{ path: "form.tsx", previousPath: null, kind: "modified" }],
    evidence: [{ id: "p1", path: "form.tsx", side: "patch", commitId: null, changed: true, status: "included", text: "+<button>Create request</button>" }],
  }, analysis: { assessment: "product-change", uncertainties: [], findings: [{ kind: "behavior-modified", description: "The form button label changed",
    before: "Submit", after: "Create request", support: "directly-supported", confidence: "high", confidenceReason: "Literal source",
    citations: [{ evidenceId: "p1", startLine: 1, endLine: 1, excerpt: "+<button>Create request</button>" }],
    reachabilityEvidenceIds: [], assumptions: [], uncertainties: [],
  }] } };
}

export function visualTraceFixture(count = 4) {
  const bytes = new Map<string, Uint8Array>();
  const trace: RuntimeTrace = {
    version: 1, traceId: randomUUID(), startedAt: "2026-10-30T00:00:00.000Z", finishedAt: "2026-10-30T00:01:00.000Z", status: "completed",
    requestedPathname: "/form", viewport: { width: 1440, height: 900 }, events: [], states: [], checkpoints: [],
    coverage: { stateBoundaries: count, omittedStates: 0, omittedCheckpoints: 0, truncatedSnapshots: 0, pageErrors: 0, dismissedDialogs: 0, navigationStatus: 200 },
  };
  for (let index = 0; index < count; index++) {
    const stateId = randomUUID(), artifactKey = randomUUID();
    const png = Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=", "base64"), Buffer.from([index])]);
    bytes.set(artifactKey, png);
    trace.states.push({ stateId, order: index, at: trace.startedAt, trigger: "click", actionIndex: index, occurrences: 1, effects: ["text changed"], fingerprint: "a".repeat(64),
      snapshot: { pathname: "/form", headings: ["Request"], text: `Visible state ${index}`, regions: [], controls: [], overlays: [], hostContext: null, truncated: false } });
    trace.checkpoints.push({ captureId: randomUUID(), stateId, capturedAt: trace.startedAt, crop: null, screenshot: {
      artifactKey, sha256: createHash("sha256").update(png).digest("hex"), mimeType: "image/png",
    }, eligible: true, limitation: null });
  }
  const storage: ArtifactStorage = {
    async store(value) { const key = randomUUID(); bytes.set(key, value); return { key }; },
    async read(key) { return bytes.get(key) ?? null; },
  };
  return { trace, storage, bytes };
}
