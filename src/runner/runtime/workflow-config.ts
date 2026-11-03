import { approvedStartup } from "./managed-configuration";
import { z } from "zod";
import { runtimeWorkflowSchema } from "@/integrations/browser/runtime-trace";

const runtimeOptions = z.object({ baseUrl: z.url(), readinessPath: z.string().optional(), startupTimeoutMs: z.number().int().positive().optional() }).strict();
// Trusted executable configuration shared by the local verifier and application caller.
export const workflowRuntimeConfigSchema = z.object({
  runtime: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("managed"), options: runtimeOptions.extend({ approval: approvedStartup }) }).strict(),
    z.object({ mode: z.literal("attach"), options: runtimeOptions }).strict(),
    z.object({ mode: z.literal("launch"), options: runtimeOptions.extend({ cwd: z.string().min(1), command: z.string().min(1), args: z.array(z.string()), env: z.record(z.string(), z.string()).optional() }) }).strict(),
  ]),
  workflow: runtimeWorkflowSchema.omit({ baseUrl: true }), description: z.string().min(1).max(2000),
  maxSelectedScreenshots: z.number().int().min(0).max(3).default(3),
}).strict();
