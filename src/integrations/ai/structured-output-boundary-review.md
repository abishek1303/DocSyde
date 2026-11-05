# Structured-output boundary: exact code review

Historical implementation review. These diffs preserve the boundary’s initial
implementation, not the complete current tree or current retry policy. For current
capabilities, limits and recovery, read [structured-output-boundary.md](structured-output-boundary.md).

Diffs compare the clean starting checkout with this implementation. Only boundary, policy, logging and UI code is included; canonical feature schemas and feature grounding validators have no changes. Stage flexibility is declared centrally in `boundaryPolicies`. Provider/model dispatch configuration and output ceilings have no changes.

## src/integrations/ai/model-boundary.ts

New module: conservative byte-preserving extraction and a separate permissive model schema/projector; strict domain schemas are never modified.

```diff
diff --git a/src/integrations/ai/model-boundary.ts b/src/integrations/ai/model-boundary.ts
new file mode 100644
index 0000000..c42a451
--- /dev/null
+++ b/src/integrations/ai/model-boundary.ts
@@ -0,0 +1,104 @@
+import { createHash } from "node:crypto";
+import { z } from "zod";
+import { diagnosticShapeKey, type BoundaryTrace } from "./model-diagnostic";
+
+export class BoundaryError extends Error {
+  constructor(public readonly code: "invalid-json" | "boundary-shape", public readonly trace: BoundaryTrace) { super(code); }
+}
+export function newBoundaryTrace(text: string, attempt: number): BoundaryTrace {
+  return { attempt, strictParse: false, extraction: "none", boundary: "pending", normalization: "pending", canonical: "pending", ignoredKeys: [], ignoredCount: 0,
+    outputSha256: createHash("sha256").update(text).digest("hex"), outputBytes: Buffer.byteLength(text) };
+}
+/** No repair: slices preserve every byte inside the selected JSON payload. */
+export function parseOrExtractSingleJson(text: string, trace: BoundaryTrace): unknown {
+  try { const value: unknown = JSON.parse(text); trace.strictParse = true; return value; } catch { /* extraction only */ }
+  const trimmed = text.replace(/^\uFEFF/, "").trim();
+  try { const value: unknown = JSON.parse(trimmed); trace.extraction = "bom"; return value; } catch { /* scan */ }
+  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
+  if (fence) {
+    try { const value: unknown = JSON.parse(fence[1]); trace.extraction = "fence"; return value; }
+    catch { trace.extraction = "failed"; throw new BoundaryError("invalid-json", trace); }
+  }
+  // Balanced outer containers only. Broken outer containers cannot yield a nested recovery.
+  const candidates: { start: number; end: number }[] = [];
+  let start = -1, quoted = false, escaped = false;
+  const stack: string[] = [];
+  for (let i = 0; i < text.length; i++) {
+    const c = text[i];
+    if (start < 0) { if (c === "}" || c === "]") { trace.extraction = "failed"; throw new BoundaryError("invalid-json", trace); } if (c !== "{" && c !== "[") continue; start = i; stack.push(c); continue; }
+    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
+    if (c === '"') quoted = true;
+    else if (c === "{" || c === "[") stack.push(c);
+    else if (c === "}" || c === "]") {
+      if (stack.pop() !== (c === "}" ? "{" : "[")) { trace.extraction = "failed"; throw new BoundaryError("invalid-json", trace); }
+      if (!stack.length) { candidates.push({ start, end: i + 1 }); start = -1; }
+    }
+  }
+  trace.extraction = candidates.length > 1 ? "ambiguous" : "failed";
+  if (start >= 0 || candidates.length !== 1) throw new BoundaryError("invalid-json", trace);
+  const candidate = candidates[0];
+  const surrounding = [text.slice(0, candidate.start).trim(), text.slice(candidate.end).trim()];
+  if (surrounding.some(part => part.length > 0 && /^[,:"\\]+$/.test(part))) throw new BoundaryError("invalid-json", trace);
+  if (candidate.start + text.length - candidate.end > 1024) throw new BoundaryError("invalid-json", trace);
+  try { const value: unknown = JSON.parse(text.slice(candidate.start, candidate.end)); trace.extraction = "surrounded"; return value; }
+  catch { throw new BoundaryError("invalid-json", trace); }
+}
+
+const wrappers = ["result", "analysis", "impact"] as const;
+/** Boundary projection removes unknown keys only at explicitly declared object nodes.
+ * Unknown/opaque schemas (notably transformation entries) remain untouched. */
+function project(value: unknown, schema: z.ZodType, trace: BoundaryTrace): unknown {
+  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) return project(value, schema.unwrap() as z.ZodType, trace);
+  if (schema instanceof z.ZodArray && Array.isArray(value)) return value.map(v => project(v, schema.element as z.ZodType, trace));
+  if (!(schema instanceof z.ZodObject) || !value || typeof value !== "object" || Array.isArray(value)) return value;
+  const out: Record<string, unknown> = {};
+  for (const [key, child] of Object.entries(value)) {
+    const field = Object.hasOwn(schema.shape, key) ? schema.shape[key] as z.ZodType : undefined;
+    if (field) out[key] = project(child, field, trace);
+    else {
+      trace.ignoredCount++;
+      const safe = diagnosticShapeKey.safeParse(key);
+      if (safe.success && trace.ignoredKeys.length < 8 && !trace.ignoredKeys.includes(safe.data)) trace.ignoredKeys.push(safe.data);
+    }
+  }
+  return out;
+}
+export function modelFacingSchema(schema: z.ZodType): z.ZodType {
+  if (schema instanceof z.ZodObject) return z.object(Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [key, modelFacingSchema(field as z.ZodType)]))).passthrough();
+  if (schema instanceof z.ZodArray) return z.array(modelFacingSchema(schema.element as z.ZodType));
+  if (schema instanceof z.ZodOptional) return modelFacingSchema(schema.unwrap() as z.ZodType).optional();
+  if (schema instanceof z.ZodNullable) return modelFacingSchema(schema.unwrap() as z.ZodType).nullable();
+  // Opaque entries, defaults and unions keep their declared semantics.
+  return schema;
+}
+export function normalizeModelBoundary(value: unknown, schema: z.ZodType, trace: BoundaryTrace, supportedWrappers: readonly string[] = wrappers): unknown {
+  if (schema instanceof z.ZodObject && value && typeof value === "object" && !Array.isArray(value)) {
+    const root = value as Record<string, unknown>;
+    const present = wrappers.filter(k => Object.hasOwn(root, k) && !Object.hasOwn(schema.shape, k));
+    if (present.some(key => supportedWrappers.includes(key))) {
+      if (present.length !== 1 || Object.keys(schema.shape).some(k => Object.hasOwn(root, k))) {
+        trace.boundary = trace.normalization = "rejected"; throw new BoundaryError("boundary-shape", trace);
+      }
+      const inner = root[present[0]];
+      // Required semantic validation remains downstream; only structurally recognizable wrappers unwrap.
+      if (!inner || typeof inner !== "object" || Array.isArray(inner) || !Object.keys(schema.shape).some(k => Object.hasOwn(inner, k))) {
+        trace.boundary = trace.normalization = "rejected"; throw new BoundaryError("boundary-shape", trace);
+      }
+      trace.wrapper = present[0];
+      for (const key of Object.keys(root)) if (key !== trace.wrapper) {
+        trace.ignoredCount++;
+        const safe = diagnosticShapeKey.safeParse(key); if (safe.success && trace.ignoredKeys.length < 8) trace.ignoredKeys.push(safe.data);
+      }
+      value = inner;
+    }
+  }
+  trace.boundary = modelFacingSchema(schema).safeParse(value).success ? "accepted" : "rejected";
+  const result = project(value, schema, trace);
+  trace.normalization = "accepted";
+  return result;
+}
+export const boundaryPolicies: Readonly<Record<string, readonly string[]>> = {
+  "source-analysis": ["result", "analysis"], "runtime-decision": ["result"],
+  "visual-selection": ["result"], "product-impact": ["result", "impact"],
+  "documentation-planning": ["result"], "documentation-transformation": ["result"],
+};
```

