import { startMcpServer } from "./mcp-server";

const PORT = parseInt(process.env.ZORIN_ADAPTER_PORT ?? "3103", 10);
const BIND_ADDRESS = process.env.ZORIN_ADAPTER_BIND ?? "127.0.0.1";
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
const VOICE_PROXY_URL = process.env.VOICE_PROXY_URL ?? "http://10.0.0.96:8888";
const AUTH_TOKEN = process.env.ZORIN_ADAPTER_AUTH_TOKEN ?? "";

// Validate voice proxy URL
try {
  const u = new URL(VOICE_PROXY_URL);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Voice proxy URL must use http or https");
  }
} catch (e: any) {
  console.error(`[zorin-adapter] Invalid VOICE_PROXY_URL: ${e.message}`);
  process.exit(1);
}

if (!GATEWAY_TOKEN) {
  console.error("[zorin-adapter] OPENCLAW_GATEWAY_TOKEN is required");
  process.exit(1);
}

async function main() {
  console.log(`[zorin-adapter] Starting MCP-to-OpenClaw adapter...`);
  console.log(`[zorin-adapter]   Gateway: ${GATEWAY_URL}`);
  console.log(`[zorin-adapter]   Voice:   ${VOICE_PROXY_URL}`);
  console.log(`[zorin-adapter]   Bind:    ${BIND_ADDRESS}:${PORT}`);
  console.log(`[zorin-adapter]   Auth:    ${AUTH_TOKEN ? "enabled" : "DISABLED (WARNING)"}`);

  try {
    const handle = await startMcpServer({
      port: PORT,
      bindAddress: BIND_ADDRESS,
      gatewayUrl: GATEWAY_URL,
      gatewayToken: GATEWAY_TOKEN,
      voiceProxyUrl: VOICE_PROXY_URL,
      authToken: AUTH_TOKEN || undefined,
    });

    console.log(`[zorin-adapter] Listening on http://${BIND_ADDRESS}:${PORT}/mcp`);

    const shutdown = async () => {
      console.log("[zorin-adapter] Shutting down...");
      await handle.stop();
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (err) {
    console.error("[zorin-adapter] Failed to start:", err);
    process.exit(1);
  }
}

main();
