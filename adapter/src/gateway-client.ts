import WebSocket from "ws";
import { randomUUID } from "crypto";

export interface GatewayClientOptions {
  url: string;
  token: string;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private connected = false;
  private opts: GatewayClientOptions;
  private requestTimeoutMs: number;

  constructor(opts: GatewayClientOptions) {
    this.opts = opts;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
  }

  isConnected(): boolean {
    return this.connected;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.opts.url);

      this.ws.on("error", (err) => {
        if (!this.connected) reject(err);
      });

      this.ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === "event" && msg.event === "connect.challenge") {
          const id = randomUUID();
          this.ws!.send(JSON.stringify({
            type: "req",
            id,
            method: "connect",
            params: {
              auth: { token: this.opts.token },
              minProtocol: 3,
              maxProtocol: 3,
              role: "operator",
              scopes: ["operator.admin"],
              caps: [],
              client: {
                id: "zorin-adapter",
                mode: "backend",
                version: "1.0.0",
                platform: "linux",
              },
            },
          }));

          // Store pending connect request
          const timer = setTimeout(() => {
            this.ws?.close();
            reject(new Error("Connect timeout"));
          }, this.requestTimeoutMs);
          this.pending.set(id, {
            resolve: () => { this.connected = true; resolve(); },
            reject: (err) => { this.ws?.close(); reject(err); },
            timer,
          });
        }

        if (msg.type === "res") {
          const req = this.pending.get(msg.id);
          if (req) {
            clearTimeout(req.timer);
            this.pending.delete(msg.id);
            if (msg.ok) {
              req.resolve(msg.payload);
            } else {
              req.reject(new Error(msg.error?.message ?? "Request failed"));
            }
          }
        }
      });

      this.ws.on("close", () => {
        this.connected = false;
      });
    });
  }

  sendTask(message: string, agentId?: string): Promise<any> {
    if (!this.ws || !this.connected) {
      return Promise.reject(new Error("Not connected"));
    }

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Request timeout"));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      this.ws!.send(JSON.stringify({
        type: "req",
        id,
        method: "agent",
        params: {
          message,
          agentId: agentId ?? "main",
          idempotencyKey: randomUUID(),
        },
      }));
    });
  }

  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws) {
        this.ws.once("close", () => {
          this.connected = false;
          resolve();
        });
        this.ws.close();
      } else {
        resolve();
      }
    });
  }
}
