import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { dispatch } from "./server.mjs";

const maxRequestBytes = 1024 * 1024;

export function createMcpHttpServer() {
  return createServer(async (request, response) => {
    if (request.url === "/health" && request.method === "GET") {
      respond(response, 200, { status: "ok" });
      return;
    }

    if (request.url !== "/mcp") {
      respond(response, 404, { error: "Not found" });
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      respond(response, 405, { error: "Method not allowed" });
      return;
    }

    if (!request.headers["content-type"]?.startsWith("application/json")) {
      respond(response, 415, { error: "Expected application/json" });
      return;
    }

    let message;
    try {
      message = JSON.parse(await readBody(request));
    } catch (error) {
      respond(response, error.message === "Request too large" ? 413 : 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Invalid JSON-RPC request" },
      });
      return;
    }

    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      respond(response, 400, {
        jsonrpc: "2.0",
        id: message?.id ?? null,
        error: { code: -32600, message: "Invalid JSON-RPC request" },
      });
      return;
    }

    if (!("id" in message)) {
      response.writeHead(202).end();
      return;
    }

    try {
      const result = await dispatch(message.method, message.params ?? {});
      respond(response, 200, { jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
      respond(response, 200, {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: Number.isInteger(error?.code) ? error.code : -32603,
          message: Number.isInteger(error?.code) ? error.message : "Internal server error",
        },
      });
    }
  });
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxRequestBytes) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function respond(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  createMcpHttpServer().listen(port, "0.0.0.0", () => {
    console.error(`Toggl MCP listening on port ${port}`);
  });
}
