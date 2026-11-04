import assert from "node:assert/strict";
import { test } from "node:test";
import { localMcpRequest } from "./mcp-config";

test("Docker MCP access requires an exact opt-in and rejects foreign origins", () => {
  const previous = process.env.DOCSYDE_MCP_DOCKER_HOST;
  const request = (host: string, origin?: string) => localMcpRequest(new Headers({ host, ...(origin ? { origin } : {}) }));
  try {
    delete process.env.DOCSYDE_MCP_DOCKER_HOST;
    assert.equal(request("localhost:3000"), true);
    assert.equal(request("host.docker.internal:3000"), false);
    process.env.DOCSYDE_MCP_DOCKER_HOST = "host.docker.internal:3000";
    assert.equal(request("host.docker.internal:3000"), true);
    assert.equal(request("host.docker.internal:3001"), false);
    assert.equal(request("host.docker.internal:3000", "https://evil.example"), false);
    process.env.DOCSYDE_MCP_DOCKER_HOST = "evil.example:3000";
    assert.equal(request("evil.example:3000"), false);
  } finally {
    if (previous === undefined) delete process.env.DOCSYDE_MCP_DOCKER_HOST;
    else process.env.DOCSYDE_MCP_DOCKER_HOST = previous;
  }
});
