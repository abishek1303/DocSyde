import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationRuns, aiModelInvocations } from "@/integrations/database/schema";
import { insertDocumentationRun } from "@/integrations/database/documentation-runs";
import { insertAiModelInvocation, selectAiModelInvocations } from "@/integrations/database/ai-model-invocations";
import { logStructuredInvocation, finishInvocationValidation } from "@/integrations/ai/invocation-log";

async function main() {
  const runId = randomUUID(), standaloneId = randomUUID();
  try {
    await insertDocumentationRun(runId, "https://github.com/fixture/invocation-verification", {});
    const generated = await logStructuredInvocation({ provider: "baseten", postValidation: true,
      invocation: { runId, stage: "source-analysis", operation: "source-analysis" },
    }, async () => ({ model: "verification-fixture", metadata: { completionReason: "stop" as const, usage: { prompt_tokens: 12, completion_tokens: 8 } } }));
    assert.ok(generated.invocationId, "Initial log insert failed");
    const [pending] = await selectAiModelInvocations(runId);
    assert.equal(pending.status, "structured-success"); assert.equal(pending.inputTokens, 12);
    assert.equal(pending.outputTokens, 8);
    await finishInvocationValidation(generated.invocationId, "grounding-rejection");
    const [failed] = await selectAiModelInvocations(runId);
    assert.equal(failed.status, "failed"); assert.equal(failed.failureKind, "grounding-rejection");
    assert.equal(failed.completionReason, "stop");
    await insertAiModelInvocation({ id: standaloneId, stage: "standalone", operation: "verification", provider: "meta", status: "started", createdAt: new Date() });
    const [standalone] = await getDatabase().select().from(aiModelInvocations).where(eq(aiModelInvocations.id, standaloneId));
    assert.equal(standalone.runId, null); assert.equal(standalone.inputTokens, null);
    assert.equal(standalone.requestPayload, null); assert.equal(standalone.responsePayload, null); assert.equal(standalone.inferenceConfig, null);
    const input = ' {"workflow":"safe"} ';
    const selected = await logStructuredInvocation({ provider: "baseten", postValidation: true, input,
      invocation: { runId, stage: "runtime-inspection", operation: "visual-selection" },
    }, async () => ({ model: "verification-fixture" }));
    assert.ok(selected.invocationId);
    await finishInvocationValidation(selected.invocationId, undefined, () => ({ operation: "visual-selection", payload: { decision: "skip", selected: [] } }));
    const [retained] = await getDatabase().select().from(aiModelInvocations).where(eq(aiModelInvocations.id, selected.invocationId));
    assert.deepEqual(retained.requestPayload, { input }); assert.deepEqual(retained.responsePayload, { decision: "skip", selected: [] });
    assert.equal(retained.requestOmissionReason, null); assert.equal(retained.responseOmissionReason, null);
    assert.deepEqual(retained.inferenceConfig, { contractVersion: "visual-selection-v2", maxOutputTokens: 2048, reasoningEffort: null, temperature: null, topP: null });
    await assert.rejects(insertAiModelInvocation({ id: randomUUID(), runId: randomUUID(), stage: "fixture", operation: "fixture", provider: "meta", status: "started", createdAt: new Date() }));
    await assert.rejects(insertAiModelInvocation({ id: randomUUID(), stage: "fixture", operation: "fixture", provider: "meta", status: "started", inputTokens: -1, createdAt: new Date() }));
    // Delete only fixtures created by this verification; confirm the run FK cascades.
    await getDatabase().delete(documentationRuns).where(eq(documentationRuns.id, runId));
    assert.deepEqual(await selectAiModelInvocations(runId), []);
    console.log("PASS: invocation persistence, metadata, validation updates, nullable run, constraints and cascade. No model calls made.");
  } finally {
    await getDatabase().delete(aiModelInvocations).where(eq(aiModelInvocations.id, standaloneId));
    await getDatabase().delete(documentationRuns).where(eq(documentationRuns.id, runId));
  }
}
main().catch(() => { console.error("Invocation persistence verification failed. Check local PostgreSQL and migrations."); process.exitCode = 1; }).finally(closeDatabase);
