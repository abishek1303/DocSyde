import { createHash } from "node:crypto";
import { z } from "zod";
import { diagnosticShapeKey, type BoundaryTrace } from "./model-diagnostic";

export class BoundaryError extends Error {
  constructor(public readonly code: "invalid-json" | "boundary-shape", public readonly trace: BoundaryTrace) { super(code); }
}
export function newBoundaryTrace(text: string, attempt: number): BoundaryTrace {
  return { attempt, strictParse: false, extraction: "none", boundary: "pending", normalization: "pending", canonical: "pending", ignoredKeys: [], ignoredCount: 0,
    outputSha256: createHash("sha256").update(text).digest("hex"), outputBytes: Buffer.byteLength(text) };
}
/** No repair: slices preserve every byte inside the selected JSON payload. */
export function parseOrExtractSingleJson(text: string, trace: BoundaryTrace): unknown {
  try { const value: unknown = JSON.parse(text); trace.strictParse = true; return value; } catch { /* extraction only */ }
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  try { const value: unknown = JSON.parse(trimmed); trace.extraction = "bom"; return value; } catch { /* scan */ }
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  if (fence) {
    try { const value: unknown = JSON.parse(fence[1]); trace.extraction = "fence"; return value; }
    catch { trace.extraction = "failed"; throw new BoundaryError("invalid-json", trace); }
  }
  // Balanced outer containers only. Broken outer containers cannot yield a nested recovery.
  const candidates: { start: number; end: number }[] = [];
  let start = -1, quoted = false, escaped = false;
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) { if (c === "}" || c === "]") { trace.extraction = "failed"; throw new BoundaryError("invalid-json", trace); } if (c !== "{" && c !== "[") continue; start = i; stack.push(c); continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      if (stack.pop() !== (c === "}" ? "{" : "[")) { trace.extraction = "failed"; throw new BoundaryError("invalid-json", trace); }
      if (!stack.length) { candidates.push({ start, end: i + 1 }); start = -1; }
    }
  }
  trace.extraction = candidates.length > 1 ? "ambiguous" : "failed";
  if (start >= 0 || candidates.length !== 1) throw new BoundaryError("invalid-json", trace);
  const candidate = candidates[0];
  const surrounding = [text.slice(0, candidate.start).trim(), text.slice(candidate.end).trim()];
  if (surrounding.some(part => part.length > 0 && /^[,:"\\]+$/.test(part))) throw new BoundaryError("invalid-json", trace);
  if (candidate.start + text.length - candidate.end > 1024) throw new BoundaryError("invalid-json", trace);
  try { const value: unknown = JSON.parse(text.slice(candidate.start, candidate.end)); trace.extraction = "surrounded"; return value; }
  catch { throw new BoundaryError("invalid-json", trace); }
}

const wrappers = ["result", "analysis", "impact"] as const;
/** Boundary projection removes unknown keys only at explicitly declared object nodes.
 * Unknown/opaque schemas (notably transformation entries) remain untouched. */
function project(value: unknown, schema: z.ZodType, trace: BoundaryTrace): unknown {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) return project(value, schema.unwrap() as z.ZodType, trace);
  if (schema instanceof z.ZodArray && Array.isArray(value)) return value.map(v => project(v, schema.element as z.ZodType, trace));
  if (!(schema instanceof z.ZodObject) || !value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const field = Object.hasOwn(schema.shape, key) ? schema.shape[key] as z.ZodType : undefined;
    if (field) out[key] = project(child, field, trace);
    else {
      trace.ignoredCount++;
      const safe = diagnosticShapeKey.safeParse(key);
      if (safe.success && trace.ignoredKeys.length < 8 && !trace.ignoredKeys.includes(safe.data)) trace.ignoredKeys.push(safe.data);
    }
  }
  return out;
}
export function modelFacingSchema(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodObject) return z.object(Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [key, modelFacingSchema(field as z.ZodType)]))).passthrough();
  if (schema instanceof z.ZodArray) return z.array(modelFacingSchema(schema.element as z.ZodType));
  if (schema instanceof z.ZodOptional) return modelFacingSchema(schema.unwrap() as z.ZodType).optional();
  if (schema instanceof z.ZodNullable) return modelFacingSchema(schema.unwrap() as z.ZodType).nullable();
  // Opaque entries, defaults and unions keep their declared semantics.
  return schema;
}
export function normalizeModelBoundary(value: unknown, schema: z.ZodType, trace: BoundaryTrace, supportedWrappers: readonly string[] = wrappers, allowedExtraKeys?: readonly string[]): unknown {
  const captureShape = (candidate: unknown) => {
    if (!allowedExtraKeys || !(schema instanceof z.ZodObject)) return;
    const keys = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? Object.keys(candidate) : [];
    const safe = keys.filter(key => diagnosticShapeKey.safeParse(key).success).slice(0,16);
    trace.rootShape = { expectedKeys: Object.keys(schema.shape).filter(key => diagnosticShapeKey.safeParse(key).success).slice(0,16).map(key => diagnosticShapeKey.parse(key)), receivedKeys: safe.map(key => diagnosticShapeKey.parse(key)), withheldKeyCount: keys.length-safe.length, shape: Array.isArray(candidate) ? "array" : candidate && typeof candidate === "object" ? "object" : "scalar" };
  };
  const rejectUnknown = (candidate: Record<string, unknown>, permitted: readonly string[]) => {
    // A dialect marker is metadata, never a schema to execute or use for validation.
    if (allowedExtraKeys?.includes("$schema") && Object.hasOwn(candidate, "$schema") && !permitted.includes("$schema")
      && (typeof candidate.$schema !== "string" || !["https://json-schema.org/draft/2020-12/schema", "https://json-schema.org/draft/2019-09/schema", "http://json-schema.org/draft-07/schema#"].includes(candidate.$schema))) {
      trace.boundary = trace.normalization = "rejected"; throw new BoundaryError("boundary-shape", trace);
    }
    if (allowedExtraKeys && Object.keys(candidate).some(key => !permitted.includes(key) && !allowedExtraKeys.includes(key))) {
      trace.boundary = trace.normalization = "rejected"; throw new BoundaryError("boundary-shape", trace);
    }
  };
  captureShape(value);
  if (schema instanceof z.ZodObject && value && typeof value === "object" && !Array.isArray(value)) {
    const root = value as Record<string, unknown>;
    const present = wrappers.filter(k => Object.hasOwn(root, k) && !Object.hasOwn(schema.shape, k));
    if (present.some(key => supportedWrappers.includes(key))) {
      if (present.length !== 1 || Object.keys(schema.shape).some(k => Object.hasOwn(root, k))) {
        trace.boundary = trace.normalization = "rejected"; throw new BoundaryError("boundary-shape", trace);
      }
      const inner = root[present[0]];
      // Required semantic validation remains downstream; only structurally recognizable wrappers unwrap.
      if (!inner || typeof inner !== "object" || Array.isArray(inner) || !Object.keys(schema.shape).some(k => Object.hasOwn(inner, k))) {
        trace.boundary = trace.normalization = "rejected"; throw new BoundaryError("boundary-shape", trace);
      }
      trace.wrapper = present[0];
      rejectUnknown(root, [present[0]]);
      for (const key of Object.keys(root)) if (key !== trace.wrapper) {
        trace.ignoredCount++;
        const safe = diagnosticShapeKey.safeParse(key); if (safe.success && trace.ignoredKeys.length < 8) trace.ignoredKeys.push(safe.data);
      }
      value = inner;
      captureShape(value);
    }
  }
  if (schema instanceof z.ZodObject && value && typeof value === "object" && !Array.isArray(value)) rejectUnknown(value as Record<string, unknown>, Object.keys(schema.shape));
  trace.boundary = modelFacingSchema(schema).safeParse(value).success ? "accepted" : "rejected";
  const result = project(value, schema, trace);
  trace.normalization = "accepted";
  return result;
}
export const boundaryPolicies: Readonly<Record<string, readonly string[]>> = {
  "repository-understanding": ["result", "analysis"],
  "source-analysis": ["result", "analysis"], "runtime-decision": ["result"],
  "visual-selection": ["result"], "product-impact": ["result", "impact"],
  "documentation-planning": ["result"], "documentation-transformation": ["result"],
};

/** Only explicitly non-semantic envelope metadata may be dropped for onboarding. */
export const boundaryExtraKeyPolicies: Readonly<Record<string, readonly string[]>> = {
 "repository-understanding": ["metadata", "$schema"],
};
