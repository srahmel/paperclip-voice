import { clampSpeechEnergy } from './voice-state.mjs';

/** Owns reply output only. Never reads the microphone analyser or starts capture. */
export function createReplyPlayback({ audioContext, isActive, onPhase, onEnergy, schedule = setInterval, cancel = clearInterval }) {
  let generation = 0;
  let cleanup = null;

  function stop() {
    generation += 1; // Also invalidates decode/resume promises which have no source yet.
    cleanup?.();
    cleanup = null;
    onEnergy(0);
  }

  async function play(bytes) {
    stop();
    const ticket = generation;
    const current = () => ticket === generation && isActive();
    if (!current() || !bytes.byteLength) return;
    const decoded = await audioContext.decodeAudioData(bytes);
    if (!current()) return;
    await audioContext.resume();
    if (!current()) return;

    await new Promise((resolve, reject) => {
      const source = audioContext.createBufferSource();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      const samples = new Float32Array(analyser.fftSize);
      let timer;
      let finished = false;
      const finish = (cause) => {
        if (finished) return;
        finished = true;
        if (timer !== undefined) cancel(timer);
        audioContext.removeEventListener('statechange', stateChanged);
        source.onended = null;
        try { source.stop(); } catch { /* Already ended or never started. */ }
        source.disconnect();
        analyser.disconnect();
        if (cleanup === finish) cleanup = null;
        if (ticket === generation) {
          onEnergy(0);
          if (isActive()) onPhase('ready');
        }
        if (cause) reject(cause);
        else resolve();
      };
      const stateChanged = () => {
        if (finished) return;
        if (!current()) { finish(); return; }
        if (audioContext.state === 'closed') { finish(new Error('Reply audio context closed')); return; }
        onEnergy(0);
        onPhase(audioContext.state === 'running' ? 'speaking' : 'waiting');
      };
      cleanup = finish;
      source.onended = () => finish();
      try {
        source.buffer = decoded;
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        audioContext.addEventListener('statechange', stateChanged);
        source.start();
        onPhase(audioContext.state === 'running' ? 'speaking' : 'waiting');
        timer = schedule(() => {
          if (finished) return;
          if (!current()) { finish(); return; }
          if (audioContext.state !== 'running') { onEnergy(0); return; }
          try {
            analyser.getFloatTimeDomainData(samples);
            let sum = 0;
            for (const sample of samples) sum += sample * sample;
            // Bounded visual envelope, not a calibrated loudness or phoneme signal.
            onEnergy(clampSpeechEnergy(Math.sqrt(sum / samples.length) * 4));
          } catch (cause) { finish(cause); }
        }, 50);
      } catch (cause) {
        finish(cause);
      }
    });
  }

  return { play, stop };
}
