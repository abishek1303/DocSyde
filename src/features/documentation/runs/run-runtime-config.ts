import "server-only";
import { inspectionCapabilitySchema } from "@/features/sources/product-analysis";
import { repositoryPathInput } from "@/integrations/github/source-reader";
import { constants } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import { z } from "zod";
import { runtimeCaptureAvailable } from "@/integrations/browser/capture-trace";
import { workflowRuntimeConfigSchema } from "@/runner/runtime/workflow-config";
import { getArtifactStorage } from "@/integrations/storage/storage";
import { localUrl } from "@/runner/runtime/runtime";
import { documentationHash } from "../documents/document-identity";

export const runRuntimeConfigSchema = workflowRuntimeConfigSchema.extend({
  repository: z.url(), id: z.string().min(1).max(100), version: z.string().min(1).max(100),
  capabilities: z.array(inspectionCapabilitySchema).max(10).default([]),
  supportingSourcePaths: z.array(repositoryPathInput).max(3).default([]),
  supportedPathnames: z.array(z.string().regex(/^\/[A-Za-z0-9._~/-]*$/).max(1024)).min(1).max(20),
}).strict().superRefine((config, ctx) => {
  if (new Set(config.capabilities.map(c => c.id)).size !== config.capabilities.length || new Set(config.supportingSourcePaths).size !== config.supportingSourcePaths.length || config.capabilities.some(c => !config.supportedPathnames.includes(c.pathname))) ctx.addIssue({ code: "custom", message: "Invalid capability coverage or duplicate configuration" });
  if ((config.runtime.options.startupTimeoutMs ?? 60_000) > 60_000) ctx.addIssue({ code: "custom", message: "Run startup budget exceeds 60 seconds" });
});
export async function loadRunRuntimeConfig(repository: string) {
  const path = process.env.DOCSYDE_RUN_RUNTIME_CONFIG;
  if (!path) return { available: false as const, reason: "no-trusted-workflow" };
  try {
    const bytes = await readFile(path);
    if (bytes.length > 128 * 1024) throw new Error("Configuration too large");
    const config = runRuntimeConfigSchema.parse(JSON.parse(bytes.toString("utf8")));
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
