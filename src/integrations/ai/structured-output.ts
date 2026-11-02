import "server-only";
import { createHash } from "node:crypto";
import { diagnosticShapeKey } from "./model-diagnostic";
import { z } from "zod";

import type { ModelDiagnostic } from "./model-diagnostic";

export class ModelError extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds?: number, public readonly diagnostic?: ModelDiagnostic) { super(`Model invocation failed: ${code}`); }
}

export function parseStructuredOutput<S extends z.ZodType>(text: string, schema: S, retainShapeDiagnostics = false): z.output<S> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ModelError("invalid-json"); }
  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    const known = new Set<string>();
    function names(value: unknown) {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "properties" && child && typeof child === "object") Object.keys(child).forEach(name => known.add(name));
        names(child);
      }
    }
    const schemaJson = JSON.stringify(z.toJSONSchema(schema));
    names(JSON.parse(schemaJson));
    const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
    throw new ModelError("schema-mismatch", undefined, { kind: "schema-mismatch",
      ...(retainShapeDiagnostics ? { schemaFailure: { schemaSha256: hash(schemaJson), outputSha256: hash(text), outputBytes: Buffer.byteLength(text, "utf8") } } : {}),
      issues: validated.error.issues.slice(0, 8).map(issue => ({ code: issue.code,
      path: issue.path.map(part => typeof part === "number" ? "[]" : known.has(String(part)) ? String(part) : "[unknown]").join(".").slice(0, 300),
      ...(retainShapeDiagnostics && issue.code === "unrecognized_keys" ? (() => {
        const recognized = issue.keys.filter(key => diagnosticShapeKey.safeParse(key).success);
        const unexpectedKeys = recognized.slice(0, 8).map(key => diagnosticShapeKey.parse(key));
        return { unexpectedKeys, extraKeyCount: issue.keys.length, withheldKeyCount: issue.keys.length - unexpectedKeys.length };
      })() : {}),
    })) });
  }
  return validated.data;
}
