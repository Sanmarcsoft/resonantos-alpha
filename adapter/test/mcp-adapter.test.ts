import { describe, test, expect } from "bun:test";
import { McpAdapter } from "../src/mcp-adapter";

describe("McpAdapter", () => {
  test("lists available tools", () => {
    const adapter = new McpAdapter({
      gatewayUrl: "ws://127.0.0.1:18789",
      gatewayToken: "test",
      voiceProxyUrl: "http://127.0.0.1:8888",
    });

    const tools = adapter.listTools();

    expect(tools).toBeArray();
    expect(tools.length).toBeGreaterThanOrEqual(2);

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("send_task");
    expect(toolNames).toContain("respond");
  });

  test("send_task tool has correct schema", () => {
    const adapter = new McpAdapter({
      gatewayUrl: "ws://127.0.0.1:18789",
      gatewayToken: "test",
      voiceProxyUrl: "http://127.0.0.1:8888",
    });

    const tools = adapter.listTools();
    const sendTask = tools.find((t) => t.name === "send_task");

    expect(sendTask).toBeDefined();
    expect(sendTask!.description).toContain("task");
    expect(sendTask!.inputSchema.properties).toHaveProperty("message");
    expect(sendTask!.inputSchema.required).toContain("message");
  });

  test("respond tool has correct schema", () => {
    const adapter = new McpAdapter({
      gatewayUrl: "ws://127.0.0.1:18789",
      gatewayToken: "test",
      voiceProxyUrl: "http://127.0.0.1:8888",
    });

    const tools = adapter.listTools();
    const respond = tools.find((t) => t.name === "respond");

    expect(respond).toBeDefined();
    expect(respond!.inputSchema.properties).toHaveProperty("message");
  });
});
