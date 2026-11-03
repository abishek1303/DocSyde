import "server-only";
import { runRuntimeConfigSchema } from "./runtime-configuration";
import { loadApprovedRuntimeConfiguration } from "./runtime-settings";
export { runRuntimeConfigSchema } from "./runtime-configuration";
import { constants } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import { runtimeCaptureAvailable } from "@/integrations/browser/capture-trace";
import { getArtifactStorage } from "@/integrations/storage/storage";
import { localUrl, probeRuntime } from "@/runner/runtime/runtime";
import { documentationHash } from "../documents/document-identity";

export async function loadRunRuntimeConfig(repository: string) {
  const path = process.env.DOCSYDE_RUN_RUNTIME_CONFIG;
  try {
    const managed = await loadApprovedRuntimeConfiguration(repository);
    if (managed.status === "invalid") return { available: false as const, reason: "managed-approval-required" };
    let config;
    if (managed.status === "approved") config = managed.config;
    else {
      if (!path) return { available: false as const, reason: "no-trusted-workflow" };
      const bytes = await readFile(path);
      if (bytes.length > 128 * 1024) throw new Error("Configuration too large");
      config = runRuntimeConfigSchema.parse(JSON.parse(bytes.toString("utf8")));
      // Executable managed configuration can only originate from the separate approval store.
      if (config.runtime.mode === "managed") return { available: false as const, reason: "managed-approval-required" };
    }
    if (managed.status === "approved" && config.runtime.mode === "attach" && await probeRuntime(config.runtime.options) !== "healthy") return { available: false as const, reason: "managed-existing-server-unavailable" };
    if (config.repository !== repository) return { available: false as const, reason: "no-repository-workflow" };
    localUrl(config.runtime.options.baseUrl);
    const descriptor = { id: config.id, version: config.version, sha256: documentationHash(config) };
    if (config.maxSelectedScreenshots === 0) return { available: false as const, reason: "runtime-inspection-disabled", descriptor };
    if (!process.env.META_API_KEY) return { available: false as const, reason: "vision-capability-unavailable", descriptor };
    if (!await runtimeCaptureAvailable()) return { available: false as const, reason: "browser-capability-unavailable", descriptor };
    try {
      const storage = getArtifactStorage();
      await mkdir(process.env.DOCSYDE_STORAGE_DIRECTORY!, { recursive: true });
      await access(process.env.DOCSYDE_STORAGE_DIRECTORY!, constants.R_OK | constants.W_OK);
      return { available: true as const, config, descriptor, storage };
    } catch { return { available: false as const, reason: "artifact-storage-unavailable", descriptor }; }
  } catch { return { available: false as const, reason: "invalid-runtime-configuration" }; }
}