## src/integrations/ai/generate-structured.ts

The strict parser now receives a normalized payload; only JSON/wrapper formatting failures can enter the bounded same-input retry loop, outside all feature validators.

```diff
diff --git a/src/integrations/ai/generate-structured.ts b/src/integrations/ai/generate-structured.ts
index 7a89565..5a445b3 100644
--- a/src/integrations/ai/generate-structured.ts
+++ b/src/integrations/ai/generate-structured.ts
@@ -1,4 +1,6 @@
 import "server-only";
+import { BoundaryError, boundaryPolicies, newBoundaryTrace, normalizeModelBoundary, parseOrExtractSingleJson } from "./model-boundary";
+import { formatRetryAllowed } from "./inference-budget";
 import { receiptResponse } from "./invocation-payload";
 import { resolveInference, type InferenceOptions } from "./operation-policy";
 import { logStructuredInvocation } from "./invocation-log";
@@ -19,20 +21,40 @@ export async function generateStructured<S extends z.ZodType>(options: {
   if (!instructions.trim() || !input.trim() || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) throw new ModelError("invalid-input");
   let format: string;
   try { format = JSON.stringify(z.toJSONSchema(schema)); } catch { throw new ModelError("unsupported-schema"); }
-  return logStructuredInvocation({ invocation: options.invocation, postValidation: options.postValidation, provider: "baseten", input, settings, instructions: `${instructions}\nReturn only JSON matching this schema: ${format}`, schema: format,
-    validatedOutput: result => result.data,
-    acceptedResponse: result => operation === "receipt-verification" ? receiptResponse(result.data) : undefined,
-  }, async () => {
-    const started = Date.now();
-    const result = await invokeBaseten({ instructions: `${instructions}\nReturn only JSON matching this schema: ${format}`, input, maxOutputTokens, signal, settings }).catch((error: unknown) => {
-      throw error instanceof BasetenError ? new ModelError(error.code, error.retryAfterSeconds, error.diagnostic) : new ModelError("upstream");
-    });
+  const wrappers = boundaryPolicies[operation];
+  for (let attempt = 1; attempt <= 2; attempt++) {
+    const corrective = attempt === 2 ? "\nReturn only one valid JSON object matching the requested structure. No prose or wrapper." : "";
     try {
-      return { data: parseStructuredOutput(result.text, schema, operation === "product-impact"), model: result.model, elapsedMs: Date.now() - started, metadata: result.metadata };
+      return await logStructuredInvocation({ invocation: options.invocation, postValidation: options.postValidation, attempt, provider: "baseten", input, settings, instructions: `${instructions}\nReturn only JSON matching this schema: ${format}${corrective}`, schema: format,
+        validatedOutput: result => result.data,
+        acceptedResponse: result => operation === "receipt-verification" ? receiptResponse(result.data) : undefined,
+      }, async () => {
+        const started = Date.now();
+        const result = await invokeBaseten({ instructions: `${instructions}\nReturn only JSON matching this schema: ${format}${corrective}`, input, maxOutputTokens, signal, settings }).catch((error: unknown) => {
+          throw error instanceof BasetenError ? new ModelError(error.code, error.retryAfterSeconds, { ...error.diagnostic, kind: error.diagnostic?.kind ?? "provider-failure", attempt }) : new ModelError("upstream");
+        });
+        const trace = newBoundaryTrace(result.text, attempt);
+        try {
+          const payload = parseOrExtractSingleJson(result.text, trace);
+          const normalized = wrappers ? normalizeModelBoundary(payload, schema, trace, wrappers) : payload;
+          const data = parseStructuredOutput(JSON.stringify(normalized), schema, operation === "product-impact");
+          trace.canonical = "accepted";
+          return { data, model: result.model, elapsedMs: Date.now() - started, metadata: { ...result.metadata, boundary: trace } };
+        } catch (error) {
+          if (error instanceof BoundaryError) {
+            if (attempt === 1 && formatRetryAllowed()) trace.retryReason = error.code;
+            const code = error.code === "boundary-shape" ? "schema-mismatch" : "invalid-json";
+            throw new ModelError(code, undefined, { ...result.metadata, kind: code, boundary: trace });
+          }
+          trace.canonical = "rejected";
+          if (error instanceof ModelError) throw new ModelError(error.code, undefined, { ...result.metadata,
+            boundary: trace, kind: error.code === "invalid-json" ? "invalid-json" : "schema-mismatch", ...error.diagnostic });
+          throw error;
+        }
+      });
     } catch (error) {
-      if (error instanceof ModelError) throw new ModelError(error.code, undefined, { ...result.metadata,
-        kind: error.code === "invalid-json" ? "invalid-json" : "schema-mismatch", ...error.diagnostic });
-      throw error;
+      if (!(error instanceof ModelError) || !error.diagnostic?.boundary?.retryReason || attempt === 2) throw error;
     }
-  });
+  }
+  throw new ModelError("invalid-json");
 }
```

