import net from "node:net";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";

/** Test-only process boundary; a swallowed violation still makes the child fail. */
export function installOfflineNetworkBoundary(repositoryRoot: string) {
  let violations = 0;
  const forbidden = () => { violations++; throw new Error("Reliability offline external operation forbidden."); };
  globalThis.fetch = forbidden;
  net.Socket.prototype.connect = forbidden;
  // The only nested contract command is the static React renderer. In test
  // workers, arbitrary commands cannot escape the socket/provider restrictions.
  const renderer = resolve(repositoryRoot, "infra/local/documentation/render-priority-review.ts");
  childProcess.execFileSync = new Proxy(childProcess.execFileSync, { apply(target, receiver, args: unknown[]) {
    const [file, argv, options] = args;
    if (file !== process.execPath || !Array.isArray(argv) || argv.length !== 4 || argv[0] !== "--import" || argv[1] !== "tsx"
      || typeof argv[2] !== "string" || resolve(repositoryRoot, argv[2]) !== renderer || argv[3] !== "-"
      || typeof options !== "object" || options === null || !("env" in options) || typeof options.env !== "object" || options.env === null
      || !("DATABASE_URL" in options.env) || options.env.DATABASE_URL !== "") return forbidden();
    return Reflect.apply(target, receiver, args);
  } });
  if (process.env.NODE_TEST_CONTEXT || process.env.DOCSYDE_RELIABILITY_CONTRACT_WORKER === "1") {
    childProcess.spawn = new Proxy(childProcess.spawn, { apply: forbidden });
    childProcess.spawnSync = new Proxy(childProcess.spawnSync, { apply: forbidden });
    childProcess.exec = new Proxy(childProcess.exec, { apply: forbidden });
    childProcess.execSync = new Proxy(childProcess.execSync, { apply: forbidden });
    childProcess.execFile = new Proxy(childProcess.execFile, { apply: forbidden });
    childProcess.fork = new Proxy(childProcess.fork, { apply: forbidden });
  }
  syncBuiltinESMExports();
  process.on("exit", () => { if (violations) process.exitCode = 1; });
}
