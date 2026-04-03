import { startMcpServer } from "./mcp-server";

const PORT = parseInt(process.env.ZORIN_ADAPTER_PORT ?? "3103", 10);
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? "openclaw3";
const VOICE_PROXY_URL = process.env.VOICE_PROXY_URL ?? "http://10.0.0.96:8888";

async function main() {
  console.log(`[zorin-adapter] Starting MCP-to-OpenClaw adapter...`);
  console.log(`[zorin-adapter]   Gateway: ${GATEWAY_URL}`);
  console.log(`[zorin-adapter]   Voice:   ${VOICE_PROXY_URL}`);
  console.log(`[zorin-adapter]   Port:    ${PORT}`);

  try {
    const handle = await startMcpServer({
      port: PORT,
      gatewayUrl: GATEWAY_URL,
      gatewayToken: GATEWAY_TOKEN,
      voiceProxyUrl: VOICE_PROXY_URL,
    });

    console.log(`[zorin-adapter] Listening on http://0.0.0.0:${PORT}/mcp`);

    process.on("SIGTERM", async () => {
      console.log("[zorin-adapter] SIGTERM received, shutting down...");
      await handle.stop();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log("[zorin-adapter] SIGINT received, shutting down...");
      await handle.stop();
      process.exit(0);
    });
  } catch (err) {
    console.error("[zorin-adapter] Failed to start:", err);
    process.exit(1);
  }
}

main();
