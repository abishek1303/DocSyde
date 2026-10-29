import { readFile } from "node:fs/promises";
import { z } from "zod";
import { attachRuntime, launchRuntime } from "@/runner/runtime/runtime";
const config = z.object({ baseUrl: z.string(), readinessPath: z.string().optional(), startupTimeoutMs: z.number().positive().optional(), cwd: z.string().optional(), command: z.string().optional(), args: z.array(z.string()).default([]), env: z.record(z.string(), z.string()).optional() });
async function main() {
  const input = config.parse(JSON.parse(await readFile(process.argv[2], "utf8")));
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  const options = { ...input, signal: controller.signal };
  const session = input.command ? await launchRuntime({ ...options, cwd: input.cwd ?? process.cwd(), command: input.command }) : await attachRuntime(options);
  try { console.log(JSON.stringify(session.description)); } finally { await session.stop(); process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
}
main().catch(() => { console.error("Runtime verification failed; check configuration and readiness."); process.exitCode = 1; });
