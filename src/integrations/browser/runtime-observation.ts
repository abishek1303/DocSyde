import { z } from "zod";
import { runtimePath } from "./runtime-redaction";

const id = z.uuid();
const phase = z.enum(["browser", "evidence", "selection", "vision", "lifecycle"]);
const base = { version: z.literal(1), inspectionId: id, seq: z.number().int().positive(), at: z.iso.datetime(), phase };
const action = z.enum(["click", "fill", "select", "check", "uncheck", "press", "wait", "waitFor", "checkpoint"]);
const limit = z.enum(["masking-failed", "image-budget", "screenshot-failed"]);
export const runtimeObservationSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("runtime-session-starting") }).strict(),
  ...([ "runtime-session-started", "runtime-session-stopped", "navigation-started", "navigation-completed", "visual-selection-started", "vision-analysis-started"] as const).map(kind => z.object({ ...base, kind: z.literal(kind) }).strict()),
  ...(["action-started", "action-completed"] as const).map(kind => z.object({ ...base, kind: z.literal(kind), action, actionIndex: z.number().int().nonnegative() }).strict()),
  z.object({ ...base, kind: z.literal("state-captured"), stateId: id.nullable(), pathname: z.string().max(512).refine(value => value.startsWith("/") && runtimePath(value) === value && !/[?#]/.test(value)) }).strict(),
  z.object({ ...base, kind: z.literal("checkpoint-created"), captureId: id, eligible: z.boolean(), limitation: limit.nullable() }).strict(),
  z.object({ ...base, kind: z.literal("preview-available"), captureId: id, revision: z.number().int().positive() }).strict(),
  z.object({ ...base, kind: z.literal("canonical-evidence-retained"), captures: z.array(id).max(24) }).strict(),
  z.object({ ...base, kind: z.literal("visual-selection-completed"), selected: z.array(id).max(3), skipped: z.boolean() }).strict(),
  z.object({ ...base, kind: z.literal("vision-analysis-completed"), captureId: id }).strict(),
  ...(["warning", "failure"] as const).map(kind => z.object({ ...base, kind: z.literal(kind), code: z.enum(["run-failed", "capture-failed", "cleanup-failed", "selection-failed", "vision-failed", "cancelled", "interrupted", "not-retained", "truncated"]) }).strict()),
]);
export type RuntimeObservation = z.infer<typeof runtimeObservationSchema>;
export type RuntimeObservationInput = RuntimeObservation extends infer E ? E extends RuntimeObservation ? Omit<E, "version" | "inspectionId" | "seq" | "at"> : never : never;
export type RuntimeObserver = { event(event: RuntimeObservationInput): void; preview(captureId: string, bytes: Uint8Array): void };
/** Synchronous, exception-safe and deliberately not awaited. Every byte is a copy. */
export function observe(observer: RuntimeObserver | undefined, event: RuntimeObservationInput) { try { observer?.event(event); } catch { /* Presentation cannot alter execution. */ } }
export function observePreview(observer: RuntimeObserver | undefined, captureId: string, bytes: Uint8Array) { try { if (observer && bytes.byteLength <= 2 * 1024 * 1024) observer.preview(captureId, Uint8Array.from(bytes)); } catch { /* Evidence remains private. */ } }
