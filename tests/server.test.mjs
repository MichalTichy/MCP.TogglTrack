import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(testDirectory, "..");
const serverPath = path.join(projectDirectory, "mcp", "server.mjs");

test("stdio server lists the expected tools without exposing the API key", async (t) => {
  const secret = "stdio-server-secret";
  const child = startMcp({
    TOGGL_TRACK_API_KEY: secret,
    TOGGL_TRACK_API_MODE: "track-v9",
    TOGGL_TRACK_ORGANIZATION_ID: "10",
    TOGGL_TRACK_WORKSPACE_ID: "20",
  });
  t.after(() => stopMcp(child));
  const protocol = createProtocolClient(child);

  const initialized = await protocol.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  });
  assert.equal(initialized.serverInfo.name, "toggl-track");

  const listed = await protocol.request("tools/list", {});
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    [
      "toggl_track_get_config",
      "toggl_track_list_projects",
      "toggl_track_get_project",
      "toggl_track_list_tags",
      "toggl_track_create_tag",
      "toggl_track_update_tag",
      "toggl_track_delete_tag",
      "toggl_track_list_time_entries",
      "toggl_track_get_time_entry",
      "toggl_track_create_time_entry",
      "toggl_track_update_time_entry",
      "toggl_track_update_time_entry_tags",
      "toggl_track_update_time_entries_tags",
      "toggl_track_archive_time_entry",
      "toggl_track_restore_time_entry",
    ],
  );

  const config = await protocol.request("tools/call", {
    name: "toggl_track_get_config",
    arguments: {},
  });
  const serialized = JSON.stringify(config);
  assert.equal(serialized.includes(secret), false);
  assert.equal(JSON.parse(config.content[0].text).hasApiKey, true);
});

test("Track v9 requests use token basic authentication and the configured workspace", async (t) => {
  const received = [];
  const upstream = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([{ id: 7, name: "Education" }]));
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));

  const token = "test-token";
  const child = startMcp({
    TOGGL_TRACK_API_KEY: token,
    TOGGL_TRACK_API_MODE: "track-v9",
    TOGGL_TRACK_BASE_URL: `http://127.0.0.1:${upstream.address().port}/api/v9`,
    TOGGL_TRACK_WORKSPACE_ID: "20",
  });
  t.after(() => stopMcp(child));
  const protocol = createProtocolClient(child);

  const result = await protocol.request("tools/call", {
    name: "toggl_track_list_projects",
    arguments: { archived: false },
  });

  assert.equal(result.isError, undefined);
  assert.equal(received[0].url, "/api/v9/workspaces/20/projects?active=true");
  assert.equal(
    received[0].authorization,
    `Basic ${Buffer.from(`${token}:api_token`, "utf8").toString("base64")}`,
  );

  const updated = await protocol.request("tools/call", {
    name: "toggl_track_update_time_entry",
    arguments: { time_entry_id: 42, description: "Architecture review" },
  });
  assert.equal(updated.isError, undefined);
  assert.equal(received[1].method, "PUT");
  assert.equal(received[1].url, "/api/v9/workspaces/20/time_entries/42");
  assert.deepEqual(JSON.parse(received[1].body), {
    description: "Architecture review",
    workspace_id: 20,
  });
});

function startMcp(environment) {
  return spawn(process.execPath, [serverPath], {
    cwd: projectDirectory,
    env: { ...process.env, ...environment },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function stopMcp(child) {
  child.stdin.end();
  child.kill();
}

function createProtocolClient(child) {
  let nextId = 1;
  let buffer = "";
  let stderr = "";
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    }
  });

  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}. ${stderr}`));
        }, 5_000);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timeout); resolve(value); },
          reject: (error) => { clearTimeout(timeout); reject(error); },
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
  };
}
