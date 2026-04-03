export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface McpAdapterOptions {
  gatewayUrl: string;
  gatewayToken: string;
  voiceProxyUrl: string;
}

export class McpAdapter {
  private opts: McpAdapterOptions;

  constructor(opts: McpAdapterOptions) {
    this.opts = opts;
  }

  listTools(): McpTool[] {
    return [
      {
        name: "send_task",
        description: "Send a task to the OpenClaw agent for processing",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "The task message to send to the OpenClaw agent",
            },
            speak: {
              type: "boolean",
              description: "Whether to speak the response via code:talker",
            },
          },
          required: ["message"],
        },
      },
      {
        name: "respond",
        description: "Generate a response from the OpenClaw agent to a peer message",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "The message to respond to",
            },
          },
          required: ["message"],
        },
      },
    ];
  }
}
