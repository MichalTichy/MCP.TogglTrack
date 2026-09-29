import test from "node:test";
import assert from "node:assert/strict";
import { createMcpHttpServer } from "../mcp/http-server.mjs";

test("HTTP MCP serves health and stateless JSON-RPC", async (t) => {
  const server = createMcpHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);

  const initialized = await rpc(base, "initialize", { protocolVersion: "2025-06-18" });
  assert.equal(initialized.status, 200);
  assert.equal((await initialized.json()).result.serverInfo.name, "toggl-track");

  const listed = await rpc(base, "tools/list");
  assert.equal((await listed.json()).result.tools.length, 15);

  const notified = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  assert.equal(notified.status, 202);
});

function rpc(base, method, params = {}) {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}
