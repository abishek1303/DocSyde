import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import childProcess from "node:child_process";
import { launchRuntime, attachRuntime, localUrl } from "@/runner/runtime/runtime";
test("launch, readiness, attach and owned-child cleanup", async () => {
  const probe = createServer(); await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address(); assert.ok(address && typeof address !== "string");
  const port = address.port; await new Promise<void>((resolve) => probe.close(() => resolve()));
  const baseUrl = `http://127.0.0.1:${port}`;
  const session = await launchRuntime({ cwd: process.cwd(), command: process.execPath, args: ["infra/local/runner/fixture.mjs", String(port)], baseUrl, startupTimeoutMs: 5000 });
  try { const attached = await attachRuntime({ baseUrl }); await attached.stop(); assert.ok((await fetch(baseUrl)).ok); }
  finally { await session.stop(); await session.stop(); }
  await assert.rejects(fetch(baseUrl));
  assert.throws(() => localUrl("https://example.com"));
  await assert.rejects(launchRuntime({ cwd: process.cwd(), command: process.execPath, args: ["-e", "process.exit(1)"], baseUrl, startupTimeoutMs: 1000 }));
});

test("a redirecting runtime URL is occupied even when its health endpoint is ready", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/health") res.end("ready");
    else { res.writeHead(302, { Location: "/health" }); res.end(); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  const spawn = t.mock.method(childProcess, "spawn");
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    assert.ok((await fetch(`${baseUrl}/health`)).ok);
    let session: Awaited<ReturnType<typeof launchRuntime>> | undefined;
    try {
      await assert.rejects(async () => {
        session = await launchRuntime({ cwd: process.cwd(), command: process.execPath,
          args: ["-e", "setInterval(() => {}, 1000)"], baseUrl, readinessPath: "/health", startupTimeoutMs: 1000 });
      }, /Runtime URL already serves an application/);
      assert.equal(spawn.mock.callCount(), 0, "occupied URLs must be rejected before spawning");
    } finally { await session?.stop(); }
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
