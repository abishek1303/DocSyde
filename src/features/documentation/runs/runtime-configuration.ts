import "server-only";
import { z } from "zod";
import { inspectionCapabilitySchema } from "@/features/sources/product-analysis";
import { repositoryPathInput } from "@/integrations/github/source-reader";
import { workflowRuntimeConfigSchema } from "@/runner/runtime/workflow-config";

export const runRuntimeConfigSchema = workflowRuntimeConfigSchema.extend({
  repository: z.url(), id: z.string().min(1).max(100), version: z.string().min(1).max(100),
  capabilities: z.array(inspectionCapabilitySchema).max(10).default([]),
  supportingSourcePaths: z.array(repositoryPathInput).max(3).default([]),
  supportedPathnames: z.array(z.string().regex(/^\/[A-Za-z0-9._~/-]*$/).max(1024)).min(1).max(20),
}).strict().superRefine((config, ctx) => {
  if (new Set(config.capabilities.map(c => c.id)).size !== config.capabilities.length || new Set(config.supportingSourcePaths).size !== config.supportingSourcePaths.length || config.capabilities.some(c => !config.supportedPathnames.includes(c.pathname))) ctx.addIssue({ code: "custom", message: "Invalid capability coverage or duplicate configuration" });
  if ((config.runtime.options.startupTimeoutMs ?? 60_000) > 60_000) ctx.addIssue({ code: "custom", message: "Run startup budget exceeds 60 seconds" });
});
