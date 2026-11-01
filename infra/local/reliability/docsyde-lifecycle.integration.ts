import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { spawnOwned, stopOwned } from "@/integrations/reliability/process-ownership";
import { reliabilityEnvironment } from "@/integrations/reliability/subprocess-environment";
import { parseReliabilityContext } from "@/integrations/reliability/execution-context";
import { verifyRuntimeIdentity } from "@/integrations/reliability/runtime-identity";
import { verifyDocsydeIdentity } from "@/integrations/reliability/docsyde-identity";
import { verifyHostRestartReadiness } from "@/integrations/reliability/host-ownership";

const exec = promisify(execFile);
test("sealed scenarios: real DocSyde start/stop/restart verifies owning PID and isolated database without inference", { timeout: 240000 }, async () => {
  const preparation = process.env.DOCSYDE_RELIABILITY_INTEGRATION_PREPARATION;
  assert.ok(preparation, "Supply a fresh sealed preparation file; this test retains admission evidence");
  const root = process.cwd(), cli = join(root, "infra/local/reliability/cli.ts");
  const prep = JSON.parse(await readFile(preparation, "utf8"));
  const buildId = (await readFile(join(root, ".next/BUILD_ID"), "utf8")).trim();
  for (const scenario of prep.scenarios) {
    const context = parseReliabilityContext(JSON.parse(await readFile(scenario.context, "utf8")));
    const manifest = JSON.parse(await readFile(context.manifestPath!, "utf8"));
    const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${scenario.databaseName}`;
    const env = reliabilityEnvironment(context, scenario.context, "application", { NODE_ENV: "production", DATABASE_URL: url.href,
      DOCSYDE_RUN_RUNTIME_CONFIG: manifest.runtime.path, DOCSYDE_RELIABILITY_MANIFEST: context.manifestPath! });
    const host = spawnOwned(context, process.execPath, ["--conditions=react-server", "--import", "tsx", cli, "host", context.manifestPath!, join(context.outputRoot, "checkout")], { cwd: root, env, stdio: "ignore" });
    try {
      let hostReady = false;
      for (let i = 0; i < 100; i++) { try { await verifyRuntimeIdentity("http://127.0.0.1:45873", context.runtimeIdentity!); hostReady = true; break; } catch { await new Promise(r => setTimeout(r, 150)); } }
      assert.ok(hostReady);
      const tokens = [];
      for (let generation = 0; generation < 2; generation++) {
        const server = spawnOwned(context, process.execPath, ["--conditions=react-server", "--import", "tsx", cli, "serve", context.manifestPath!, "3000"], { cwd: root, env, stdio: "ignore" });
        try {
          let ready = false;
          for (let i = 0; i < 120; i++) {
            if (server.exitCode !== null) break;
            try {
              const record = JSON.parse(await readFile(join(context.outputRoot, "docsyde-process.json"), "utf8"));
              await verifyDocsydeIdentity(context, record.token, record.childPid, { port: "3000", databaseName: scenario.databaseName, buildId });
              await readFile(join(context.outputRoot, "docsyde-history", `${record.token}.healthy.json`));
              tokens.push(record.token); ready = true; break;
            } catch { await new Promise(r => setTimeout(r, 150)); }
          }
          assert.ok(ready, "HTTP availability without exact process/database identity must not admit submission");
          await assert.rejects(exec(process.execPath, ["--conditions=react-server", "--import", "tsx", cli, "serve", context.manifestPath!, "3000"], { cwd: root, env, timeout: 10000 }));
        } finally { await stopOwned(context, server, 10000); }
        assert.equal(JSON.parse(await readFile(join(context.outputRoot, "docsyde-process.json"), "utf8")).state, "stopped");
      }
      assert.notEqual(tokens[0], tokens[1]);
      await exec(process.execPath, ["--conditions=react-server", "--import", "tsx", cli, "docsyde-readiness"], { cwd: root, env, timeout: 10000 });
      await verifyHostRestartReadiness(context, join(context.outputRoot, "docsyde-restart.json"), "docsyde");
    } finally { await stopOwned(context, host, 10000); }
  }
});
