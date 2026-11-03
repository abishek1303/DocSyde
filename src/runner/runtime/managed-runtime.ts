import "server-only";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { attachRuntime, launchRuntime, probeRuntime, RuntimeCleanupError, type RuntimeSession } from "./runtime";
import { managedExecutable, ManagedRuntimeUnavailable, verifyManagedStartup, type ApprovedStartup } from "./managed-configuration";
import { reliabilityContext, ReliabilityIsolationError } from "@/integrations/reliability/execution-context";

type Options = Parameters<typeof attachRuntime>[0] & { approval: ApprovedStartup };
export async function startManagedRuntime(options: Options): Promise<RuntimeSession> {
  if (reliabilityContext()) throw new ReliabilityIsolationError("runtime-launch");
  options.signal?.throwIfAborted();
  if (process.platform === "win32") throw new ManagedRuntimeUnavailable("unsupported-platform");
  let reviewed: Awaited<ReturnType<typeof verifyManagedStartup>>;
  try {
    reviewed = await verifyManagedStartup(options.approval);
    if (!reviewed.approval.enabled || reviewed.input.baseUrl !== options.baseUrl) throw new Error("Approval required");
  } catch { throw new ManagedRuntimeUnavailable("approval-required"); }
  const health = await probeRuntime(options);
  if (health === "healthy") return attachRuntime(options);
  if (health === "occupied") throw new ManagedRuntimeUnavailable("port-occupied");
  options.signal?.throwIfAborted();
  if (reviewed.checkout.needsDependencies) {
    const present = await Promise.all([reviewed.checkout.cwd, reviewed.checkout.checkout].map(async root => stat(join(root, "node_modules")).then(value => value.isDirectory()).catch(() => false)));
    if (!present.some(Boolean)) throw new ManagedRuntimeUnavailable("dependencies-missing");
  }
  const command = await managedExecutable(reviewed.input.manager, reviewed.checkout.checkout);
  try {
    return await launchRuntime({ ...options, cwd: reviewed.checkout.cwd, command, args: ["run", reviewed.input.script], ownedProcessGroup: true,
      env: { NODE_ENV: "development", CI: "1", BROWSER: "none", COREPACK_ENABLE_NETWORK: "0", npm_config_offline: "true" } });
  } catch (error) {
    if (options.signal?.aborted || error instanceof RuntimeCleanupError) throw error;
    throw new ManagedRuntimeUnavailable(error instanceof Error && error.message === "Runtime readiness timed out" ? "readiness-timeout" : error instanceof Error && error.message === "Runtime URL already serves an application" ? "port-occupied" : "startup-failed");
  }
}
