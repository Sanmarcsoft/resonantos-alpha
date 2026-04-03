import { execSync } from "child_process";

export interface GatewayClientOptions {
  url: string;
  token: string;
  requestTimeoutMs?: number;
  onClose?: () => void;
}

export class GatewayClient {
  private connected = false;
  private opts: GatewayClientOptions;
  private timeoutMs: number;

  constructor(opts: GatewayClientOptions) {
    this.opts = opts;
    this.timeoutMs = opts.requestTimeoutMs ?? 120_000;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    // Verify the gateway is reachable via health check
    try {
      const gwHost = this.opts.url.replace("ws://", "http://").replace("wss://", "https://");
      const res = await fetch(`${gwHost}/health`, { signal: AbortSignal.timeout(5000) });
      const body = await res.json() as any;
      if (body.ok) {
        this.connected = true;
        return;
      }
      throw new Error(`Gateway health check failed: ${JSON.stringify(body)}`);
    } catch (err: any) {
      throw new Error(err.message ?? "Gateway unreachable");
    }
  }

  sendTask(message: string): Promise<any> {
    if (!this.connected) {
      return Promise.reject(new Error("Not connected"));
    }

    // Use the openclaw CLI which handles auth/scope internally
    // Falls back to embedded mode (direct LLM call) if gateway agent method is restricted
    try {
      const env = {
        ...process.env,
        OPENCLAW_GATEWAY_URL: this.opts.url.replace("ws://", "http://").replace("wss://", "https://"),
        OPENCLAW_GATEWAY_TOKEN: this.opts.token,
      };

      const escaped = message.replace(/'/g, "'\\''");
      const cmd = `openclaw agent --agent main --message '${escaped}' --json 2>/dev/null`;
      const output = execSync(cmd, {
        timeout: this.timeoutMs,
        env,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      });

      // Parse the JSON output — openclaw agent --json returns a JSON object
      const lines = output.trim().split("\n");
      // Find the last JSON object in the output (may have warnings before it)
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith("{") || line.startsWith("[")) {
          try {
            const parsed = JSON.parse(lines.slice(i).join("\n"));
            // Extract the response text from the agent output
            const response = parsed?.result?.output?.content
              ?? parsed?.result?.response
              ?? parsed?.output
              ?? parsed?.response
              ?? JSON.stringify(parsed);
            return Promise.resolve({ response });
          } catch { continue; }
        }
      }

      // If no JSON found, return raw output as the response
      return Promise.resolve({ response: output.trim() });
    } catch (err: any) {
      if (err.message?.includes("timeout")) {
        return Promise.reject(new Error("Request timeout"));
      }
      // Try to extract useful output even from error
      if (err.stdout) {
        return Promise.resolve({ response: err.stdout.toString().trim() });
      }
      return Promise.reject(new Error(err.message ?? "CLI execution failed"));
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
