import "dotenv/config";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getArtifactStorage } from "@/integrations/storage/storage";
import { captureWithRuntime } from "./capture-runtime";

const runtimeConfig = z.object({
  baseUrl: z.string(), readinessPath: z.string().optional(),
  startupTimeoutMs: z.number().positive().optional(), cwd: z.string().optional(),
  command: z.string().optional(), args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

async function main() {
  const [runtimePath, capturePath, ...extra] = process.argv.slice(2);
  if (!runtimePath || !capturePath || extra.length) {
    throw new Error("Usage: npm run runner:capture:verify -- <runner.json> <capture.json>");
  }
  const input = runtimeConfig.parse(JSON.parse(await readFile(runtimePath, "utf8")));
  // Capture owns validation of its options; its input URL is intentionally ignored.
  const capture = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(capturePath, "utf8")));
  delete capture.baseUrl;
  const storage = getArtifactStorage();
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    const options = { ...input, signal: controller.signal };
    const runtime = input.command
      ? { mode: "launch" as const, options: { ...options, cwd: input.cwd ?? process.cwd(), command: input.command } }
      : { mode: "attach" as const, options };
    console.log(JSON.stringify(await captureWithRuntime({ runtime, capture }, storage), null, 2));
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  }
}

main().catch(() => {
  console.error("Runtime capture verification failed; check configuration, readiness, Chromium, storage and cleanup.");
  process.exitCode = 1;
});
