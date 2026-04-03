import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startMcpServer, type McpServerHandle } from "../src/mcp-server";

const TEST_AUTH_TOKEN = "test-secret-token-32chars-long!!";

// Mock health endpoint for the gateway
let healthServer: ReturnType<typeof Bun.serve>;
let healthPort: number;

let mcpHandle: McpServerHandle;
let mcpPort: number;

beforeAll(async () => {
  healthPort = 18882;
  healthServer = Bun.serve({
    port: healthPort,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") return Response.json({ ok: true, status: "live" });
      return new Response("Not found", { status: 404 });
    },
  });

  mcpPort = 19202;
  mcpHandle = await startMcpServer({
    port: mcpPort,
    bindAddress: "127.0.0.1",
    gatewayUrl: `ws://127.0.0.1:${healthPort}`,
    gatewayToken: "test-token",
    voiceProxyUrl: "http://127.0.0.1:19999",
    authToken: TEST_AUTH_TOKEN,
  });
});

afterAll(async () => {
  await mcpHandle.stop();
  healthServer.stop(true);
});

const authHeaders = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${TEST_AUTH_TOKEN}`,
};

describe("MCP Server", () => {
  test("rejects requests without auth token", async () => {
    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
      }),
    });
    expect(res.status).toBe(401);
  });

  test("rejects requests with wrong auth token", async () => {
    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer wrong-token" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
      }),
    });
    expect(res.status).toBe(401);
  });

  test("responds to MCP initialize with valid auth", async () => {
    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("zorin-adapter");
  });

  test("rejects tools/list without valid session", async () => {
    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("session");
  });

  test("lists tools with valid session", async () => {
    const initRes = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
      }),
    });
    const sessionId = initRes.headers.get("mcp-session-id");

    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: { ...authHeaders, "mcp-session-id": sessionId! },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const body = await res.json();
    const names = body.result.tools.map((t: any) => t.name);
    expect(names).toContain("send_task");
    expect(names).toContain("respond");
  });

  test("rejects oversized messages", async () => {
    const initRes = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
      }),
    });
    const sessionId = initRes.headers.get("mcp-session-id");

    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: { ...authHeaders, "mcp-session-id": sessionId! },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 4, method: "tools/call",
        params: { name: "send_task", arguments: { message: "x".repeat(33_000) } },
      }),
    });
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("maximum length");
  });

  test("returns parse error for malformed JSON", async () => {
    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: authHeaders,
      body: "not-json{{{",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });
});