## src/integrations/ai/inference-budget.ts

Existing explicit single-attempt budgets take precedence, so this change cannot expand a frozen experiment budget.

```diff
diff --git a/src/integrations/ai/inference-budget.ts b/src/integrations/ai/inference-budget.ts
index 5d9b4fa..59d2d9e 100644
--- a/src/integrations/ai/inference-budget.ts
+++ b/src/integrations/ai/inference-budget.ts
@@ -24,6 +24,8 @@ export class InferenceBudgetError extends Error {
 export function withInferenceBudget<T>(runId: string, expected: Record<string, FrozenInference>, action: () => Promise<T>, beforeCall?: () => Promise<void>) {
   return scope.run({ runId, expected, calls: 0, operations: new Set(), stopped: false, beforeCall }, action);
 }
+// Explicit single-attempt experiment budgets take precedence over format retry.
+export function formatRetryAllowed() { return !scope.getStore(); }
 export function stopInferenceBudget() { const budget = scope.getStore(); if (budget) budget.stopped = true; }
 export function assertInferenceTransport() {
   if (reliabilityContext()?.mode === "scenario") {
```

## src/integrations/ai/model-diagnostic.ts

Only bounded structural metadata and allowlisted key names can be persisted; values and malformed text remain excluded.

```diff
diff --git a/src/integrations/ai/model-diagnostic.ts b/src/integrations/ai/model-diagnostic.ts
index 52da614..da50b31 100644
--- a/src/integrations/ai/model-diagnostic.ts
+++ b/src/integrations/ai/model-diagnostic.ts
@@ -2,8 +2,21 @@ import { z } from "zod";
 
 // Fixed public structural vocabulary only; never arbitrary provider-authored key names.
 export const diagnosticShapeKey = z.enum(["impact", "result", "analysis", "summary", "title", "metadata", "rationale", "provenance", "source", "runtime", "captures", "sourceReferences", "visualReferences", "repository", "claims", "assessment", "contradictions", "uncertainties", "$schema", "type", "properties"]);
+export const boundaryTraceSchema = z.object({
+  attempt: z.number().int().min(1).max(2), strictParse: z.boolean(),
+  extraction: z.enum(["none", "bom", "fence", "surrounded", "failed", "ambiguous"]),
+  boundary: z.enum(["pending", "accepted", "rejected"]), normalization: z.enum(["pending", "accepted", "rejected"]),
+  canonical: z.enum(["pending", "accepted", "rejected"]),
+  ignoredKeys: z.array(diagnosticShapeKey).max(8), ignoredCount: z.number().int().nonnegative(),
+  wrapper: z.enum(["result", "analysis", "impact"]).optional(),
+  retryReason: z.enum(["invalid-json", "boundary-shape"]).optional(),
+  outputSha256: z.string().regex(/^[a-f0-9]{64}$/), outputBytes: z.number().int().nonnegative(),
+}).strict();
+export type BoundaryTrace = z.infer<typeof boundaryTraceSchema>;
 export const modelDiagnosticSchema = z.object({
-  kind: z.enum(["invalid-json", "schema-mismatch", "incomplete-output", "invalid-response", "refused", "grounding-rejection", "timeout", "cancelled", "provider-failure"]),
+  kind: z.enum(["invalid-json", "schema-mismatch", "incomplete-output", "invalid-response", "refused", "grounding-rejection", "timeout", "cancelled", "provider-failure", "structured-output"]),
+  attempt: z.number().int().min(1).max(2).optional(),
+  boundary: boundaryTraceSchema.optional(),
   model: z.string().max(300).optional(), elapsedMs: z.number().nonnegative().optional(),
   completionReason: z.enum(["stop", "length", "content_filter", "tool_calls", "other"]).optional(),
   usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional(), total_tokens: z.number().int().nonnegative().optional() }).strict().optional(),
```

