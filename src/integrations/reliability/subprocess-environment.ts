import "server-only";
import { join } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { ownedPath } from "./owned-resources";
import type { ReliabilityContext } from "./execution-context";

type Profile = "tools" | "contracts" | "host" | "browser" | "postgres" | "application";
/** No arbitrary parent variables, runtime launch env, proxies, Git selectors, or Node hooks. */
export function reliabilityEnvironment(context: ReliabilityContext, contextPath: string, profile: Profile,
  explicit: Record<string, string> = {}, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: profile === "contracts" ? "test" : parent.NODE_ENV ?? "development" };
  for (const key of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "LANG", "LC_ALL"]) if (parent[key]) env[key] = parent[key];
  Object.assign(env, {
    NODE_ENV: profile === "contracts" ? "test" : parent.NODE_ENV ?? "development",
    DOCSYDE_RELIABILITY_CONTEXT: contextPath,
    TMPDIR: join(context.outputRoot, "tmp"), TMP: join(context.outputRoot, "tmp"), TEMP: join(context.outputRoot, "tmp"),
    DATABASE_URL: "", BASETEN_API_KEY: "", META_API_KEY: "", GITHUB_TOKEN: "",
    DOCSYDE_STORAGE_DIRECTORY: join(context.outputRoot, "artifacts"),
  });
  if (profile === "contracts") env.DOCSYDE_RELIABILITY_CONTRACT_TEST = "1";
  if (profile === "application") {
    // The separately invoked server needs these credentials/configuration. Values
    // stay in the child environment and never enter a receipt or diagnostic.
    for (const key of ["GITHUB_TOKEN", "BASETEN_API_KEY", "META_API_KEY", "BASETEN_MODEL", "META_VISION_MODEL", "DOCSYDE_ANALYSIS_REPOSITORIES",
      "DOCSYDE_HOST_ORIGIN", "DOCSYDE_REPOSITORY_OWNER", "DOCSYDE_REPOSITORY_NAME", "DOCSYDE_DELIVERY_ENDPOINT", "GITHUB_REPOSITORY"]) if (parent[key] !== undefined) env[key] = parent[key];
  }
  return Object.assign(env, explicit);
}
export function reliabilityBrowserEnvironment(context: ReliabilityContext): Record<string, string> {
  return Object.fromEntries(Object.entries(reliabilityEnvironment(context, process.env.DOCSYDE_RELIABILITY_CONTEXT!, "browser"))
    .filter((entry): entry is [string, string] => entry[1] !== undefined));
}
export async function reliabilityBrowserOptions(context: ReliabilityContext) {
  await ownedPath(context, join(context.outputRoot, "sessions"));
  const artifactsDir = await mkdtemp(join(context.outputRoot, "sessions/browser-"));
  await writeFile(join(artifactsDir, ".reliability-owner.json"), JSON.stringify({ experimentId: context.experimentId, scenario: context.scenario, creatorPid: process.pid }), { flag: "wx", mode: 0o600 });
  return { env: reliabilityBrowserEnvironment(context), artifactsDir, downloadsPath: artifactsDir, tracesDir: artifactsDir };
}
