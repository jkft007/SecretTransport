import { buildPart, MAX_PARTS, parseFrame, parsePacket, PART_OVERHEAD, type Part } from './packet';

/**
 * Returns [packet] when it fits in one frame, otherwise equal-sized numbered part frames.
 * `maxFrame` is the most bytes a single image can carry.
 */
export function splitPacket(packet: Uint8Array, maxFrame: number): Uint8Array[] {
  if (packet.length <= maxFrame) return [packet];
  const room = maxFrame - PART_OVERHEAD;
  if (room < 16) throw new Error('This image style is too small to split into parts.');
  const n = Math.ceil(packet.length / room);
  if (n > MAX_PARTS) {
    throw new Error(`That would need ${n} images; the most is ${MAX_PARTS}. Choose a style that holds more per image (like a lossless photo) or a smaller file.`);
  }
  const setId = crypto.getRandomValues(new Uint8Array(6));
  const size = Math.ceil(packet.length / n);
  return Array.from({ length: n }, (_, i) => buildPart(setId, i, n, packet.subarray(i * size, (i + 1) * size)));
}

export type Assembly =
  | { state: 'none' }
  | { state: 'single'; packet: Uint8Array }
  | { state: 'complete'; packet: Uint8Array; total: number }
  | { state: 'incomplete'; have: number; total: number; missing: number[] }
  | { state: 'corrupt' };

/** Combines decoded frames (in the order they were added) into a packet, or says what is missing. */
export function assemble(frames: Uint8Array[]): Assembly {
  const parts: Part[] = [];
  let lastPacket: Uint8Array | undefined;
  for (const f of frames) {
    try {
      const r = parseFrame(f);
      if (r.kind === 'part') parts.push(r.part);
      else lastPacket = f;
    } catch {
      /* unreadable frame */
    }
  }
  if (parts.length) {
    const target = parts[parts.length - 1]; // the set the user was most recently working on
    const byIndex = new Map<number, Part>();
    for (const p of parts) if (p.setId === target.setId && p.total === target.total) byIndex.set(p.index, p);
    if (byIndex.size === target.total) {
      const chunks = Array.from({ length: target.total }, (_, i) => byIndex.get(i)!.chunk);
      const packet = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
      let o = 0;
      for (const c of chunks) {
        packet.set(c, o);
        o += c.length;
      }
      try {
        parsePacket(packet);
        return { state: 'complete', packet, total: target.total };
      } catch {
        return { state: 'corrupt' };
      }
    }
    if (!lastPacket) {
      const missing = Array.from({ length: target.total }, (_, i) => i).filter((i) => !byIndex.has(i));
      return { state: 'incomplete', have: byIndex.size, total: target.total, missing };
    }
  }
  return lastPacket ? { state: 'single', packet: lastPacket } : { state: 'none' };
}