## src/integrations/ai/invocation-log.ts

Each transport has its own existing invocation row; retry requires successful failure logging and attempt 2 logging before dispatch.

```diff
diff --git a/src/integrations/ai/invocation-log.ts b/src/integrations/ai/invocation-log.ts
index 790e28b..87ad29b 100644
--- a/src/integrations/ai/invocation-log.ts
+++ b/src/integrations/ai/invocation-log.ts
@@ -22,7 +22,7 @@ function metadata(value?: ModelInvocationMetadata) {
 
 /** Retain only operation-approved snapshots; never transport bodies or raw responses. */
 export async function logStructuredInvocation<T extends { model: string; metadata?: ModelInvocationMetadata }>(
-  options: { invocation?: InvocationContext; provider: "baseten" | "meta"; postValidation?: boolean; input?: string; instructions?: string; schema?: string; validatedOutput?: (result: T) => unknown; settings?: ResolvedInference; acceptedResponse?: (result: T) => ApprovedInvocationResponse | undefined },
+  options: { invocation?: InvocationContext; provider: "baseten" | "meta"; postValidation?: boolean; attempt?: number; input?: string; instructions?: string; schema?: string; validatedOutput?: (result: T) => unknown; settings?: ResolvedInference; acceptedResponse?: (result: T) => ApprovedInvocationResponse | undefined },
   invoke: () => Promise<T>,
 ): Promise<T & { invocationId?: string }> {
   const id = randomUUID(), context = options.invocation ?? { stage: "standalone", operation: options.provider === "meta" ? "runtime-vision" : "structured-generation" };
@@ -42,6 +42,7 @@ export async function logStructuredInvocation<T extends { model: string; metadat
     inserted = true;
   } catch (error) { if (error instanceof ReliabilityIsolationError) throw error; warn(id); }
   requireInferenceLog(inserted);
+  if (options.attempt === 2 && !inserted) throw new ModelError("invocation-log-unavailable");
   const started = Date.now();
   try {
     const result = await invoke();
@@ -57,13 +58,15 @@ export async function logStructuredInvocation<T extends { model: string; metadat
         const debug = debugPolicy(context.operation).output && options.validatedOutput ? debugOutput(context.operation, options.validatedOutput(result)) : undefined;
         if (debug) response = { payload: debug, reason: null };
         await updateAiModelInvocation(id, { ...metadata(result.metadata), model: result.model.slice(0, 300), elapsedMs,
-          status: options.postValidation ? "structured-success" : "succeeded", responsePayload: response.payload, responseOmissionReason: response.reason });
+          status: options.postValidation ? "structured-success" : "succeeded",
+          ...(result.metadata?.boundary ? { diagnostic: { kind: "structured-output", attempt: options.attempt ?? 1, boundary: result.metadata.boundary } } : {}), responsePayload: response.payload, responseOmissionReason: response.reason });
       } catch (error) { if (error instanceof ReliabilityIsolationError) throw error; warn(id); stopInferenceBudget(); }
     }
     return { ...result, invocationId: inserted ? id : undefined };
   } catch (error) {
-    stopInferenceBudget();
+    if (!(error instanceof ModelError && error.diagnostic?.boundary?.retryReason)) stopInferenceBudget();
     const elapsedMs = Date.now() - started;
+    let failureLogged = false;
     if (inserted) {
       const diagnostic = error instanceof ModelError ? modelDiagnosticSchema.safeParse(error.diagnostic) : undefined;
       const safe = diagnostic?.success ? diagnostic.data : undefined;
@@ -71,7 +74,13 @@ export async function logStructuredInvocation<T extends { model: string; metadat
       const knownCodes = new Set(["invalid-json", "schema-mismatch", "incomplete-output", "refused", "invalid-response", "timeout", "cancelled", "missing-credentials", "invalid-request", "unauthorized", "forbidden", "billing", "model-unavailable", "rate-limited", "upstream"]);
       const code = error instanceof ModelError && knownCodes.has(error.code) ? error.code : "provider-failure";
       try { await updateAiModelInvocation(id, { ...metadata(safe), model: safe?.model ?? configured.slice(0, 300),
-        elapsedMs, status: "failed", failureKind: code, diagnostic: safe ?? null, responsePayload: null, responseOmissionReason: "model-failure" }); } catch (error) { if (error instanceof ReliabilityIsolationError) throw error; warn(id); }
+        elapsedMs, status: "failed", failureKind: code, diagnostic: safe ?? null, responsePayload: null, responseOmissionReason: "model-failure" }); failureLogged = true; } catch (error) { if (error instanceof ReliabilityIsolationError) throw error; warn(id); }
+    }
+    // Never issue a paid format retry if its predecessor could not be retained.
+    if (!failureLogged && error instanceof ModelError && error.diagnostic?.boundary?.retryReason) {
+      const boundary = { ...error.diagnostic.boundary };
+      delete boundary.retryReason;
+      throw new ModelError(error.code, error.retryAfterSeconds, { ...error.diagnostic, boundary });
     }
     throw error;
   }
```

