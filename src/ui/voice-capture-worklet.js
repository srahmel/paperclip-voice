/* Convert the browser's microphone stream to mono 16 kHz PCM. */
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  frame = new Int16Array(1600);
  offset = 0;
  phase = 0;
  sum = 0;
  count = 0;
  power = 0;

  process(inputs) {
    for (const sample of inputs[0]?.[0] ?? []) {
      this.sum += sample;
      this.count++;
      this.phase += 16_000;
      if (this.phase < sampleRate) continue;
      const value = this.sum / this.count;
      this.power += value * value;
      this.frame[this.offset++] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
      this.phase %= sampleRate;
      this.sum = 0;
      this.count = 0;
      if (this.offset !== this.frame.length) continue;
      const data = this.frame.buffer;
      this.port.postMessage({ data, rms: Math.sqrt(this.power / this.frame.length) }, [data]);
      this.frame = new Int16Array(1600);
      this.offset = 0;
      this.power = 0;
    }
    return true;
  }
}

registerProcessor('paperclip-voice-capture', VoiceCaptureProcessor);
