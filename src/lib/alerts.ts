// Audio + vibration alerts. Generates beeps with WebAudio (no asset deps).
let ctx: AudioContext | null = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
}

export function beep(freq = 880, durationMs = 200, volume = 0.25) {
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = freq;
    osc.type = "square";
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
    }, durationMs);
  } catch (_) {
    /* ignore */
  }
}

export function alertPattern(level: "caution" | "danger" | "critical") {
  if (level === "caution") {
    beep(660, 150);
    navigator.vibrate?.(120);
  } else if (level === "danger") {
    beep(880, 180);
    setTimeout(() => beep(880, 180), 220);
    navigator.vibrate?.([150, 80, 150]);
  } else {
    beep(1100, 220);
    setTimeout(() => beep(1100, 220), 260);
    setTimeout(() => beep(1100, 350), 520);
    navigator.vibrate?.([200, 80, 200, 80, 400]);
  }
}