## src/integrations/ai/invocation-debug.ts

Semantic diagnostics can include the safe boundary trace without changing their validator codes or acceptance policy.

```diff
diff --git a/src/integrations/ai/invocation-debug.ts b/src/integrations/ai/invocation-debug.ts
index 998d650..3a3fd08 100644
--- a/src/integrations/ai/invocation-debug.ts
+++ b/src/integrations/ai/invocation-debug.ts
@@ -1,6 +1,7 @@
 import "server-only";
 import { createHash } from "node:crypto";
 import { z } from "zod";
+import { boundaryTraceSchema } from "./model-diagnostic";
 import { ModelError } from "./structured-output";
 
 // Per-section UTF-8 budgets leave room for JSON escaping under the 128 KiB column budget.
@@ -65,7 +66,7 @@ export function debugOutput(operation: string, data: unknown) {
   }
 }
 const codes = ["unknown-checkpoint", "duplicate-checkpoint", "excessive-selection-count", "unknown-source-reference", "duplicate-source-reference", "limited-evidence-not-needed", "unsupported-capability", "unsupported-route", "unknown-evidence", "unavailable-evidence", "invalid-line-range", "citation-range-mismatch", "citation-excerpt-size", "validator-rejected", "unknown-claim-reference", "mismatched-document-target", "missing-document-target", "illegal-add-target", "uncertain-impact-requires-unresolved", "missing-source-support", "missing-update-intent", "duplicate-reference", "unknown-reference", "invalid-visual-claim", "unsupported-temporal-values", "invalid-contradiction", "unresolved-contradiction-assessment", "product-change-without-change-claim", "unsupported-internal-only", "invalid-reference-graph", "unknown-generation-entry", "missing-or-duplicate-generation-entry", "invalid-generation-entry", "unsupported-change-claim", "unauthorized-decision-target", "unauthorized-transformation-shape", "unauthorized-reference", "fact-claim-mismatch", "unsupported-markup", "unauthorized-generated-route", "unaddressed-claims", "invalid-section-placement", "incomplete-section-accounting"] as const;
-export const validationDiagnosticSchema = z.object({ kind: z.enum(["correspondence-rejection", "grounding-rejection"]),
+export const validationDiagnosticSchema = z.object({ boundary: boundaryTraceSchema.optional(), kind: z.enum(["correspondence-rejection", "grounding-rejection"]),
   validator: z.enum(["visual-selection", "runtime-decision", "source-analysis", "post-validation", "documentation-planning", "product-impact", "documentation-transformation"]), code: z.enum(codes),
   path: z.string().regex(/^(?:findings\[\d{1,2}\]\.citations\[\d{1,2}\]|selected(?:\[\d{1,2}\]\.(?:checkpointId|sourceRefs\[\d{1,2}\]))?|targets\[\d{1,2}\](?:\.citations\[\d{1,2}\])?(?:\.(?:capabilityId|pathname|findingRef|targetRef))?|status|claims\.\d{1,2}\.references|decisions\[\d{1,2}\]\.(?:claimRefs|documentId|sectionId|action|updateIntent))$/).optional(),
   citation: debugSectionSchema.optional(),
```

