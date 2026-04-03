import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { VoiceSpeaker } from "../src/voice-speaker";

// Mock HTTP server for voice proxy
let server: ReturnType<typeof Bun.serve> | null = null;
let lastRequest: { body: any; path: string } | null = null;

function startMockVoiceProxy(port: number): void {
  server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/notify" && req.method === "POST") {
        return req.json().then((body) => {
          lastRequest = { body, path: url.pathname };
          return Response.json({
            status: "success",
            voice: body.voice_id,
            duration_ms: 2500,
            queue_position: 0,
          });
        });
      }
      if (url.pathname === "/health") {
        return Response.json({ status: "ok" });
      }
      return new Response("Not found", { status: 404 });
    },
  });
}

beforeEach(() => {
  lastRequest = null;
});

afterEach(() => {
  if (server) {
    server.stop(true);
    server = null;
  }
});

describe("VoiceSpeaker", () => {
  test("speaks text via voice proxy with zorin voice", async () => {
    const proxyPort = 18991;
    startMockVoiceProxy(proxyPort);

    const speaker = new VoiceSpeaker({
      proxyUrl: `http://127.0.0.1:${proxyPort}`,
      voiceId: "zorin",
    });

    await speaker.speak("The answer is 4.");

    expect(lastRequest).not.toBeNull();
    expect(lastRequest!.body.message).toBe("The answer is 4.");
    expect(lastRequest!.body.voice_id).toBe("zorin");
    expect(lastRequest!.body.voice_enabled).toBe(true);
  });

  test("uses correct color for zorin voice", async () => {
    const proxyPort = 18992;
    startMockVoiceProxy(proxyPort);

    const speaker = new VoiceSpeaker({
      proxyUrl: `http://127.0.0.1:${proxyPort}`,
      voiceId: "zorin",
    });

    await speaker.speak("Status update.");

    expect(lastRequest!.body.color).toBe("red");
  });

  test("does not speak empty messages", async () => {
    const proxyPort = 18993;
    startMockVoiceProxy(proxyPort);

    const speaker = new VoiceSpeaker({
      proxyUrl: `http://127.0.0.1:${proxyPort}`,
      voiceId: "zorin",
    });

    await speaker.speak("");
    await speaker.speak("   ");

    expect(lastRequest).toBeNull();
  });

  test("handles voice proxy being unavailable gracefully", async () => {
    const speaker = new VoiceSpeaker({
      proxyUrl: "http://127.0.0.1:19999", // nothing listening
      voiceId: "zorin",
    });

    // Should not throw — voice failures are non-fatal
    await speaker.speak("This will fail silently.");
  });
});
