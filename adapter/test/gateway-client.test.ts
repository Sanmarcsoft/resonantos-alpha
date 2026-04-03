import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { GatewayClient } from "../src/gateway-client";

// Spin up a minimal mock gateway for integration testing
let wss: WebSocketServer;
let port: number;

function startMockGateway(handler: (ws: WsSocket) => void): Promise<number> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0 });
    wss.on("connection", handler);
    const addr = wss.address();
    if (typeof addr === "object" && addr) resolve(addr.port);
  });
}

function stopMockGateway(): Promise<void> {
  return new Promise((resolve) => {
    if (wss) wss.close(() => resolve());
    else resolve();
  });
}

afterEach(async () => {
  await stopMockGateway();
});

// ─── RED: GatewayClient connects and authenticates ─────────────────────

describe("GatewayClient", () => {
  test("connects to gateway and completes challenge-response auth", async () => {
    let receivedConnect = false;

    port = await startMockGateway((ws) => {
      // Server sends challenge
      ws.send(JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "test-nonce-123" },
      }));

      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "req" && msg.method === "connect") {
          receivedConnect = true;
          // Verify auth token was sent
          expect(msg.params.auth.token).toBe("test-token");
          expect(msg.params.minProtocol).toBe(3);
          expect(msg.params.maxProtocol).toBe(3);
          expect(msg.params.role).toBe("operator");

          // Send hello-ok
          ws.send(JSON.stringify({
            type: "res",
            id: msg.id,
            ok: true,
            payload: {
              protocol: 3,
              server: { version: "2026.3.14", connId: "test-conn" },
              features: { methods: [], events: [] },
            },
          }));
        }
      });
    });

    const client = new GatewayClient({
      url: `ws://127.0.0.1:${port}`,
      token: "test-token",
    });

    await client.connect();
    expect(receivedConnect).toBe(true);
    expect(client.isConnected()).toBe(true);
    await client.disconnect();
  });

  test("sends agent task and receives response", async () => {
    port = await startMockGateway((ws) => {
      ws.send(JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "nonce" },
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
          expect(msg.params.message).toBe("What is 2+2?");
          expect(msg.params.idempotencyKey).toBeDefined();
          // Send response
          ws.send(JSON.stringify({
            type: "res", id: msg.id, ok: true,
            payload: {
              accepted: true,
              runId: "run-123",
              response: "The answer is 4.",
            },
          }));
        }
      });
    });

    const client = new GatewayClient({
      url: `ws://127.0.0.1:${port}`,
      token: "test-token",
    });
    await client.connect();

    const result = await client.sendTask("What is 2+2?");
    expect(result.response).toBe("The answer is 4.");

    await client.disconnect();
  });

  test("rejects when auth fails", async () => {
    port = await startMockGateway((ws) => {
      ws.send(JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "nonce" },
      }));

      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === "connect") {
          ws.send(JSON.stringify({
            type: "res", id: msg.id, ok: false,
            error: { code: "UNAUTHORIZED", message: "Invalid token" },
          }));
        }
      });
    });

    const client = new GatewayClient({
      url: `ws://127.0.0.1:${port}`,
      token: "wrong-token",
    });

    try {
      await client.connect();
      expect(true).toBe(false); // should not reach here
    } catch (err: any) {
      expect(err.message).toBe("Invalid token");
    }
  });
});