## src/integrations/database/ai-model-invocations.ts

Post-validation preserves boundary metadata while adding a semantic rejection; canonical document persistence is untouched.

```diff
diff --git a/src/integrations/database/ai-model-invocations.ts b/src/integrations/database/ai-model-invocations.ts
index d891f9d..e410c5f 100644
--- a/src/integrations/database/ai-model-invocations.ts
+++ b/src/integrations/database/ai-model-invocations.ts
@@ -13,7 +13,11 @@ export async function insertAiModelInvocation(row: Row) {
 export async function updateAiModelInvocation(id: string, values: Partial<Omit<Row, "id" | "createdAt" | "runId" | "stage" | "operation" | "provider">>, validationOnly = false, operation?: string) {
   await getDatabase().transaction(async tx => {
     await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
-    await tx.update(aiModelInvocations).set(values).where(and(eq(aiModelInvocations.id, id),
+    // Preserve safe boundary metadata when feature validation adds a rejection.
+    const updates = validationOnly && values.diagnostic ? { ...values,
+      diagnostic: sql`(coalesce(${aiModelInvocations.diagnostic}, '{}'::jsonb) - 'kind' - 'attempt') || ${JSON.stringify(values.diagnostic)}::jsonb`,
+    } : values;
+    await tx.update(aiModelInvocations).set(updates).where(and(eq(aiModelInvocations.id, id),
       validationOnly ? eq(aiModelInvocations.status, "structured-success") : undefined,
       operation ? eq(aiModelInvocations.operation, operation) : undefined));
   });
```

