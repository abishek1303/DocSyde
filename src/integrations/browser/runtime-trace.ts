import { z } from "zod";
import { captureStepSchema, captureSelector } from "./capture-step";

export const DEFAULT_MAX_CHECKPOINTS = 12;
export const DEFAULT_MAX_STATES = 32;
export const DEFAULT_MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024;
export const MAX_WORKFLOW_STEPS = 100;
const boundaryTrigger = z.enum(["initial", "click", "fill", "select", "check", "waitFor", "checkpoint", "final"]);
const selector = captureSelector.max(1000);
const action = z.discriminatedUnion("type", [
  ...captureStepSchema.options,
  z.object({ type: z.literal("checkpoint") }).strict(),
]).superRefine((step, context) => {
  if (step.type !== "checkpoint" && step.selector.length > 1000) context.addIssue({ code: "custom", message: "Workflow selector exceeds its local limit." });
  if ((step.type === "fill" || step.type === "select") && step.value.length > 10_000) context.addIssue({ code: "custom", message: "Workflow input value exceeds its local limit." });
});
export const runtimeWorkflowSchema = z.object({
  baseUrl: z.url(), path: z.string().max(2048).default("/"),
  steps: z.array(action).max(MAX_WORKFLOW_STEPS).default([]), readySelector: selector.optional(),
  regions: z.array(z.object({ name: z.string().min(1).max(100), selector }).strict()).max(10).default([]),
  sensitiveSelectors: z.array(selector).max(30).default([]),
  screenshotRegion: selector.optional(),
  // Kept only in trusted executable configuration, never in the trace/model DTO.
  secrets: z.array(z.string().min(1).max(10_000)).max(100).default([]),
  viewport: z.object({ width: z.number().int().min(1).max(3840), height: z.number().int().min(1).max(2160) }).strict().default({ width: 1440, height: 900 }),
  limits: z.object({
    maxCheckpoints: z.number().int().min(1).max(24).default(DEFAULT_MAX_CHECKPOINTS),
    maxStates: z.number().int().min(1).max(64).default(DEFAULT_MAX_STATES),
    maxScreenshotBytes: z.number().int().min(1).max(64 * 1024 * 1024).default(DEFAULT_MAX_SCREENSHOT_BYTES),
    timeoutMs: z.number().int().min(1).max(180_000).default(120_000),
  }).strict().prefault({}),
}).strict();
export type RuntimeWorkflowInput = z.input<typeof runtimeWorkflowSchema>;

const text = z.string().max(2000);
const snapshot = z.object({
  pathname: z.string().min(1).max(1024), headings: z.array(z.string().max(300)).max(20),
  text: z.string().max(4000), regions: z.array(z.object({ name: z.string().max(100), text }).strict()).max(10),
  controls: z.array(z.object({
    role: z.string().max(50), name: z.string().max(200), populated: z.boolean().nullable(),
    checked: z.boolean().nullable(), selected: z.boolean().nullable(), expanded: z.boolean().nullable(),
  }).strict()).max(60),
  overlays: z.array(z.string().max(300)).max(10),
  hostContext: z.object({ applicationId: z.string().max(100), route: z.string().max(1024), featureIds: z.array(z.string().max(100)).max(10) }).strict().nullable(),
  truncated: z.boolean(),
}).strict();
export const runtimeTraceSchema = z.object({
  version: z.literal(1), traceId: z.uuid(), startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(),
  status: z.literal("completed"), requestedPathname: z.string().min(1).max(1024),
  viewport: runtimeWorkflowSchema.shape.viewport,
  events: z.array(z.object({
    order: z.number().int().nonnegative(), at: z.iso.datetime(), trigger: boundaryTrigger,
    actionIndex: z.number().int().nonnegative().nullable(), stateId: z.uuid().nullable(),
  }).strict()).max(MAX_WORKFLOW_STEPS + 2),
  states: z.array(z.object({
    stateId: z.uuid(), order: z.number().int().nonnegative(), at: z.iso.datetime(),
    trigger: boundaryTrigger,
    actionIndex: z.number().int().nonnegative().nullable(), occurrences: z.number().int().positive(),
    effects: z.array(z.string().max(100)).max(6), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    snapshot,
  }).strict()).max(64),
  checkpoints: z.array(z.object({
    captureId: z.uuid(), stateId: z.uuid(), capturedAt: z.iso.datetime(),
    crop: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative(), width: z.number().positive(), height: z.number().positive() }).strict().nullable(),
    screenshot: z.object({ artifactKey: z.uuid(), mimeType: z.literal("image/png"), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().nullable(),
    eligible: z.boolean(), limitation: z.enum(["masking-failed", "image-budget", "screenshot-failed"]).nullable(),
  }).strict()).max(24),
  coverage: z.object({
    stateBoundaries: z.number().int().nonnegative(), omittedStates: z.number().int().nonnegative(),
    omittedCheckpoints: z.number().int().nonnegative(), truncatedSnapshots: z.number().int().nonnegative(),
    pageErrors: z.number().int().nonnegative(), dismissedDialogs: z.number().int().nonnegative(), navigationStatus: z.number().int().nullable(),
  }).strict(),
}).strict();
export type RuntimeTrace = z.infer<typeof runtimeTraceSchema>;
export type RuntimeSnapshot = z.infer<typeof snapshot>;
