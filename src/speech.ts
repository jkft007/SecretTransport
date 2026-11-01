// Reading the revealed text aloud, with the browser's own speech synthesis. Only voices that run on this device are offered:
// some browsers' "online" voices send the text to a server to be spoken, and a secret must never go anywhere.

/** The voices that speak on this device (not through an online service). */
export function onlyLocal<T extends { localService: boolean }>(voices: readonly T[]): T[] {
  return voices.filter((v) => v.localService);
}

/** Breaks text into pieces short enough for every browser to speak reliably (long utterances can stop part way). */
export function speechChunks(text: string, max = 200): string[] {
  const out: string[] = [];
  for (const part of text.replace(/\r/g, '').split(/(?<=[.!?:;])\s+|\n+/)) {
    let rest = part.trim();
    while (rest.length > max) {
      let cut = rest.lastIndexOf(' ', max);
      if (cut < max / 2) cut = max;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

export const speechAvailable = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** The on-device voices, once the browser has loaded them (some load a moment after the page). */
export function localVoices(): SpeechSynthesisVoice[] {
  return speechAvailable() ? onlyLocal(speechSynthesis.getVoices()) : [];
}

export function stopSpeaking() {
  if (speechAvailable()) speechSynthesis.cancel();
}

/** Speaks `text` with an on-device voice; `onEnd` runs when it finishes or is stopped. */
export function speak(text: string, voice: SpeechSynthesisVoice | undefined, onEnd: () => void) {
  if (!speechAvailable()) return onEnd();
  stopSpeaking();
  const parts = speechChunks(text);
  if (!parts.length) return onEnd();
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = 0.95;
    if (i === parts.length - 1) {
      u.onend = onEnd;
      u.onerror = onEnd;
    }
    speechSynthesis.speak(u);
  });
}
