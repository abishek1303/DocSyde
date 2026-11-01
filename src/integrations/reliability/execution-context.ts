import "server-only";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

export const reliabilitySha = z.string().regex(/^[a-f0-9]{40}$/);
export const reliabilityHash = z.string().regex(/^[a-f0-9]{64}$/);
export const runtimeIdentitySchema = z.object({
  version: z.literal(1), experimentId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  scenario: z.enum(["A", "B", "C"]), docsydeSha: reliabilitySha, requestDeskSha: reliabilitySha,
  buildSha256: reliabilityHash, workflowVersion: z.literal("1"), runtimeVersion: z.literal("request-desk-reliability-v1"),
}).strict();
export type ReliabilityRuntimeIdentity = Readonly<z.infer<typeof runtimeIdentitySchema>>;
export const reliabilityContextSchema = z.object({
  version: z.literal(1), experimentId: runtimeIdentitySchema.shape.experimentId,
  scenario: z.enum(["A", "B", "C"]).nullable(), mode: z.enum(["offline", "baseline-read", "provision", "scenario", "report"]),
  repositoryRoot: z.string().min(1), docsydeSha: reliabilitySha, requestDeskSha: reliabilitySha.nullable(),
  outputRoot: z.string().min(1), runtimeIdentity: runtimeIdentitySchema.nullable(),
  manifestPath: z.string().nullable(),
}).strict();
export type ReliabilityContext = Readonly<Omit<z.infer<typeof reliabilityContextSchema>, "runtimeIdentity"> & { runtimeIdentity: ReliabilityRuntimeIdentity | null }>;
export class ReliabilityIsolationError extends Error {
  constructor(public readonly code: string) { super(`Reliability isolation rejected: ${code}`); }
}

export function parseReliabilityContext(value: unknown): ReliabilityContext {
  const context = reliabilityContextSchema.parse(value);
  if (!isAbsolute(context.repositoryRoot) || !isAbsolute(context.outputRoot)
    || context.outputRoot !== join(context.repositoryRoot, ".artifacts", "reliability", context.experimentId, context.scenario ?? "shared")
    || (context.manifestPath !== null && !isAbsolute(context.manifestPath))) throw new ReliabilityIsolationError("context-path");
  if (context.runtimeIdentity && (context.runtimeIdentity.experimentId !== context.experimentId
    || context.runtimeIdentity.scenario !== context.scenario || context.runtimeIdentity.docsydeSha !== context.docsydeSha
    || context.runtimeIdentity.requestDeskSha !== context.requestDeskSha)) throw new ReliabilityIsolationError("context-runtime");
  if (context.mode === "scenario" && (!context.scenario || !context.requestDeskSha || !context.runtimeIdentity || !context.manifestPath)) throw new ReliabilityIsolationError("scenario-context");
  if (context.runtimeIdentity) Object.freeze(context.runtimeIdentity);
  return Object.freeze(context);
}

let established: { source: string; context: ReliabilityContext } | undefined;
export function reliabilityContext(): ReliabilityContext | null {
  const source = process.env.DOCSYDE_RELIABILITY_CONTEXT;
  if (!source) {
    if (established || process.env.DOCSYDE_RELIABILITY_MANIFEST) throw new ReliabilityIsolationError("missing-context");
    return null;
  }
  if (established) {
    if (established.source !== source) throw new ReliabilityIsolationError("changed-context");
    return established.context;
  }
  // The environment contains a path, never credentials or a serialized environment.
  if (!isAbsolute(source)) throw new ReliabilityIsolationError("context-file-path");
  const path = resolve(source);
  const context = parseReliabilityContext(JSON.parse(readFileSync(path, "utf8")));
  for (const key of ["PLAYWRIGHT_BROWSERS_PATH", "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "NODE_OPTIONS"]) {
    if (process.env[key]) throw new ReliabilityIsolationError("ambient-execution-override");
  }
  // Playwright's parent-side profile creation uses os.tmpdir(), before the
  // browser subprocess environment is applied. Bind that location as well.
  for (const key of ["TMPDIR", "TMP", "TEMP"]) process.env[key] = join(context.outputRoot, "tmp");
  established = { source, context };
  return context;
}
export function requireReliabilityContext(modes?: readonly ReliabilityContext["mode"][]) {
  const context = reliabilityContext();
  if (!context || (modes && !modes.includes(context.mode))) throw new ReliabilityIsolationError("missing-or-wrong-mode");
  return context;
}
export function assertScenarioContext(context: ReliabilityContext, scenario: string, head?: string) {
  if (context.scenario !== scenario || (head && context.requestDeskSha !== head)) throw new ReliabilityIsolationError("scenario-mismatch");
}
export function assertReliabilitySideEffect(operation: string) {
  const context = reliabilityContext();
  if (context && (context.mode !== "scenario" || process.env.DOCSYDE_RELIABILITY_CONTRACT_TEST === "1")) throw new ReliabilityIsolationError(`forbidden-${operation}`);
}

/** Only Node test mocks may replace transport in the explicitly sandboxed contract child. */
export function assertReliabilityTransport() {
  const context = reliabilityContext();
  if (!context) return;
  const transport: unknown = globalThis.fetch;
  const mock: unknown = typeof transport === "function" ? Reflect.get(transport, "mock") : null;
  if (context.mode === "offline" && process.env.DOCSYDE_RELIABILITY_CONTRACT_TEST === "1"
    && typeof mock === "object" && mock !== null && typeof Reflect.get(mock, "callCount") === "function") return;
  assertReliabilitySideEffect("provider-transport");
}
