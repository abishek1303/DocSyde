import http from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { requireReliabilityContext } from "@/integrations/reliability/execution-context";
import { ownedPath } from "@/integrations/reliability/owned-resources";
import { assertRuntimeIdentity } from "@/integrations/reliability/runtime-identity";
import { requestDeskBuildHash } from "./build-runtime";

// This launcher changes only its own process. The fixture and ordinary /health
// endpoint remain untouched; identity comes from verified build bytes, not a port.
async function main() {
  const context = requireReliabilityContext(["offline", "scenario"]);
  if (!context.runtimeIdentity) throw new Error("Expected built runtime identity required.");
  const app = await ownedPath(context, process.argv[2]);
  const identity = { ...context.runtimeIdentity, buildSha256: await requestDeskBuildHash(app) };
  assertRuntimeIdentity(context.runtimeIdentity, identity);
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event: string, ...args: unknown[]) {
    const [request, response] = args;
    if (event === "request" && request instanceof http.IncomingMessage && response instanceof http.ServerResponse && request.url === "/health") {
      void requestDeskBuildHash(app).then(buildSha256 => {
        assertRuntimeIdentity(identity, { ...identity, buildSha256 });
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(identity));
      }).catch(() => response.writeHead(503).end());
      return true;
    }
    return Reflect.apply(emit, this, [event, ...args]);
  };
  await import(pathToFileURL(join(app, "dist/src/server.js")).href);
}
main().catch(() => { console.error("Request Desk reliability identity rejected."); process.exitCode = 1; });
