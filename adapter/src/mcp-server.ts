import { randomUUID } from "crypto";
import { GatewayClient } from "./gateway-client";
import { VoiceSpeaker } from "./voice-speaker";
import { McpAdapter } from "./mcp-adapter";

export interface McpServerOptions {
  port: number;
  gatewayUrl: string;
  gatewayToken: string;
  voiceProxyUrl: string;
}

export interface McpServerHandle {
  stop: () => Promise<void>;
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
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/mcp" || req.method !== "POST") {
        return new Response("Not Found", { status: 404 });
      }

      const body = await req.json();
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
          try {
            const result = await gateway.sendTask(args.message ?? "");
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
            return Response.json({
              jsonrpc: "2.0",
              id,
              error: { code: -32000, message: err.message },
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
