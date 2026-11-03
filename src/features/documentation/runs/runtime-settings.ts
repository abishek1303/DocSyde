import "server-only";
import { z } from "zod";
import { selectedRepository } from "@/features/sources/run-preparation";
import { approvedStartup, reviewManagedStartup, verifyManagedStartup, type StartupInput } from "@/runner/runtime/managed-configuration";
import { readRuntimeSettings, writeRuntimeSettings } from "@/integrations/storage/runtime-settings";
import { reliabilityContext, ReliabilityIsolationError } from "@/integrations/reliability/execution-context";
import { runRuntimeConfigSchema } from "./runtime-configuration";

export type RuntimeSettingsPreview = { input: StartupInput; fingerprint: string; scripts: Record<string, string>; scriptNames: string[] };
export type RuntimeSettingsState = { preview?: RuntimeSettingsPreview; error?: string; message?: string };
function location(repository: string) { return selectedRepository({ repository }).location; }
export async function previewRuntimeSettings(repository: string, input: Omit<StartupInput, "repository">): Promise<RuntimeSettingsPreview> {
  const reviewed = await reviewManagedStartup({ ...input, repository: location(repository) });
  const workflow = runRuntimeConfigSchema.parse(reviewed.workflowRaw);
  if (new URL(workflow.runtime.options.readinessPath ?? "/", reviewed.input.baseUrl).origin !== new URL(reviewed.input.baseUrl).origin) throw new Error("Readiness must use the approved application origin.");
  if (workflow.runtime.mode === "managed") throw new Error("Choose a trusted attach/launch workflow file, not another managed configuration.");
  return { input: reviewed.input, fingerprint: reviewed.fingerprint, scripts: reviewed.checkout.scripts, scriptNames: reviewed.checkout.scriptNames };
}
/** An explicit local operator action; generated understanding/model results never call this boundary. */
export async function approveRuntimeSettings(raw: unknown, directory?: string) {
  if (reliabilityContext()) throw new ReliabilityIsolationError("runtime-launch");
  const input = z.object({ repository: z.string(), checkout: z.string(), directory: z.string(), manager: z.enum(["npm", "pnpm", "yarn"]), script: z.string(), baseUrl: z.string(), workflowPath: z.string(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict().parse(raw);
  const { repository, fingerprint, confirmed, ...settings } = input;
  void confirmed;
  const reviewed = await previewRuntimeSettings(repository, settings);
  if (reviewed.fingerprint !== fingerprint) throw new Error("Configuration changed. Review it again before approval.");
  const approval = approvedStartup.parse({ version: 1, input: reviewed.input, fingerprint, approvedAt: new Date().toISOString(), enabled: true });
  await writeRuntimeSettings(location(repository), approval, directory);
  return approval;
}
export async function getRuntimeSettings(repository: string, directory?: string) {
  const saved = await readRuntimeSettings(location(repository), directory);
  return saved === null ? null : approvedStartup.parse(saved);
}
export async function disableRuntimeStartup(repository: string, directory?: string) {
  const saved = await getRuntimeSettings(repository, directory);
  if (saved) await writeRuntimeSettings(location(repository), { ...saved, enabled: false }, directory);
}
export async function loadApprovedRuntimeConfiguration(repository: string, directory?: string) {
  // Historical sealed experiments must keep their exact operator workflow and identity.
  if (reliabilityContext() || process.env.DOCSYDE_RELIABILITY_MANIFEST) return { status: "absent" as const };
  const saved = await readRuntimeSettings(repository, directory);
  if (saved === null) return { status: "absent" as const };
  try {
    const reviewed = await verifyManagedStartup(saved);
    if (reviewed.approval.input.repository !== repository) throw new Error("Project mismatch");
    const template = runRuntimeConfigSchema.parse(reviewed.workflowRaw);
    if (template.runtime.mode === "managed") throw new Error("Nested managed workflow");
    const options = { baseUrl: reviewed.input.baseUrl, readinessPath: template.runtime.options.readinessPath, startupTimeoutMs: template.runtime.options.startupTimeoutMs ?? 60_000 };
    const config = runRuntimeConfigSchema.parse({ ...template,
      runtime: reviewed.approval.enabled ? { mode: "managed", options: { ...options, approval: reviewed.approval } } : { mode: "attach", options } });
    return { status: "approved" as const, config };
  } catch { return { status: "invalid" as const }; }
}
