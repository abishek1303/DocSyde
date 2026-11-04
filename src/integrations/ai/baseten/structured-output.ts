import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { operationPolicy } from "../operation-policy";
import { ModelError } from "../structured-output";
import type { StructuredOutputMode } from "../structured-output-mode";
type JsonSchema = z.core.JSONSchema.BaseSchema;
export type BasetenResponseFormat = { type: "json_schema"; json_schema: { name: string; strict: true; schema: JsonSchema } };
/** Explicit model capability scope. No inference, fallback request or model substitution. */
export function basetenCapabilities(model: string) {
 // Baseten documents that Muse Spark Open accepts json_schema without enforcing
 // it. Request acceptance is not constrained decoding; use the prompt boundary.
 // No other model has been verified for native enforcement in this adapter.
 void model;
 return { nativeJsonSchema: false };
}
function closedSchema(value: unknown): boolean {
 if (!value || typeof value !== "object" || Array.isArray(value)) return false;
 const node = value as Record<string, unknown>;
 if (!node.type && !node.$ref && !node.anyOf && !node.oneOf && !node.allOf && !Object.hasOwn(node,"const") && !node.enum) return false;
 if (node.type === "object" && node.additionalProperties !== false) return false;
 for (const key of ["properties", "$defs"] as const) {
  const fields=node[key];
  if (fields && typeof fields === "object" && !Array.isArray(fields) && !Object.values(fields).every(closedSchema)) return false;
 }
 if (node.items && !closedSchema(node.items)) return false;
 for (const key of ["anyOf","oneOf","allOf"] as const) if (Array.isArray(node[key]) && !node[key].every(closedSchema)) return false;
 return true;
}
export function basetenStructuredOutput(model: string, operation: string, schema: JsonSchema): { metadata: StructuredOutputMode; responseFormat?: BasetenResponseFormat } {
 const configured=process.env.BASETEN_STRUCTURED_OUTPUT_MODE ?? "auto";
 if (configured !== "auto" && configured !== "prompt") throw new ModelError("invalid-input");
 const version=operationPolicy(operation)?.[1] ?? null;
 const name=(version ?? operation).replace(/[^A-Za-z0-9_-]/g,"_").slice(0,64) || "structured_output";
 const reason=configured === "prompt" ? "operator-disabled" : !basetenCapabilities(model).nativeJsonSchema ? "model-unsupported"
  : schema.type !== "object" || !closedSchema(schema) ? "schema-unsupported" : null;
 const metadata: StructuredOutputMode={mode:reason?"prompt":"native",schemaName:name,schemaVersion:version,
  schemaSha256:createHash("sha256").update(JSON.stringify(schema)).digest("hex"),fallbackReason:reason};
 return {metadata,...(!reason?{responseFormat:{type:"json_schema" as const,json_schema:{name,strict:true as const,schema}}}:{})};
}
