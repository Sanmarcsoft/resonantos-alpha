import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { startMcpServer, type McpServerHandle } from "../src/mcp-server";

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
  mcpPort = 19201; // test port for MCP server
  mcpHandle = await startMcpServer({
    port: mcpPort,
    gatewayUrl: `ws://127.0.0.1:${gatewayPort}`,
    gatewayToken: "test-token",
    voiceProxyUrl: "http://127.0.0.1:19999", // non-existent, voice is non-fatal
  });
});

afterAll(async () => {
  await mcpHandle.stop();
  await new Promise<void>((resolve) => mockGateway.close(() => resolve()));
});

describe("MCP Server", () => {
  test("responds to MCP initialize", async () => {
    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBeDefined();
    expect(body.result.serverInfo.name).toBe("zorin-adapter");
  });

  test("lists tools via MCP tools/list", async () => {
    const initRes = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
      }),
    });
    const sessionId = initRes.headers.get("mcp-session-id");

    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools).toBeArray();
    const names = body.result.tools.map((t: any) => t.name);
    expect(names).toContain("send_task");
    expect(names).toContain("respond");
  });

  test("executes send_task and returns result", async () => {
    const initRes = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
      }),
    });
    const sessionId = initRes.headers.get("mcp-session-id");

    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "send_task",
          arguments: { message: "What is the meaning of life?" },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBeDefined();
    expect(body.result.content).toBeArray();
    expect(body.result.content[0].text).toContain("Zorin processed");
  });
});
