import { randomUUID, timingSafeEqual } from "crypto";
import { GatewayClient } from "./gateway-client";
import { VoiceSpeaker } from "./voice-speaker";
import { McpAdapter } from "./mcp-adapter";

const MAX_MESSAGE_LEN = 32_000;

export interface McpServerOptions {
  port: number;
  bindAddress?: string;
  gatewayUrl: string;
  gatewayToken: string;
  voiceProxyUrl: string;
  authToken?: string;
}

export interface McpServerHandle {
  stop: () => Promise<void>;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function startMcpServer(opts: McpServerOptions): Promise<McpServerHandle> {
  const gateway = new GatewayClient({ url: opts.gatewayUrl, token: opts.gatewayToken });
  const voice = new VoiceSpeaker({ proxyUrl: opts.voiceProxyUrl, voiceId: "zorin" });
  const adapter = new McpAdapter({
    gatewayUrl: opts.gatewayUrl,
    gatewayToken: opts.gatewayToken,
    voiceProxyUrl: opts.voiceProxyUrl,
  });

  await gateway.connect();

  const sessions = new Map<string, true>();

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.bindAddress ?? "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({ ok: true, agent: "zorin", connected: gateway.isConnected() });
      }
      if (url.pathname !== "/mcp" || req.method !== "POST") {
        return new Response("Not Found", { status: 404 });
      }

      // Auth guard
      if (opts.authToken) {
        const auth = req.headers.get("Authorization") ?? "";
        const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!provided || !constantTimeEqual(provided, opts.authToken)) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      let body: any;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
          { status: 400 }
        );
      }

      const { method, id, params } = body;

      if (method === "initialize") {
        const sessionId = randomUUID();
        sessions.set(sessionId, true);
        return Response.json(
          {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "zorin-adapter", version: "1.0.0" },
            },
          },
          { headers: { "mcp-session-id": sessionId } }
        );
      }

      // Session validation for all non-initialize methods
      const sessionId = req.headers.get("mcp-session-id");
      if (!sessionId || !sessions.has(sessionId)) {
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32600, message: "Invalid or missing session" },
        });
      }

      if (method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id,
          result: { tools: adapter.listTools() },
        });
      }

      if (method === "tools/call") {
        const toolName = params?.name;
        const args = params?.arguments ?? {};

        if (toolName === "send_task" || toolName === "respond") {
          const rawMessage = args.message ?? "";
          if (rawMessage.length > MAX_MESSAGE_LEN) {
            return Response.json({
              jsonrpc: "2.0",
              id,
              error: { code: -32602, message: `Message exceeds maximum length of ${MAX_MESSAGE_LEN} characters` },
            });
          }

          try {
            const result = await gateway.sendTask(rawMessage);
            const responseText = result.response ?? JSON.stringify(result);

            // Multiplex: speak summary via voice, return full data
            if (args.speak !== false) {
              const summary = responseText.length > 200
                ? responseText.substring(0, 197) + "..."
                : responseText;
              await voice.speak(summary);
            }

            return Response.json({
              jsonrpc: "2.0",
              id,
              result: {
                content: [{ type: "text", text: responseText }],
              },
            });
          } catch (err: any) {
            console.error("[zorin-adapter] Tool call error:", err);
            const userMessage = err.message?.includes("timeout")
              ? "Request timed out"
              : "Internal error";
            return Response.json({
              jsonrpc: "2.0",
              id,
              error: { code: -32000, message: userMessage },
            });
          }
        }

        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        });
      }

      return Response.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown method: ${method}` },
      });
    },
  });

  return {
    stop: async () => {
      server.stop(true);
      await gateway.disconnect();
    },
  };
}
