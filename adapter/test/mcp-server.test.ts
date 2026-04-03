import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { startMcpServer, type McpServerHandle } from "../src/mcp-server";

const TEST_AUTH_TOKEN = "test-secret-token-32chars-long!!";

// Mock OpenClaw gateway
let mockGateway: WebSocketServer;
let gatewayPort: number;

function startMockGateway(): Promise<number> {
  return new Promise((resolve) => {
    mockGateway = new WebSocketServer({ port: 0 });
    mockGateway.on("connection", (ws) => {
      ws.send(JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "test" },
      }));

      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === "connect") {
          ws.send(JSON.stringify({
            type: "res", id: msg.id, ok: true,
            payload: { protocol: 3, server: { version: "1.0" }, features: {} },
          }));
        }
        if (msg.method === "agent") {
          ws.send(JSON.stringify({
            type: "res", id: msg.id, ok: true,
            payload: {
              accepted: true,
              runId: "run-1",
              response: `Zorin processed: ${msg.params.message}`,
            },
          }));
        }
      });
    });
    const addr = mockGateway.address();
    if (typeof addr === "object" && addr) resolve(addr.port);
  });
}

let mcpHandle: McpServerHandle;
let mcpPort: number;

beforeAll(async () => {
  gatewayPort = await startMockGateway();
  mcpPort = 19201;
  mcpHandle = await startMcpServer({
    port: mcpPort,
    bindAddress: "127.0.0.1",
    gatewayUrl: `ws://127.0.0.1:${gatewayPort}`,
    gatewayToken: "test-token",
    voiceProxyUrl: "http://127.0.0.1:19999",
    authToken: TEST_AUTH_TOKEN,
  });
});

afterAll(async () => {
  await mcpHandle.stop();
  await new Promise<void>((resolve) => mockGateway.close(() => resolve()));
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
    expect(res.status).toBe(200);
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
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.result.tools.map((t: any) => t.name);
    expect(names).toContain("send_task");
    expect(names).toContain("respond");
  });

  test("executes send_task and returns result", async () => {
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
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "send_task", arguments: { message: "What is the meaning of life?" } },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.content[0].text).toContain("Zorin processed");
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
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("maximum length");
  });

  test("returns parse error for malformed JSON", async () => {
    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: { ...authHeaders },
      body: "not-json{{{",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });
});
