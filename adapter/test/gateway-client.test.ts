import { describe, test, expect, afterEach } from "bun:test";
import { GatewayClient } from "../src/gateway-client";

// Mock HTTP server for health check
let healthServer: ReturnType<typeof Bun.serve> | null = null;

function startMockHealthServer(port: number, healthy: boolean): void {
  healthServer = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json(healthy ? { ok: true, status: "live" } : { ok: false });
      }
      return new Response("Not found", { status: 404 });
    },
  });
}

afterEach(() => {
  if (healthServer) {
    healthServer.stop(true);
    healthServer = null;
  }
});

describe("GatewayClient", () => {
  test("connects when gateway health check passes", async () => {
    const port = 18881;
    startMockHealthServer(port, true);

    const client = new GatewayClient({
      url: `ws://127.0.0.1:${port}`,
      token: "test-token",
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);
    await client.disconnect();
  });

  test("rejects when gateway is unreachable", async () => {
    const client = new GatewayClient({
      url: "ws://127.0.0.1:19999",
      token: "test-token",
    });

    try {
      await client.connect();
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.message).toBeDefined();
    }
  });

  test("rejects sendTask when not connected", async () => {
    const client = new GatewayClient({
      url: "ws://127.0.0.1:19999",
      token: "test-token",
    });

    try {
      await client.sendTask("hello");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.message).toBe("Not connected");
    }
  });
});
