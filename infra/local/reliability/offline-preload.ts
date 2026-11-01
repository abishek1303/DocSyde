import { createRequire } from "node:module";
import { join } from "node:path";
import { installOfflineNetworkBoundary } from "./offline-network";
import { requireReliabilityContext, ReliabilityIsolationError } from "@/integrations/reliability/execution-context";

const context = requireReliabilityContext(["offline"]);
if (process.env.DOCSYDE_RELIABILITY_CONTRACT_TEST !== "1") throw new ReliabilityIsolationError("contract-profile-required");
installOfflineNetworkBoundary(context.repositoryRoot);

// Provider/feature contracts use an explicit invocation mock, never the best-effort
// production persistence path. The real logger rejects offline use before its catch.
const load = createRequire(join(context.repositoryRoot, "package.json"));
const path = load.resolve("./src/integrations/ai/invocation-log.ts");
const lifecycle: typeof import("@/integrations/ai/invocation-log") = load(path);
const { admitInference }: typeof import("@/integrations/ai/inference-budget") = load("./src/integrations/ai/inference-budget.ts");
const { resolveInference }: typeof import("@/integrations/ai/operation-policy") = load("./src/integrations/ai/operation-policy.ts");
load.cache[path]!.exports = { ...lifecycle,
  logStructuredInvocation: async (options: Parameters<typeof lifecycle.logStructuredInvocation>[0], invoke: () => Promise<unknown>) => {
    const operation = options.invocation?.operation ?? "structured-generation";
    await admitInference(options.provider, operation, options.settings ?? resolveInference(options.provider, operation), options.invocation?.runId);
    return invoke();
  },
  finishInvocationValidation: async () => {},
  validateInvocation: async (_id: unknown, validate: () => unknown) => validate(),
};
