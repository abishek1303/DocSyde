import "server-only";
import { debugSection } from "./invocation-debug";
import { compositionOutputSchema, type CompositionOutput } from "./composition-output";
import { z } from "zod";

export const INVOCATION_PAYLOAD_MAX_BYTES = 128 * 1024;
const sourceRef = z.string().regex(/^source-[1-4]$/);
const selection = z.object({ decision: z.enum(["analyze", "skip"]), selected: z.array(z.object({
  checkpointId: z.uuid(), sourceRefs: z.array(sourceRef).max(4),
}).strict()).max(3) }).strict();
const coordinate = z.number().finite().min(0).max(1);
const bounds = z.object({ xMin: coordinate, yMin: coordinate, xMax: coordinate, yMax: coordinate }).strict()
  .refine(box => box.xMin < box.xMax && box.yMin < box.yMax);
const vision = z.object({ elements: z.array(z.object({ index: z.number().int().min(0).max(19), bounds: bounds.nullable(),
  certainty: z.enum(["clear", "uncertain"]),
}).strict().refine(element => element.certainty !== "uncertain" || element.bounds === null)).max(20),
  observationCount: z.number().int().min(0).max(10), limitationCount: z.number().int().min(0).max(10),
}).strict();
const support = z.object({ verdicts: z.array(z.object({ category: z.enum(["none", "omission", "ambiguity", "terminology", "unsupported-feature", "incorrect-value", "incorrect-instruction", "critical-omission", "protocol"]).optional(), unitId: z.string().regex(/^decision-[1-8]-unit-[1-9][0-9]*$/).max(100),
  verdict: z.enum(["supported", "unsupported", "uncertain"]),
}).strict()).max(128) }).strict();
const discovery = z.object({ fieldCount: z.literal(4) }).strict();
const understanding = z.object({ fieldCount: z.literal(6) }).strict();
const receipt = z.object({ receiptId: z.literal("proof-123") }).strict();
export type ApprovedInvocationResponse =
  | { operation: "documentation-composition"; payload: CompositionOutput }
  | { operation: "visual-selection"; payload: z.infer<typeof selection> }
  | { operation: "runtime-vision"; payload: z.infer<typeof vision> }
  | { operation: "transformation-support"; payload: z.infer<typeof support> }
  | { operation: "repository-discovery"; payload: { fieldCount: number } }
  | { operation: "repository-understanding"; payload: { fieldCount: number } }
  | { operation: "receipt-verification"; payload: z.infer<typeof receipt> };
export function responseAllowed(operation: string) {
  return ["documentation-composition", "repository-discovery", "repository-understanding", "visual-selection", "runtime-vision", "transformation-support", "receipt-verification"].includes(operation);
}
type RetainedPayload = { payload: unknown | null; reason: string | null };
function bounded(payload: unknown): RetainedPayload {
  try {
    const json = JSON.stringify(payload);
    if (!json) return { payload: null, reason: "logging-data-invalid" };
    if (Buffer.byteLength(json, "utf8") > INVOCATION_PAYLOAD_MAX_BYTES) return { payload: null, reason: "oversized" };
    // Snapshot only the approved representation; do not retain mutable feature objects.
    return { payload: JSON.parse(json) as unknown, reason: null };
  } catch { return { payload: null, reason: "logging-data-invalid" }; }
}
/** Exact final input string only. No instructions, transport envelope, image or domain object. */
export function requestPayload(operation: string, input?: string): RetainedPayload {
  if (operation === "repository-discovery") {
    try {
      const metadata = z.object({ ecosystems: z.array(z.string().max(60)).max(8), paths: z.array(z.string().max(120)).max(160), omitted: z.number().int().nonnegative() }).strict().parse(JSON.parse(input ?? ""));
      return bounded({ pathCount: metadata.paths.length, omitted: metadata.omitted, ecosystemCount: metadata.ecosystems.length });
    } catch { return { payload: null, reason: "logging-data-invalid" }; }
  }
  if (operation === "repository-understanding") {
    try {
      const parsed = z.object({ productContext: z.string().max(500).optional(), files: z.array(z.object({ path: z.string().max(1024), text: z.string().max(3500) }).strict()).max(6) }).strict().parse(JSON.parse(input ?? ""));
      return bounded({ contextSupplied: Boolean(parsed.productContext), fileCount: parsed.files.length, excerptCharacters: parsed.files.reduce((sum, file) => sum + file.text.length, 0) });
    } catch { return { payload: null, reason: "logging-data-invalid" }; }
  }
  if (operation !== "visual-selection" && operation !== "receipt-verification") return { payload: null, reason: "not-allowlisted" };
  if (typeof input !== "string" || (operation === "receipt-verification" && input !== "Receipt identifier: proof-123")) return { payload: null, reason: "logging-data-invalid" };
  return bounded({ input });
}
export function responsePayload(operation: string, response?: ApprovedInvocationResponse): RetainedPayload {
  if (!responseAllowed(operation)) return { payload: null, reason: "not-allowlisted" };
  if (!response || operation !== response.operation) return { payload: null, reason: "logging-data-invalid" };
  const schema = operation === "documentation-composition" ? compositionOutputSchema : operation === "repository-discovery" ? discovery : operation === "repository-understanding" ? understanding : operation === "visual-selection" ? selection : operation === "runtime-vision" ? vision : operation === "transformation-support" ? support : receipt;
  try {
    // Bound before schema traversal; malformed/unknown fields never enter persistence.
    const size = bounded(operation === "documentation-composition"
      ? JSON.parse(debugSection(JSON.stringify(response.payload), INVOCATION_PAYLOAD_MAX_BYTES).content) as unknown : response.payload);
    if (size.reason) return size;
    const parsed = schema.safeParse(size.payload);
    return parsed.success ? { payload: parsed.data, reason: null } : { payload: null, reason: "logging-data-invalid" };
  } catch { return { payload: null, reason: "logging-data-invalid" }; }
}

export function receiptResponse(data: unknown): ApprovedInvocationResponse | undefined {
  const parsed = receipt.safeParse(data);
  return parsed.success ? { operation: "receipt-verification", payload: parsed.data } : undefined;
}

/** Read historical projections through the same strict allowlist; never expose arbitrary JSONB. */
export function storedResponsePayload(operation: string, value: unknown): unknown | undefined {
  if (!responseAllowed(operation)) return undefined;
  const schema = operation === "documentation-composition" ? compositionOutputSchema : operation === "repository-discovery" ? discovery : operation === "repository-understanding" ? understanding : operation === "visual-selection" ? selection : operation === "runtime-vision" ? vision : operation === "transformation-support" ? support : receipt;
  const size = bounded(value);
  if (size.reason) return undefined;
  const parsed = schema.safeParse(size.payload);
  return parsed.success ? parsed.data : undefined;
}
export function storedRequestInput(operation: string, value: unknown): string | undefined {
  if (operation !== "visual-selection" && operation !== "receipt-verification") return undefined;
  const size = bounded(value);
  if (size.reason) return undefined;
  const parsed = z.object({ input: z.string() }).strict().safeParse(size.payload);
  return parsed.success && !requestPayload(operation, parsed.data.input).reason ? parsed.data.input : undefined;
}