## src/features/documentation/runs/invocation-debug-view.ts

The view distinguishes extraction/normalization/retry from semantic rejection using validated metadata, never raw provider text.

```diff
diff --git a/src/features/documentation/runs/invocation-debug-view.ts b/src/features/documentation/runs/invocation-debug-view.ts
index 720ce3f..0204817 100644
--- a/src/features/documentation/runs/invocation-debug-view.ts
+++ b/src/features/documentation/runs/invocation-debug-view.ts
@@ -1,3 +1,4 @@
+import { modelDiagnosticSchema } from "@/integrations/ai/model-diagnostic";
 import { storedRequestInput, storedResponsePayload } from "@/integrations/ai/invocation-payload";
 import { debugSection, validationMessage, debugPolicy, debugRequestSchema, debugOutputSchema, validationDiagnosticSchema, DEBUG_LIMITS } from "@/integrations/ai/invocation-debug";
 import { z } from "zod";
@@ -7,7 +8,7 @@ function boundedParse<S extends z.ZodType>(schema: S, value: unknown): z.output<
   try { const json = JSON.stringify(value); if (!json || Buffer.byteLength(json) > DEBUG_LIMITS.column) return null;
     const result = schema.safeParse(value); return result.success ? result.data : null; } catch { return null; }
 }
-export function invocationDebugView(row: { operation: string; failureKind: string | null; requestPayload?: unknown; responsePayload?: unknown;
+export function invocationDebugView(row: { status?: string; operation: string; failureKind: string | null; requestPayload?: unknown; responsePayload?: unknown;
   diagnostic?: unknown; inferenceConfig?: unknown; requestOmissionReason?: string | null; responseOmissionReason?: string | null }) {
   const policy = debugPolicy(row.operation);
   const semantic = row.failureKind === "correspondence-rejection" || row.failureKind === "grounding-rejection";
@@ -16,11 +17,13 @@ export function invocationDebugView(row: { operation: string; failureKind: strin
   const projection = storedResponsePayload(row.operation, row.responsePayload);
   const legacyInput = storedRequestInput(row.operation, row.requestPayload);
   const diagnostic = boundedParse(validationDiagnosticSchema, row.diagnostic);
-  return { request, input: request?.input ?? (legacyInput === undefined ? undefined : debugSection(legacyInput, DEBUG_LIMITS.input)),
+  const boundary = boundedParse(modelDiagnosticSchema, row.diagnostic)?.boundary ?? diagnostic?.boundary;
+  const boundaryMessage = boundary ? `Attempt ${boundary.attempt}: ${boundary.attempt === 2 ? "format retry; " : ""}${boundary.retryReason ? "format retry requested" : boundary.canonical === "rejected" ? "strict schema rejected" : boundary.canonical !== "accepted" ? "format rejected" : boundary.wrapper || boundary.ignoredCount ? "normalized provider fields" : boundary.extraction !== "none" ? "recovered JSON" : "accepted directly"}; extraction: ${boundary.extraction}; ignored keys: ${boundary.ignoredCount}${boundary.wrapper ? `; wrapper: ${boundary.wrapper}` : ""}.` : null;
+  return { boundaryMessage, request, input: request?.input ?? (legacyInput === undefined ? undefined : debugSection(legacyInput, DEBUG_LIMITS.input)),
     response: response ?? (projection === undefined ? null : { version: 1, validation: "schema-valid", output: debugSection(JSON.stringify(projection), DEBUG_LIMITS.output) }), diagnostic, diagnosticMessage: diagnostic ? validationMessage(diagnostic.code) : null, config: boundedParse(configSchema, row.inferenceConfig),
     requestAvailability: request ? "Retained sanitized snapshot" : "Unavailable — no approved snapshot retained",
     responseAvailability: response ? (row.operation === "source-analysis" && configSchema.safeParse(row.inferenceConfig).data?.contractVersion === "source-analysis-v3" ? "Retained model-returned citation references; evidence excerpts are reconstructed separately in the canonical run analysis" : row.operation === "runtime-decision" && configSchema.safeParse(row.inferenceConfig).data?.contractVersion === "runtime-decision-v3" ? "Retained compact routing references; canonical targets and citations are resolved separately in the run decision" : "Retained schema-valid output") : projection !== undefined ? "Retained validated projection; full response unavailable" : "Unavailable — no approved schema-valid output retained",
     validation: semantic ? "Semantic / post-validation rejection after schema-valid generation"
       : row.failureKind === "schema-mismatch" || row.failureKind === "invalid-json" ? "Generation / schema-validation failure"
-      : row.failureKind ? "Generation / provider failure" : "No rejection recorded" };
+      : row.failureKind ? "Generation / provider failure" : row.status === "structured-success" ? "Schema accepted; grounding/correspondence pending" : row.status === "succeeded" && boundary ? "Schema accepted; operation validation completed" : "No rejection recorded" };
 }
```

