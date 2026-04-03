const VOICE_COLORS: Record<string, string> = {
  zorin: "red",
  q: "cyan",
  "007": "yellow",
  moneypenny: "green",
};

export interface VoiceSpeakerOptions {
  proxyUrl: string;
  voiceId: string;
}

export class VoiceSpeaker {
  private proxyUrl: string;
  private voiceId: string;
  private color: string;

  constructor(opts: VoiceSpeakerOptions) {
    this.proxyUrl = opts.proxyUrl;
    this.voiceId = opts.voiceId;
    this.color = VOICE_COLORS[opts.voiceId] ?? "white";
  }

  async speak(text: string): Promise<void> {
    if (!text || !text.trim()) return;

    try {
      await fetch(`${this.proxyUrl}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          voice_id: this.voiceId,
          color: this.color,
          voice_enabled: true,
        }),
      });
    } catch {
      // Voice failures are non-fatal — log but don't throw
    }
  }
}