## src/app/ai-model-usage/[id]/page.tsx

The usage detail renders the safe boundary summary next to the existing diagnostic and validation state.

```diff
diff --git a/src/app/ai-model-usage/[id]/page.tsx b/src/app/ai-model-usage/[id]/page.tsx
index ebd9097..4b94b84 100644
--- a/src/app/ai-model-usage/[id]/page.tsx
+++ b/src/app/ai-model-usage/[id]/page.tsx
@@ -29,7 +29,7 @@ async function DetailContent({ params }: { params: Promise<{ id: string }> }) {
   return <AppShell repository={invocation.repository} active="Logs" showBranch={false}>
     <header className="space-y-3"><Link href={`/ai-model-usage?${query}`} className="text-sm text-primary underline underline-offset-4">AI model usage log</Link><h1 className="text-3xl font-semibold tracking-tight">Model invocation details</h1></header>
     <dl className="grid gap-x-8 gap-y-5 rounded-xl border bg-card p-6 sm:grid-cols-2 lg:grid-cols-3">{values.map(([label, value]) => <div key={String(label)} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value ?? "Unavailable"}</dd></div>)}</dl>
-    <section className="space-y-4 rounded-xl border bg-card p-6"><h2 className="font-semibold">Validation / rejection diagnostic</h2><p className="text-sm">{invocation.debug.validation}</p>{invocation.debug.diagnosticMessage && <p className="text-sm">{invocation.debug.diagnosticMessage}</p>}{invocation.debug.diagnostic || invocation.diagnostic ? <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">{JSON.stringify(invocation.debug.diagnostic ?? invocation.diagnostic, null, 2)}</pre> : <p className="text-sm text-muted-foreground">Unavailable — no diagnostic retained. Historical rejection rules cannot be recovered from the failure category.</p>}</section>
+    <section className="space-y-4 rounded-xl border bg-card p-6"><h2 className="font-semibold">Validation / rejection diagnostic</h2><p className="text-sm">{invocation.debug.validation}</p>{invocation.debug.boundaryMessage && <p className="text-sm">{invocation.debug.boundaryMessage}</p>}{invocation.debug.diagnosticMessage && <p className="text-sm">{invocation.debug.diagnosticMessage}</p>}{invocation.debug.diagnostic || invocation.diagnostic ? <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">{JSON.stringify(invocation.debug.diagnostic ?? invocation.diagnostic, null, 2)}</pre> : <p className="text-sm text-muted-foreground">Unavailable — no diagnostic retained. Historical rejection rules cannot be recovered from the failure category.</p>}</section>
     <section className="space-y-4 rounded-xl border bg-card p-6"><h2 className="font-semibold">Model instructions</h2><Snapshot section={invocation.debug.request?.instructions} /></section>
     <section className="space-y-4 rounded-xl border bg-card p-6"><h2 className="font-semibold">Model input</h2><Snapshot section={invocation.debug.input} /></section>
     <section className="space-y-4 rounded-xl border bg-card p-6"><h2 className="font-semibold">Validated model output</h2><p className="text-sm text-muted-foreground">{invocation.debug.responseAvailability}. Schema validation does not establish correspondence or grounding.</p><Snapshot section={invocation.debug.response?.output} /></section>
```
