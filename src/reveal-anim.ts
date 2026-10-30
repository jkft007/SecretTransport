// Presentational only: a randomly chosen animation (matrix rain, scramble, typewriter, pixelate, iris,
// fireworks, curtain, can, flag) turns the scanned image into the decoded text.
export type RevealStyle = 'matrix' | 'scramble' | 'typewriter' | 'pixelate' | 'iris' | 'fireworks' | 'curtain' | 'can' | 'flag' | 'moon' | 'plane' | 'swarm' | 'bubbles' | 'ufo' | 'spotlight' | 'jackpot' | 'ink' | 'safe' | 'train' | 'oldtype' | 'printer' | 'ticker' | 'radar' | 'film' | 'parade';
export const STYLES: RevealStyle[] = [
  'matrix', 'scramble', 'typewriter', 'pixelate', 'iris', 'fireworks', 'curtain', 'can', 'flag', 'moon', 'plane',
  'swarm', 'bubbles', 'ufo', 'spotlight', 'jackpot', 'ink', 'safe', 'train', 'oldtype', 'printer',
  'ticker', 'radar', 'film', 'parade',
];

// The position in STYLES (plus one) is stored inside encrypted images, so only ever append new styles.
export const styleToId = (s: RevealStyle): number => STYLES.indexOf(s) + 1;
export const idToStyle = (id: number | undefined): RevealStyle | undefined => (id ? STYLES[id - 1] : undefined);

export interface RevealOptions {
  canvas: HTMLCanvasElement;
  source: CanvasImageSource & { width: number; height: number };
  text: string;
  mode: 'codeart' | 'stego';
  reduceMotion: boolean;
  /** Force one style (default: pick one at random). */
  style?: RevealStyle;
}
export interface RevealHandle {
  done: Promise<void>;
  skip(): void;
}

const GLYPHS = 'アイウエオカキクケコサシスセソ0123456789ABCDEF#$%&*+<>?/=ｱｲｳｴｵ';
const BG = '11,15,20';
const FONT = 'ui-monospace, Consolas, monospace';
const rnd = () => Math.random();
const glyph = (seed: number) => GLYPHS[(Math.imul(seed, 2654435761) >>> 7) % GLYPHS.length];

interface Cell {
  ch: string;
  x: number;
  y: number;
  lock: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}

export function playReveal(o: RevealOptions): RevealHandle {
  const { canvas } = o;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(280, rect.width);
  const H = Math.max(180, rect.height);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Lay out the text (word wrap, truncated to what fits on stage).
  const fs = 17;
  const lh = 24;
  const pad = 20;
  ctx.font = `${fs}px ${FONT}`;
  const cw = ctx.measureText('M').width;
  const cols = Math.max(8, Math.floor((W - pad * 2) / cw));
  const maxLines = Math.max(1, Math.floor((H - pad * 2) / lh));
  const lines: string[] = [];
  for (const para of o.text.replace(/\t/g, '  ').split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      let w = Array.from(word);
      while (w.length > cols) {
        if (cur) {
          lines.push(cur);
          cur = '';
        }
        lines.push(w.slice(0, cols).join(''));
        w = w.slice(cols);
      }
      const ww = w.join('');
      if (!cur) cur = ww;
      else if (Array.from(cur).length + 1 + w.length <= cols) cur += ' ' + ww;
      else {
        lines.push(cur);
        cur = ww;
      }
    }
    lines.push(cur);
  }
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = Array.from(shown[maxLines - 1]).slice(0, cols - 1).join('') + '…';
  const cells: Cell[] = [];
  // Centre the block on the stage, each line centred within it.
  const top = Math.max(pad, (H - shown.length * lh) / 2);
  shown.forEach((ln, r) => {
    const chars = Array.from(ln);
    const left = Math.max(pad, (W - chars.length * cw) / 2);
    chars.forEach((ch, c) => cells.push({ ch, x: left + c * cw, y: top + (r + 1) * lh - 7, lock: 0 }));
  });
  const visible = cells.filter((c) => c.ch !== ' ');

  const T_SCAN = 1100;
  const T_RAIN = 700;
  const T_RESOLVE = Math.min(2600, Math.max(900, visible.length * 20));
  const style: RevealStyle = o.style ?? STYLES[Math.floor(rnd() * STYLES.length)];
  canvas.dataset.style = style; // which animation is playing (handy for tests)
  // One character at a time, in reading order, with a pause at each line break (typewriter and printer).
  const perChar = Math.min(80, Math.max(25, 3000 / Math.max(1, visible.length)));
  const typeAt: number[] = [];
  let typeAcc = 0;
  visible.forEach((c, i) => {
    if (i > 0 && visible[i - 1].y !== c.y) typeAcc += 220;
    typeAt.push(typeAcc);
    typeAcc += perChar;
  });
  const T_TYPE = typeAcc;
  const lineYs = [...new Set(visible.map((c) => c.y))]; // one entry per printed line, top to bottom
  const RADAR_REV = 1000; // one sweep of the radar
  const FLIGHT = 500; // how long a letter takes to fall out of the can
  const FALL = 1100; // how long a parachuted word takes to float down
  const SWARM = 700; // how long a speck of dust takes to fly to its letter
  const RISE = 900; // how long a bubble takes to float up to its place
  const WIN = 1000; // the jackpot celebration after the last reel stops
  const INK = 500; // how long invisible ink takes to darken once the flame reaches it
  const STEAM = 900; // how long a letter takes to drift up from the chimney to its place
  const T_INTRO = style === 'matrix' ? T_SCAN + T_RAIN : ['curtain', 'moon', 'swarm', 'bubbles', 'ufo', 'spotlight', 'jackpot', 'ink', 'safe', 'train', 'oldtype', 'printer', 'ticker', 'radar', 'parade'].includes(style) ? 600 : style === 'film' ? 1400 : style === 'can' || style === 'flag' || style === 'plane' ? 800 : 1000;
  const T_RES =
    style === 'iris' ? 1300
    : style === 'fireworks' ? Math.max(T_RESOLVE, 2200)
    : style === 'curtain' ? 1700
    : style === 'flag' ? 1400
    : style === 'moon' ? 2400
    : style === 'plane' ? Math.max(T_RESOLVE, 1400) + FALL + 100
    : style === 'swarm' ? Math.max(T_RESOLVE, 1400) + SWARM + 100
    : style === 'bubbles' ? Math.max(T_RESOLVE, 1400) + RISE + 200
    : style === 'ufo' ? Math.max(T_RESOLVE, 1400) + 400
    : style === 'spotlight' ? 2400
    : style === 'jackpot' ? Math.max(T_RESOLVE, 1400) + WIN
    : style === 'ink' ? Math.max(T_RESOLVE, 1600) + INK + 100
    : style === 'safe' ? 2200
    : style === 'train' ? Math.max(T_RESOLVE, 1400) + STEAM + 100
    : style === 'oldtype' || style === 'printer' ? T_TYPE + 200
    : style === 'ticker' ? 200 * (lineYs.length - 1) + 1100 + 150
    : style === 'radar' ? RADAR_REV + 700
    : style === 'film' ? 1900
    : style === 'parade' ? Math.max(T_RESOLVE, 1400) + 300
    : style === 'can' ? Math.max(T_RESOLVE, 1400) + FLIGHT + 100
    : T_RESOLVE;
  const T_END = T_INTRO + T_RES + 250;
  const spread = style === 'fireworks' ? 0.7 : 0.8;
  const T_LOCK =
    style === 'can' ? T_RES - FLIGHT - 100
    : style === 'swarm' ? T_RES - SWARM - 100
    : style === 'bubbles' ? T_RES - RISE - 200
    : style === 'jackpot' ? T_RES - WIN
    : style === 'ink' ? T_RES - INK - 100
    : style === 'parade' ? T_RES - 300
    : T_RES;
  visible.forEach((c, i) => (c.lock = (i / Math.max(1, visible.length)) * T_LOCK * spread + rnd() * T_LOCK * 0.15));
  const ease = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);

  const drawFinal = () => {
    ctx.fillStyle = `rgb(${BG})`;
    ctx.fillRect(0, 0, W, H);
    ctx.font = `${fs}px ${FONT}`;
    ctx.fillStyle = '#e8fff4';
    ctx.shadowColor = 'rgba(80,255,190,.55)';
    ctx.shadowBlur = 6;
    for (const c of cells) if (c.ch !== ' ') ctx.fillText(c.ch, c.x, c.y);
    ctx.shadowBlur = 0;
  };

  if (o.reduceMotion) {
    drawFinal();
    return { done: Promise.resolve(), skip() {} };
  }

  const sc = Math.min((W - 24) / o.source.width, (H - 24) / o.source.height);
  const iw = o.source.width * sc;
  const ih = o.source.height * sc;
  const ix = (W - iw) / 2;
  const iy = (H - ih) / 2;
  const colW = 16;
  const drops = Array.from({ length: Math.ceil(W / colW) }, () => rnd() * -H);

  let skipped = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  const t0 = performance.now();
  let rainStarted = false;

  const clear = () => {
    ctx.fillStyle = `rgb(${BG})`;
    ctx.fillRect(0, 0, W, H);
  };

  const rain = (fade: number) => {
    if (fade) {
      ctx.fillStyle = `rgba(${BG},${fade})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.font = `14px ${FONT}`;
    drops.forEach((y, i) => {
      ctx.fillStyle = 'rgba(190,255,225,.95)';
      ctx.fillText(glyph(i * 31 + Math.floor(rnd() * 1e6)), i * colW, y);
      drops[i] = y > H + rnd() * 200 ? rnd() * -80 : y + 9 + rnd() * 6;
    });
  };

  /** The image with a sweeping scan line. */
  const drawScan = (p: number, imgAlpha = 1) => {
    clear();
    ctx.globalAlpha = imgAlpha;
    ctx.drawImage(o.source, ix, iy, iw, ih);
    ctx.globalAlpha = 1;
    const sx = ix + iw * p;
    ctx.fillStyle = 'rgba(20,200,170,.22)';
    ctx.fillRect(ix, iy, sx - ix, ih);
    const n = o.mode === 'codeart' ? 90 : 160;
    const sz = o.mode === 'codeart' ? 6 : 1.5;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(190,255,235,${0.15 + rnd() * 0.5})`;
      ctx.fillRect(ix + rnd() * (sx - ix), iy + rnd() * ih, sz, sz);
    }
    const g = ctx.createLinearGradient(sx - 40, 0, sx + 2, 0);
    g.addColorStop(0, 'rgba(60,255,200,0)');
    g.addColorStop(1, 'rgba(120,255,220,.9)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - 40, iy, 42, ih);
  };

  const small = document.createElement('canvas');
  /** The image as coarse blocks (block = source pixels per block). */
  const drawPixels = (block: number, alpha: number) => {
    small.width = Math.max(1, Math.round(iw / block));
    small.height = Math.max(1, Math.round(ih / block));
    small.getContext('2d')!.drawImage(o.source, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha;
    ctx.drawImage(small, ix, iy, iw, ih);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
  };

  /** Draws the text cells `on` accepts; the rest show cycling glyphs when `scramble` is set. */
  const drawCells = (r: number, on: (c: Cell, i: number) => boolean, scramble: boolean, glow = true) => {
    ctx.font = `${fs}px ${FONT}`;
    const bucket = Math.floor(r / 70);
    visible.forEach((c, i) => {
      if (on(c, i)) {
        const fresh = glow && r - c.lock < 160;
        ctx.fillStyle = fresh ? '#7dffe0' : '#e8fff4';
        ctx.shadowColor = 'rgba(80,255,190,.6)';
        ctx.shadowBlur = fresh ? 12 : 5;
        ctx.fillText(c.ch, c.x, c.y);
      } else if (scramble) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(70,220,160,.75)';
        ctx.fillText(glyph(bucket * 977 + i), c.x, c.y);
      }
    });
    ctx.shadowBlur = 0;
  };

  // Fireworks: rockets climb, burst into sparks, and the text lights up as the bursts go off.
  let sparks: Spark[] = [];
  const bursts = Array.from({ length: 6 }, (_, i) => ({
    at: 350 + (i / 6) * T_RES * 0.7 + rnd() * 120,
    x: W * (0.15 + rnd() * 0.7),
    y: H * (0.2 + rnd() * 0.35),
    fired: false,
  }));
  const explode = (x: number, y: number) => {
    const hue = Math.floor(rnd() * 360);
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const v = 1 + rnd() * 3.2;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, hue: hue + rnd() * 40 });
    }
  };
  const drawFireworks = (r: number) => {
    ctx.fillStyle = `rgba(${BG},.28)`;
    ctx.fillRect(0, 0, W, H);
    for (const b of bursts) {
      if (r >= b.at - 350 && r < b.at) {
        const y = H + (b.y - H) * ((r - (b.at - 350)) / 350);
        ctx.fillStyle = '#fff4c0';
        ctx.fillRect(b.x - 1, y, 2, 8);
      } else if (!b.fired && r >= b.at) {
        b.fired = true;
        explode(b.x, b.y);
      }
    }
    sparks = sparks.filter((s) => s.life > 0);
    for (const s of sparks) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.045;
      s.vx *= 0.985;
      s.life -= 0.014;
      ctx.fillStyle = `hsla(${s.hue},100%,65%,${Math.max(0, s.life)})`;
      ctx.fillRect(s.x, s.y, 2.2, 2.2);
    }
    drawCells(r, (c) => r >= c.lock, false);
  };

  // Old typewriter: a sheet feeds in, keys strike one at a time, and the bell dings at the end of a line.
  const fadeToFinal = (r: number) => {
    if (r > T_RES) {
      ctx.globalAlpha = Math.min(1, (r - T_RES) / 250);
      drawFinal();
      ctx.globalAlpha = 1;
    }
  };
  const latest = (r: number) => {
    let last = -1;
    while (last + 1 < visible.length && r >= typeAt[last + 1]) last++;
    return last;
  };
  const drawOldType = (r: number, t: number) => {
    clear();
    const off = r < 0 ? (1 - ease(t / T_INTRO)) * H : 0;
    ctx.save();
    ctx.translate(0, off);
    const pg = ctx.createLinearGradient(0, 0, 0, H);
    pg.addColorStop(0, '#f6eed8');
    pg.addColorStop(1, '#e6dabb');
    ctx.fillStyle = pg;
    ctx.fillRect(0, -4, W, H + 4);
    ctx.font = `${fs}px ${FONT}`;
    const last = latest(r);
    for (let i = 0; i <= last; i++) {
      const c = visible[i];
      const fresh = r - typeAt[i] < 80; // a fresh strike is inked a little off-line
      ctx.fillStyle = 'rgba(25,25,30,.92)';
      ctx.fillText(c.ch, c.x + (fresh ? Math.sin(i * 12.9898) * 1.2 : 0), c.y + (fresh ? 1 : 0));
    }
    ctx.restore();
    const my = H - 46;
    ctx.fillStyle = '#2a2f36';
    ctx.fillRect(0, my, W, 46);
    ctx.fillStyle = '#8a949e';
    ctx.fillRect(0, my, W, 4);
    ctx.fillStyle = '#14171b'; // platen roller
    ctx.fillRect(0, my - 8, W, 10);
    ctx.fillStyle = '#3b434b';
    ctx.fillRect(0, my - 7, W, 2);
    const nKeys = Math.max(6, Math.floor((W - 30) / 26));
    const cur = last >= 0 ? visible[last] : undefined;
    const age = cur ? r - typeAt[last] : 1e9;
    const pressed = cur ? (cur.ch.charCodeAt(0) * 7 + last) % nKeys : -1;
    for (let k = 0; k < nKeys; k++) {
      const kx = 18 + k * ((W - 36) / (nKeys - 1));
      const down = k === pressed && age < 90 ? 2 : 0;
      ctx.fillStyle = down ? '#555' : '#1a1e23';
      ctx.strokeStyle = '#9aa4ae';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(kx, my + 26 + down, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (cur && age < 90) {
      // the type bar swings up from the pressed key to the paper
      const kx = 18 + pressed * ((W - 36) / (nKeys - 1));
      ctx.strokeStyle = '#6b747d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(kx, my + 17);
      ctx.lineTo(cur.x + cw / 2, cur.y - fs / 2);
      ctx.stroke();
    }
    if (cur && age < 350 && (last + 1 >= visible.length || visible[last + 1].y !== cur.y)) {
      ctx.fillStyle = '#c9a227';
      ctx.font = 'italic bold 14px serif';
      ctx.fillText('ding!', W - 56, my - 18);
    }
    fadeToFinal(r);
  };

  // Mechanical printer: greenbar fanfold paper; a print head shuttles along each line and prints it.
  const drawPrinter = (r: number, t: number) => {
    clear();
    const off = r < 0 ? (1 - ease(t / T_INTRO)) * H : 0;
    const holeW = 18;
    ctx.save();
    ctx.translate(0, off);
    ctx.fillStyle = '#f4f6ef';
    ctx.fillRect(0, -4, W, H + 4);
    ctx.fillStyle = '#dcebd5';
    for (let y = 4; y < H; y += lh * 4) ctx.fillRect(holeW, y, W - holeW * 2, lh * 2);
    ctx.fillStyle = '#e6e9df';
    ctx.fillRect(0, -4, holeW, H + 4);
    ctx.fillRect(W - holeW, -4, holeW, H + 4);
    ctx.fillStyle = '#9aa09a';
    for (let y = 8; y < H; y += 16) {
      ctx.beginPath();
      ctx.arc(holeW / 2, y, 3, 0, Math.PI * 2);
      ctx.arc(W - holeW / 2, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.08)';
    ctx.fillRect(holeW, -4, 1, H + 4);
    ctx.fillRect(W - holeW, -4, 1, H + 4);
    ctx.font = `${fs}px ${FONT}`;
    const last = latest(r);
    for (let i = 0; i <= last; i++) {
      const c = visible[i];
      ctx.fillStyle = 'rgba(27,42,58,.95)';
      ctx.fillText(c.ch, c.x, c.y);
      ctx.fillStyle = 'rgba(27,42,58,.45)'; // second pass, as a dot-matrix head would strike
      ctx.fillText(c.ch, c.x + 0.6, c.y);
    }
    ctx.restore();
    // the head rides a rail across the page, and parks at the side when idle
    const cur = last >= 0 ? visible[last] : undefined;
    const nxt = last + 1 < visible.length ? visible[last + 1] : undefined;
    let hx = holeW + 4;
    let hy = (visible[0]?.y ?? H / 2) + off;
    if (cur) {
      const k = nxt ? Math.min(1, (r - typeAt[last]) / (typeAt[last + 1] - typeAt[last])) : 1;
      hx = nxt ? cur.x + (nxt.x - cur.x) * k : W - holeW - 14;
      hy = cur.y + (nxt ? (nxt.y - cur.y) * (k > 0.5 && nxt.y !== cur.y ? 1 : 0) : 0) + off;
    }
    hy += Math.sin(t * 0.9) * 0.8;
    ctx.fillStyle = '#555c64';
    ctx.fillRect(holeW, hy - 22, W - holeW * 2, 4);
    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(hx - 5, hy - 28, 14, 22);
    ctx.fillStyle = '#8a949e';
    ctx.fillRect(hx - 5, hy - 28, 14, 3);
    ctx.fillStyle = '#2b2f36';
    ctx.beginPath();
    ctx.moveTo(hx - 3, hy - 6);
    ctx.lineTo(hx + 7, hy - 6);
    ctx.lineTo(hx + 2, hy + 1);
    ctx.fill();
    if (cur && r - typeAt[last] < perChar) {
      ctx.fillStyle = 'rgba(40,60,90,.7)';
      ctx.fillRect(hx + 1, hy + 1, 2, 2);
    }
    fadeToFinal(r);
  };

  // Ticker tape: each line is its own strip of paper tape that runs in from the right.
  const lineCells = lineYs.map((ly) => visible.filter((c) => c.y === ly));
  const drawTicker = (r: number) => {
    clear();
    lineYs.forEach((ly, i) => {
      const top = ly - lh + 9;
      const h = lh - 6;
      ctx.fillStyle = 'rgba(255,255,255,.05)'; // the empty guide the tape will run along
      ctx.fillRect(0, top, W, h);
      const p = clamp01((r - i * 200) / 1100);
      if (r < i * 200) return;
      ctx.save();
      ctx.translate((1 - ease(p)) * (W + 40), 0);
      ctx.fillStyle = '#f3ecd6';
      ctx.fillRect(0, top, W, h);
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      ctx.fillRect(0, top, W, 1);
      ctx.fillRect(0, top + h - 1, W, 1);
      ctx.fillRect(0, top, 2, h); // the ragged leading end of the tape
      for (let x = 7; x < W; x += 14) {
        ctx.beginPath();
        ctx.arc(x, top + h / 2, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = `${fs}px ${FONT}`;
      ctx.fillStyle = '#22201a';
      for (const c of lineCells[i]) ctx.fillText(c.ch, c.x, c.y);
      ctx.restore();
    });
    fadeToFinal(r);
  };

  // Radar: a sweep goes round the stage and each letter blips into view as it passes.
  const rcx = W / 2;
  const rcy = H / 2;
  const radarAt = visible.map((c) => (((Math.atan2(c.y - fs * 0.3 - rcy, c.x + cw / 2 - rcx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * RADAR_REV);
  const drawRadar = (r: number) => {
    clear();
    const R = Math.hypot(W, H) / 2;
    ctx.strokeStyle = 'rgba(60,255,140,.18)';
    ctx.lineWidth = 1;
    for (let k = 1; k <= 5; k++) {
      ctx.beginPath();
      ctx.arc(rcx, rcy, ((R * k) / 5) * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(rcx, 0);
    ctx.lineTo(rcx, H);
    ctx.moveTo(0, rcy);
    ctx.lineTo(W, rcy);
    ctx.stroke();
    const a = (r / RADAR_REV) * Math.PI * 2;
    for (let k = 0; k < 24; k++) {
      ctx.fillStyle = `rgba(40,255,120,${0.2 * (1 - k / 24)})`;
      ctx.beginPath();
      ctx.moveTo(rcx, rcy);
      ctx.arc(rcx, rcy, R, a - (k + 1) * 0.04, a - k * 0.04);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(140,255,180,.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rcx, rcy);
    ctx.lineTo(rcx + Math.cos(a) * R, rcy + Math.sin(a) * R);
    ctx.stroke();
    ctx.font = `${fs}px ${FONT}`;
    visible.forEach((c, i) => {
      if (r < radarAt[i]) return;
      const fresh = r - radarAt[i] < 350;
      ctx.fillStyle = fresh ? '#d6ffe4' : '#b8ffd0';
      ctx.shadowColor = 'rgba(60,255,140,.9)';
      ctx.shadowBlur = fresh ? 16 : 5;
      ctx.fillText(c.ch, c.x, c.y);
    });
    ctx.shadowBlur = 0;
    fadeToFinal(r);
  };

  // Old film: a 3-2-1 countdown leader, then the text flickers up through scratches and grain.
  const drawFilm = (r: number, t: number) => {
    ctx.save();
    ctx.translate((rnd() - 0.5) * 3, (rnd() - 0.5) * 3);
    if (r < 0) {
      ctx.fillStyle = '#b8b2a0';
      ctx.fillRect(-4, -4, W + 8, H + 8);
      const rad = Math.min(W, H) * 0.32;
      const cx = W / 2;
      const cy = H / 2;
      ctx.strokeStyle = '#2a2620';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.moveTo(cx - rad * 1.3, cy);
      ctx.lineTo(cx + rad * 1.3, cy);
      ctx.moveTo(cx, cy - rad * 1.3);
      ctx.lineTo(cx, cy + rad * 1.3);
      ctx.stroke();
      const step = Math.min(2, Math.floor(t / 450));
      ctx.fillStyle = 'rgba(30,26,20,.25)'; // the clock wipe
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + ((t % 450) / 450) * Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a2620';
      ctx.font = `bold ${Math.round(rad * 1.3)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(3 - step), cx, cy + rad * 0.05);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    } else {
      ctx.fillStyle = '#1b150d';
      ctx.fillRect(-4, -4, W + 8, H + 8);
      ctx.font = `${fs}px ${FONT}`;
      ctx.globalAlpha = clamp01(r / 700) * (0.8 + rnd() * 0.2);
      ctx.fillStyle = '#f4e5bd';
      ctx.shadowColor = 'rgba(255,200,120,.8)';
      ctx.shadowBlur = 4;
      for (const c of visible) ctx.fillText(c.ch, c.x, c.y);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`; // projector flicker
    ctx.fillRect(0, 0, W, H);
    if (rnd() < 0.35) {
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.fillRect(rnd() * W, 0, 1, H);
    }
    for (let k = 0; k < 14; k++) {
      ctx.fillStyle = `rgba(255,255,255,${0.1 + rnd() * 0.25})`;
      ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
    }
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.6)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    fadeToFinal(r);
  };

  // Parade: ticker-tape streamers and confetti rain down; the letters pop in as it falls.
  const confetti = Array.from({ length: 90 }, () => ({ x: rnd() * W, o: rnd() * H, vy: 0.05 + rnd() * 0.08, ph: rnd() * 6, h: Math.floor(rnd() * 360) }));
  const ribbons = Array.from({ length: 14 }, () => ({ x: rnd() * W, v: 0.25 + rnd() * 0.25, ph: rnd() * 6, h: Math.floor(rnd() * 360), d: rnd() * 500 }));
  const drawParade = (r: number, t: number) => {
    clear();
    ctx.lineWidth = 3;
    for (const b of ribbons) {
      const head = ((t - b.d) * b.v) % (H + 160);
      if (t < b.d) continue;
      ctx.strokeStyle = `hsla(${b.h},85%,60%,.85)`;
      ctx.beginPath();
      for (let j = 0; j <= 14; j++) {
        const x = b.x + Math.sin(j * 0.35 + t / 350 + b.ph) * 12;
        if (j === 0) ctx.moveTo(x, head);
        else ctx.lineTo(x, head - j * 10);
      }
      ctx.stroke();
    }
    for (const k of confetti) {
      const y = ((t * k.vy + k.o) % (H + 20)) - 10;
      ctx.save();
      ctx.translate(k.x + Math.sin(t / 400 + k.ph) * 20, y);
      ctx.rotate(t / 150 + k.ph);
      ctx.fillStyle = `hsl(${k.h},85%,62%)`;
      ctx.fillRect(-3, -1.5, 6, 3);
      ctx.restore();
    }
    ctx.font = `${fs}px ${FONT}`;
    for (const c of visible) {
      const k = clamp01((r - c.lock) / 260);
      if (k <= 0) continue;
      ctx.save();
      ctx.translate(c.x + cw / 2, c.y - fs * 0.3);
      ctx.scale(1 + (1 - k) * 0.9, 1 + (1 - k) * 0.9);
      ctx.globalAlpha = k;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(255,255,255,.8)';
      ctx.shadowBlur = k < 1 ? 10 : 4;
      ctx.fillText(c.ch, -cw / 2, fs * 0.3);
      ctx.restore();
    }
  };

  // Train: a night express rolls through the snow; the letters puff out of its chimney and drift up into place.
  const FLYT = T_INTRO + Math.max(T_RESOLVE, 1400);
  const TX0 = -20; // chimney x at t = 0 (the rest of the train is still off the left edge)
  const TSPAN = W + 320; // chimney travel until the tail has left the right edge
  const trainX = (t: number) => TX0 + TSPAN * (t / FLYT);
  const BASE = H - 22;
  const CHIM_Y = BASE - 46;
  const flakes = Array.from({ length: 45 }, () => ({ x: rnd() * W, ph: rnd(), sp: 0.02 + rnd() * 0.03 }));
  const drawTrain = (t: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0e1b33');
    sky.addColorStop(1, '#1d3555');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.3 * Math.sin(t / 300 + s.ph)})`;
      ctx.fillRect(s.x, s.y * 0.8, s.s, s.s);
    }
    // snowy ground and rails
    ctx.fillStyle = '#dfe9f2';
    ctx.fillRect(0, BASE, W, H - BASE);
    ctx.fillStyle = '#6b7783';
    ctx.fillRect(0, BASE + 1, W, 2);
    // smoke: stateless puffs left in the air where the chimney was
    const k1 = Math.floor(t / 70);
    for (let k = k1; k > k1 - 14; k--) {
      const tb = k * 70;
      if (tb < 0) continue;
      const age = t - tb;
      const a = 0.4 * (1 - age / 980);
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(235,240,247,${a})`;
      ctx.beginPath();
      ctx.arc(trainX(tb) - age * 0.02 + Math.sin(k) * 3, CHIM_Y - age * 0.05, 4 + age * 0.012, 0, Math.PI * 2);
      ctx.fill();
    }
    // the letters, each one launched when the chimney is under its spot
    ctx.font = `${fs}px ${FONT}`;
    for (const c of visible) {
      const tl = ((c.x - TX0) / TSPAN) * FLYT;
      const q = (t - tl) / STEAM;
      if (q < 0) continue;
      const k = Math.min(1, q);
      const e = ease(k);
      const x = c.x + Math.sin(k * 6) * 10 * (1 - k);
      const y = CHIM_Y + (c.y - CHIM_Y) * e;
      if (k < 1) {
        ctx.fillStyle = `rgba(240,244,250,${0.5 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(x + cw / 2, y - fs * 0.3, 9 + 12 * k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = k < 1 ? '#ffffff' : '#e8fff4';
      ctx.shadowColor = 'rgba(80,255,190,.6)';
      ctx.shadowBlur = k < 1 ? 10 : 5;
      ctx.fillText(c.ch, x, y);
    }
    ctx.shadowBlur = 0;
    // the train, facing right; origin at the chimney
    ctx.save();
    ctx.translate(trainX(t), BASE);
    for (let k = 0; k < 2; k++) {
      const x0 = -170 - k * 106;
      ctx.fillStyle = '#6d1f2a';
      ctx.fillRect(x0, -38, 100, 34);
      ctx.fillStyle = '#3a1218';
      ctx.fillRect(x0 - 2, -40, 104, 4);
      ctx.fillStyle = '#ffd77a';
      for (let j = 0; j < 5; j++) ctx.fillRect(x0 + 8 + j * 18, -32, 12, 12);
      ctx.fillStyle = '#222';
      for (const wx of [14, 86]) {
        ctx.beginPath();
        ctx.arc(x0 + wx, -4, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillRect(x0 + 100, -14, 6, 3); // coupling
    }
    ctx.fillStyle = '#1d2329'; // boiler
    ctx.fillRect(-60, -34, 96, 22);
    ctx.fillStyle = '#6d1f2a'; // cab
    ctx.fillRect(-62, -48, 34, 36);
    ctx.fillStyle = '#3a1218';
    ctx.fillRect(-65, -50, 40, 4);
    ctx.fillStyle = '#ffd77a';
    ctx.fillRect(-56, -42, 14, 12);
    ctx.fillStyle = '#111'; // chimney with a flared top
    ctx.fillRect(-5, -44, 10, 12);
    ctx.beginPath();
    ctx.moveTo(-9, -46);
    ctx.lineTo(9, -46);
    ctx.lineTo(5, -42);
    ctx.lineTo(-5, -42);
    ctx.fill();
    ctx.fillStyle = '#c9a227'; // dome
    ctx.beginPath();
    ctx.ellipse(-26, -34, 8, 6, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#333'; // cowcatcher
    ctx.beginPath();
    ctx.moveTo(36, -12);
    ctx.lineTo(54, -3);
    ctx.lineTo(36, -3);
    ctx.fill();
    const beam = ctx.createLinearGradient(38, 0, 160, 0);
    beam.addColorStop(0, 'rgba(255,246,176,.35)');
    beam.addColorStop(1, 'rgba(255,246,176,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(38, -25);
    ctx.lineTo(160, -50);
    ctx.lineTo(160, 0);
    ctx.lineTo(38, -22);
    ctx.fill();
    ctx.fillStyle = '#fff6b0';
    ctx.beginPath();
    ctx.arc(36, -24, 4, 0, Math.PI * 2);
    ctx.fill();
    const spin = trainX(t) * 0.12;
    for (const wx of [-40, -12, 16]) {
      ctx.fillStyle = '#2a2f36';
      ctx.strokeStyle = '#c9a227';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(wx, -9, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(wx + Math.cos(spin) * 8, -9 + Math.sin(spin) * 8);
      ctx.lineTo(wx - Math.cos(spin) * 8, -9 - Math.sin(spin) * 8);
      ctx.stroke();
    }
    ctx.restore();
    // falling snow, in front of everything
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    for (const f of flakes) {
      const y = ((t * f.sp + f.ph * H) % H + H) % H;
      ctx.fillRect(f.x + Math.sin(t / 700 + f.ph * 9) * 6, y, 2, 2);
    }
  };

  // Safe: a vault door; the dial spins to the combination, the bolts slide back, the door swings open.
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const drawSafe = (p: number, t: number, intro: boolean) => {
    const open = clamp01((p - 0.6) / 0.4);
    // inside the vault: warm light on the text
    clear();
    const warm = 0.6 * (1 - clamp01((p - 0.9) / 0.1));
    const ig = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.hypot(W, H) / 2);
    ig.addColorStop(0, `rgba(120,90,30,${warm})`);
    ig.addColorStop(1, `rgba(${BG},0)`);
    ctx.fillStyle = ig;
    ctx.fillRect(0, 0, W, H);
    drawCells(0, () => true, false, false);

    const bolts = clamp01((p - 0.4) / 0.15);
    const dialAng = intro ? t / 180 : Math.sin(clamp01(p / 0.4) * Math.PI * 3) * Math.PI * 2 * (1 - clamp01(p / 0.4) * 0.5);
    const ang = ease(open) * 1.5;
    const sx = Math.max(0.07, Math.cos(ang));
    const alpha = open > 0.92 ? (1 - open) / 0.08 : 1;
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.transform(sx, 0, 0, 1, 0, 0); // swinging about the left-hand hinge
    const dg = ctx.createLinearGradient(0, 0, W, H);
    dg.addColorStop(0, '#7b8793');
    dg.addColorStop(1, '#4a545e');
    ctx.fillStyle = dg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#2f373e';
    ctx.lineWidth = 3;
    ctx.strokeRect(12, 12, W - 24, H - 24);
    ctx.fillStyle = '#9aa6b1';
    for (let x = 22; x < W - 12; x += 34) {
      for (const y of [20, H - 20]) {
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // dial
    const cx = W / 2 - 20;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.28;
    ctx.fillStyle = '#2d343b';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    const fg = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R * 0.9);
    fg.addColorStop(0, '#c4ccd4');
    fg.addColorStop(1, '#7e8a96');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.88, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2d343b';
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 40; k++) {
      const a = dialAng + (k / 40) * Math.PI * 2;
      const len = k % 5 === 0 ? 0.2 : 0.1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86);
      ctx.lineTo(cx + Math.cos(a) * R * (0.86 - len), cy + Math.sin(a) * R * (0.86 - len));
      ctx.stroke();
    }
    ctx.fillStyle = '#6b7783';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d33';
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - R - 6);
    ctx.lineTo(cx + 5, cy - R - 6);
    ctx.lineTo(cx, cy - R + 4);
    ctx.fill();
    // handle: a lever that swings down as the bolts withdraw
    const hx = cx + R * 1.6;
    ctx.save();
    ctx.translate(hx, cy);
    ctx.rotate(bolts * (Math.PI / 2));
    ctx.fillStyle = '#d6dde4';
    ctx.fillRect(-4, -5, 34, 10);
    ctx.fillStyle = '#2d343b';
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // bolts at the free edge
    ctx.fillStyle = '#c9d1d8';
    const bl = 22 * (1 - bolts);
    for (const f of [0.25, 0.5, 0.75]) ctx.fillRect(W - 4 - bl, H * f - 5, bl, 10);
    ctx.restore();
  };

  // Invisible ink: blank parchment; a flame travels along the writing and the heat makes it appear.
  const drawInk = (r: number, t: number) => {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, '#ecdcb2');
    g.addColorStop(1, '#c9b27a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.font = `${fs}px ${FONT}`;
    let front = -1;
    visible.forEach((c, i) => {
      const k = (r - c.lock) / INK;
      if (k <= 0) return;
      front = Math.max(front, i);
      const a = Math.min(1, k);
      ctx.fillStyle = `rgba(${Math.round(230 - 156 * a)},${Math.round(120 - 76 * a)},${Math.round(30 - 12 * a)},${Math.min(1, k * 3)})`;
      ctx.fillText(c.ch, c.x, c.y);
    });
    const lead = visible[Math.max(0, front)];
    if (lead) {
      const life = Math.min(1, Math.max(0, 1 - (r - T_LOCK) / 300));
      const fx = lead.x + cw / 2 - (front < 0 ? 30 : 0);
      const fy = lead.y + 12;
      const fl = Math.sin(t / 45) * 2 + Math.sin(t / 23);
      ctx.globalAlpha = life;
      const glow = ctx.createRadialGradient(fx, fy - 4, 2, fx, fy - 4, 46);
      glow.addColorStop(0, 'rgba(255,170,60,.55)');
      glow.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(fx - 50, fy - 54, 100, 100);
      ctx.fillStyle = '#ff9a2e';
      ctx.beginPath();
      ctx.ellipse(fx, fy - 4, 4.5, 9 + fl, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff2a8';
      ctx.beginPath();
      ctx.ellipse(fx, fy - 1, 2.2, 5 + fl / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (r > T_RES) {
      // the parchment fades into the dark stage the other styles end on
      ctx.globalAlpha = Math.min(1, (r - T_RES) / 250);
      drawFinal();
      ctx.globalAlpha = 1;
    }
  };

  // Jackpot: every letter is a slot reel; they stop one by one, then lights flash and coins pour down.
  const coins = Array.from({ length: 70 }, () => ({ x: rnd() * W, d: rnd() * 600, vy: 0.25 + rnd() * 0.25, ph: rnd() * 6 }));
  const drawJackpot = (r: number, t: number) => {
    clear();
    const win = r >= T_LOCK;
    const rw = r - T_LOCK;
    if (win) {
      ctx.fillStyle = `rgba(255,200,40,${0.07 + 0.06 * Math.sin(rw / 60)})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.font = `${fs}px ${FONT}`;
    visible.forEach((c, i) => {
      const boxTop = c.y - lh + 7;
      if (r < c.lock) {
        const pos = t * 0.5 + i * 13;
        const off = pos % lh;
        ctx.save();
        ctx.beginPath();
        ctx.rect(c.x - 1, boxTop, cw + 2, lh);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fillRect(c.x - 1, boxTop, cw + 2, lh);
        ctx.fillStyle = 'rgba(255,225,130,.85)';
        ctx.fillText(glyph(i * 31 + Math.floor(pos / lh)), c.x, boxTop + off + fs - 4);
        ctx.fillText(glyph(i * 31 + Math.floor(pos / lh) - 1), c.x, boxTop + off - lh + fs - 4);
        ctx.restore();
      } else {
        const k = Math.min(1, (r - c.lock) / 220);
        ctx.fillStyle = win ? '#fff3c0' : '#e8fff4';
        ctx.shadowColor = win ? 'rgba(255,200,40,.9)' : 'rgba(80,255,190,.6)';
        ctx.shadowBlur = win ? 10 : 5;
        ctx.fillText(c.ch, c.x, c.y - Math.sin(k * Math.PI) * 5);
        ctx.shadowBlur = 0;
      }
    });
    if (win && top >= 48) {
      const s = 1 + 0.08 * Math.sin(rw / 70);
      ctx.save();
      ctx.translate(W / 2, top - 16);
      ctx.scale(s, s);
      ctx.font = `bold 22px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd24a';
      ctx.shadowColor = 'rgba(255,160,0,.95)';
      ctx.shadowBlur = 14;
      ctx.fillText('JACKPOT!', 0, 0);
      ctx.restore();
      ctx.shadowBlur = 0;
    }
    if (win) {
      for (const k of coins) {
        const y = -10 + k.vy * (rw - k.d);
        if (rw < k.d || y > H + 10) continue;
        const w = 1 + 5 * Math.abs(Math.cos(rw / 90 + k.ph));
        ctx.fillStyle = '#ffd24a';
        ctx.strokeStyle = '#b8860b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(k.x, y, w, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // marquee bulbs round the edge, chasing slowly while spinning and flashing fast on the win
    let n = 0;
    const step = Math.floor(t / (win ? 90 : 220));
    const bulb = (x: number, y: number) => {
      ctx.fillStyle = (n++ + step) % 3 === 0 ? '#fff0a0' : 'rgba(255,170,40,.35)';
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let x = 8; x < W - 4; x += 20) bulb(x, 5);
    for (let y = 8; y < H - 4; y += 20) bulb(W - 5, y);
    for (let x = W - 8; x > 4; x -= 20) bulb(x, H - 5);
    for (let y = H - 8; y > 4; y -= 20) bulb(5, y);
  };

  // Swarm: glowing dust drifts about, then each speck flies in and becomes its letter.
  const origin = visible.map(() => ({ x: rnd() * W, y: rnd() * H, ph: rnd() * 6 }));
  const drawSwarm = (r: number, t: number) => {
    clear();
    ctx.font = `${fs}px ${FONT}`;
    visible.forEach((c, i) => {
      const o2 = origin[i];
      const sx = o2.x + Math.sin(t / 500 + o2.ph) * 6;
      const sy = o2.y + Math.cos(t / 420 + o2.ph) * 6;
      const p = (r - c.lock) / SWARM;
      if (p <= 0) {
        ctx.fillStyle = `rgba(160,255,220,${0.4 + 0.4 * Math.sin(t / 200 + o2.ph)})`;
        ctx.fillRect(sx, sy, 2.2, 2.2);
        return;
      }
      const q = ease(p);
      ctx.fillStyle = p < 1 ? `rgba(200,255,235,${0.5 + 0.5 * q})` : '#e8fff4';
      ctx.shadowColor = 'rgba(80,255,190,.6)';
      ctx.shadowBlur = p < 1 ? 10 : 5;
      ctx.fillText(c.ch, sx + (c.x - sx) * q, sy + (c.y - sy) * q);
    });
    ctx.shadowBlur = 0;
  };

  // Bubbles: each letter floats up inside a bubble, which pops when it arrives.
  const drawBubbles = (r: number) => {
    clear();
    ctx.font = `${fs}px ${FONT}`;
    const rad = cw * 0.95;
    visible.forEach((c, i) => {
      const p = (r - c.lock) / RISE;
      if (p < 0) return;
      const k = Math.min(1, p);
      const x = c.x + Math.sin(p * 7 + i) * 8 * (1 - k);
      const y = H + 20 + (c.y - H - 20) * ease(k);
      const bx = x + cw / 2;
      const by = y - fs * 0.3;
      ctx.fillStyle = '#e8fff4';
      ctx.fillText(c.ch, x, y);
      if (p < 1) {
        ctx.fillStyle = 'rgba(150,220,255,.14)';
        ctx.strokeStyle = 'rgba(170,230,255,.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(bx, by, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(bx, by, rad * 0.7, Math.PI * 1.1, Math.PI * 1.45);
        ctx.stroke();
      } else if (p < 1.2) {
        const pr = (p - 1) / 0.2;
        ctx.strokeStyle = `rgba(170,230,255,${1 - pr})`;
        ctx.beginPath();
        ctx.arc(bx, by, rad * (1 + pr * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  };

  // UFO: a saucer sweeps across and its beam makes the letters appear as it passes over them.
  const FLYU = T_INTRO + Math.max(T_RESOLVE, 1400);
  const drawUfo = (t: number) => {
    clear();
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.3 * Math.sin(t / 300 + s.ph)})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    const px = -40 + (W + 80) * (t / FLYU);
    if (px > -40 && px < W + 40) {
      const g = ctx.createLinearGradient(0, 24, 0, H);
      g.addColorStop(0, 'rgba(190,255,210,.35)');
      g.addColorStop(1, 'rgba(190,255,210,.05)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(px - 10, 24);
      ctx.lineTo(px + 10, 24);
      ctx.lineTo(px + 50, H);
      ctx.lineTo(px - 50, H);
      ctx.fill();
    }
    ctx.font = `${fs}px ${FONT}`;
    for (const c of visible) {
      const q = Math.min(1, (t - ((c.x + 40) / (W + 80)) * FLYU) / 300);
      if (q <= 0) continue;
      ctx.fillStyle = q < 1 ? `rgba(220,255,235,${q})` : '#e8fff4';
      ctx.shadowColor = 'rgba(160,255,200,.8)';
      ctx.shadowBlur = q < 1 ? 14 : 5;
      ctx.fillText(c.ch, c.x, c.y - (1 - q) * 30);
    }
    ctx.shadowBlur = 0;
    if (px > -40 && px < W + 40) {
      ctx.fillStyle = '#aab6c2';
      ctx.beginPath();
      ctx.ellipse(px, 18, 26, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7fd6ff';
      ctx.beginPath();
      ctx.ellipse(px, 15, 12, 9, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#ffe27a';
      for (let k = -2; k <= 2; k++) ctx.fillRect(px + k * 9 - 1.5, 19, 3, 3);
    }
  };

  // Spotlight: only a roaming pool of light shows the text, then it swells to light the whole stage.
  const drawSpot = (p: number) => {
    clear();
    drawCells(0, () => true, false, false);
    const grow = ease((p - 0.55) / 0.45);
    const rad = 55 + grow * Math.hypot(W, H);
    // the pool wanders back and forth along the text so it is actually found
    const tw = Math.max(...shown.map((l) => Array.from(l).length)) * cw;
    const cx = W / 2 + Math.sin(p * 5.5) * Math.max(40, tw / 2) * (1 - grow);
    const cy = top + (shown.length * lh) / 2 + Math.sin(p * 3.3) * lh * (1 - grow);
    const g = ctx.createRadialGradient(cx, cy, rad * 0.55, cx, cy, rad);
    g.addColorStop(0, `rgba(${BG},0)`);
    g.addColorStop(1, `rgb(${BG})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };

  // Plane: it crosses the sky and parachutes the text out, one word per canopy.
  const FLY = T_INTRO + Math.max(T_RESOLVE, 1400);
  const words: { cells: Cell[]; cx: number; x0: number; x1: number; tl: number; hue: number }[] = [];
  for (const c of visible) {
    const w = words[words.length - 1];
    const last = w?.cells[w.cells.length - 1];
    if (w && last.y === c.y && c.x - last.x < cw * 1.01) w.cells.push(c);
    else words.push({ cells: [c], cx: 0, x0: 0, x1: 0, tl: 0, hue: 0 });
  }
  words.forEach((w, i) => {
    w.x0 = w.cells[0].x;
    w.x1 = w.cells[w.cells.length - 1].x + cw;
    w.cx = (w.x0 + w.x1) / 2;
    w.tl = ((w.cx + 80) / (W + 160)) * FLY;
    w.hue = (i * 47) % 360;
  });
  const planeY = 12;
  const clouds = Array.from({ length: 6 }, () => ({ x: rnd() * W, y: H * (0.25 + rnd() * 0.65), s: 24 + rnd() * 40 }));
  const drawPlane = (t: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1d4468');
    sky.addColorStop(1, `rgb(${BG})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    for (const k of clouds) {
      const x = (((k.x - t * 0.03) % (W + 120)) + W + 120) % (W + 120) - 60;
      ctx.beginPath();
      ctx.ellipse(x, k.y, k.s, k.s * 0.3, 0, 0, Math.PI * 2);
      ctx.ellipse(x + k.s * 0.5, k.y - k.s * 0.12, k.s * 0.6, k.s * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `${fs}px ${FONT}`;
    for (const w of words) {
      const q = (t - w.tl) / FALL;
      if (q < 0) continue;
      const e = 1 - Math.pow(1 - Math.min(1, q), 2);
      const sway = Math.sin(Math.min(1, q) * 9) * 16 * (1 - Math.min(1, q));
      const dy = (planeY + 6 - w.cells[0].y) * (1 - e);
      const flying = q < 1;
      ctx.fillStyle = flying ? '#ffffff' : '#e8fff4';
      ctx.shadowColor = 'rgba(80,255,190,.55)';
      ctx.shadowBlur = 5;
      for (const c of w.cells) ctx.fillText(c.ch, c.x + sway, c.y + dy);
      ctx.shadowBlur = 0;
      if (flying) {
        const open = 1 - Math.min(1, Math.max(0, (q - 0.8) / 0.2)); // canopy folds up as it lands
        const top = w.cells[0].y + dy - fs;
        const rad = Math.max(16, (w.x1 - w.x0) / 2 + 8);
        const cx = w.cx + sway;
        const ch = 20 * open;
        ctx.globalAlpha = open;
        ctx.strokeStyle = 'rgba(255,255,255,.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - rad, top - 4);
        ctx.lineTo(w.x0 + sway, top + fs * 0.5);
        ctx.moveTo(cx + rad, top - 4);
        ctx.lineTo(w.x1 + sway, top + fs * 0.5);
        ctx.moveTo(cx, top - 4);
        ctx.lineTo(cx, top + fs * 0.5);
        ctx.stroke();
        ctx.fillStyle = `hsl(${w.hue},75%,58%)`;
        ctx.beginPath();
        ctx.ellipse(cx, top - 4, rad, ch, 0, Math.PI, 0);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // the plane, drawn last so it stays on top
    const px = -80 + ((t / FLY) * (W + 160));
    if (px > -80 && px < W + 80) {
      ctx.save();
      ctx.translate(px, planeY);
      ctx.fillStyle = '#e4ebf2';
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath(); // tail fin
      ctx.moveTo(-24, -2);
      ctx.lineTo(-34, -15);
      ctx.lineTo(-16, -3);
      ctx.fill();
      ctx.fillStyle = '#b5c2cf'; // wing
      ctx.beginPath();
      ctx.moveTo(-6, 2);
      ctx.lineTo(8, 2);
      ctx.lineTo(-2, 13);
      ctx.lineTo(-10, 13);
      ctx.fill();
      ctx.fillStyle = '#1d4468';
      for (let k = 0; k < 4; k++) ctx.fillRect(-12 + k * 7, -3, 4, 3);
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; // spinning propeller
      ctx.lineWidth = 2;
      const pa = (t / 20) % Math.PI;
      ctx.beginPath();
      ctx.moveTo(31 + Math.cos(pa) * 1, -Math.sin(pa) * 11);
      ctx.lineTo(31 - Math.cos(pa) * 1, Math.sin(pa) * 11);
      ctx.stroke();
      ctx.restore();
    }
  };

  // Moon: the Earth climbs over the lunar horizon and pushes the text up into view.
  const stars = Array.from({ length: 70 }, () => ({ x: rnd() * W, y: rnd() * H, s: 0.6 + rnd() * 1.4, ph: rnd() * 6 }));
  const craters = Array.from({ length: 9 }, () => ({ x: rnd(), y: rnd(), rx: 8 + rnd() * 26, ry: 3 + rnd() * 7 }));
  const earthR = Math.max(40, Math.min(W, H) * 0.22);
  const textBottom = top + shown.length * lh;
  const land = [[-0.35, -0.2, 0.32, 0.22], [0.25, 0.1, 0.3, 0.3], [-0.1, 0.5, 0.25, 0.16], [0.6, -0.4, 0.18, 0.14]];
  const drawMoon = (rise: number, pan: number, tt: number) => {
    clear();
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.sin(tt / 300 + s.ph)})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    const hy = H * 0.88 + pan * H * 0.3;
    const dy = (1 - rise) * H;
    // Earth, directly under the text block so it looks like it is pushing it up
    const ex = W / 2;
    const ey = textBottom + dy + earthR + 10;
    ctx.save();
    ctx.shadowColor = 'rgba(110,180,255,.7)';
    ctx.shadowBlur = 22;
    const eg = ctx.createRadialGradient(ex - earthR * 0.35, ey - earthR * 0.35, earthR * 0.1, ex, ey, earthR);
    eg.addColorStop(0, '#7cc4ff');
    eg.addColorStop(1, '#16418a');
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(ex, ey, earthR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.clip();
    for (const [lx, ly, lw, lhh] of land) {
      const gx = (((lx + tt / 9000) % 1.4) + 1.4) % 1.4 - 0.7; // slow spin
      ctx.fillStyle = 'rgba(70,160,80,.9)';
      ctx.beginPath();
      ctx.ellipse(ex + gx * earthR * 1.6, ey + ly * earthR, lw * earthR, lhh * earthR, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(ex + Math.sin(k * 2 + tt / 4000) * earthR * 0.6, ey + (k - 1.5) * earthR * 0.4, earthR * 0.4, earthR * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // the text it is lifting
    ctx.font = `${fs}px ${FONT}`;
    ctx.fillStyle = '#e8fff4';
    ctx.shadowColor = 'rgba(80,255,190,.55)';
    ctx.shadowBlur = 6;
    for (const c of cells) if (c.ch !== ' ') ctx.fillText(c.ch, c.x, c.y + dy);
    ctx.shadowBlur = 0;
    // lunar surface on top, hiding whatever is still below the horizon
    const sg = ctx.createLinearGradient(0, hy - 20, 0, H);
    sg.addColorStop(0, '#b9b9b4');
    sg.addColorStop(1, '#55554f');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(0, H + 2);
    ctx.lineTo(0, hy + 18);
    ctx.quadraticCurveTo(W / 2, hy - 18, W, hy + 18);
    ctx.lineTo(W, H + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(60,60,55,.45)';
    for (const k of craters) {
      ctx.beginPath();
      ctx.ellipse(k.x * W, hy + 20 + k.y * Math.max(0, H - hy - 24), k.rx, k.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // Curtain: red velvet panels draw apart to show the text.
  const drawCurtain = (open: number) => {
    clear();
    drawCells(0, () => true, false, false);
    const pw = (W / 2) * (1 - open);
    const panel = (x0: number, x1: number) => {
      for (let x = x0; x < x1; x += 8) {
        const shade = 0.5 + 0.5 * Math.sin(x * 0.55);
        ctx.fillStyle = `rgb(${Math.round(105 + 55 * shade)},${Math.round(18 + 14 * shade)},${Math.round(32 + 18 * shade)})`;
        ctx.fillRect(x, 0, Math.min(8, x1 - x), H);
      }
    };
    panel(0, pw);
    panel(W - pw, W);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(pw - 3, 0, 3, H);
    ctx.fillRect(W - pw, 0, 3, H);
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(0, 0, W, 12);
    ctx.fillStyle = '#7a5f0c';
    ctx.fillRect(0, 12, W, 2);
  };

  // Can: a tin tips over at the top right and the letters tumble out of it into place.
  const canAngle = -1.75;
  const canCx = W - 46;
  const canCy = 46;
  const mouthX = canCx + 30 * Math.sin(canAngle);
  const mouthY = canCy - 30 * Math.cos(canAngle);
  const drawCan = (tilt: number, dx: number, wobble: number) => {
    ctx.save();
    ctx.translate(canCx + dx, canCy);
    ctx.rotate(canAngle * tilt + wobble);
    ctx.fillStyle = '#9aa7b3';
    ctx.fillRect(-22, -30, 44, 60);
    ctx.fillStyle = '#e07b39';
    ctx.fillRect(-22, -12, 44, 24);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(-14, -30, 6, 60);
    ctx.fillStyle = '#5c6670';
    ctx.beginPath();
    ctx.ellipse(0, -30, 22, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10151a';
    ctx.beginPath();
    ctx.ellipse(0, -30, 17, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Flag: a toy gun goes BANG and a banner with the text unfurls from its barrel.
  const gunY = H / 2;
  const MUZZLE = 130;
  const drawGun = (mx: number) => {
    ctx.fillStyle = '#3a444e';
    ctx.fillRect(mx - 110, gunY - 10, 110, 20);
    ctx.fillStyle = '#56626d';
    ctx.fillRect(mx - 110, gunY - 10, 110, 5);
    ctx.fillStyle = '#2b333a';
    ctx.beginPath();
    ctx.moveTo(mx - 100, gunY + 10);
    ctx.lineTo(mx - 70, gunY + 10);
    ctx.lineTo(mx - 78, gunY + 52);
    ctx.lineTo(mx - 106, gunY + 52);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2b333a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(mx - 62, gunY + 18, 9, 0, Math.PI);
    ctx.stroke();
    ctx.fillStyle = '#0b0e11';
    ctx.fillRect(mx - 4, gunY - 5, 4, 10);
  };

  const frame = (now: number) => {
    const t = now - t0;
    if (skipped || t >= T_END) {
      drawFinal();
      resolveDone();
      return;
    }
    const r = t - T_INTRO;
    if (style === 'matrix') {
      if (t < T_SCAN) {
        drawScan(t / T_SCAN);
      } else if (t < T_INTRO) {
        if (!rainStarted) {
          rainStarted = true;
          clear();
          ctx.globalAlpha = 0.5;
          ctx.drawImage(o.source, ix, iy, iw, ih);
          ctx.globalAlpha = 1;
        }
        rain(0.14);
      } else {
        ctx.fillStyle = `rgba(${BG},.35)`;
        ctx.fillRect(0, 0, W, H);
        rain(0);
        ctx.fillStyle = `rgba(${BG},.88)`;
        ctx.fillRect(pad / 2, pad / 2, W - pad, H - pad);
        drawCells(r, (c) => r >= c.lock, true);
      }
    } else if (t < T_INTRO) {
      const p = t / T_INTRO;
      if (style === 'ticker') {
        drawTicker(r);
      } else if (style === 'radar') {
        drawRadar(r);
      } else if (style === 'film') {
        drawFilm(r, t);
      } else if (style === 'parade') {
        drawParade(r, t);
      } else if (style === 'oldtype') {
        drawOldType(r, t);
      } else if (style === 'printer') {
        drawPrinter(r, t);
      } else if (style === 'train') {
        drawTrain(t);
      } else if (style === 'safe') {
        drawSafe(0, t, true);
      } else if (style === 'ink') {
        drawInk(r, t);
      } else if (style === 'jackpot') {
        drawJackpot(r, t);
      } else if (style === 'swarm') {
        drawSwarm(r, t);
      } else if (style === 'bubbles') {
        drawBubbles(r);
      } else if (style === 'ufo') {
        drawUfo(t);
      } else if (style === 'spotlight') {
        drawSpot(0);
      } else if (style === 'plane') {
        drawPlane(t);
      } else if (style === 'moon') {
        drawMoon(0, 0, t);
      } else if (style === 'curtain') {
        drawCurtain(0);
      } else if (style === 'can') {
        clear();
        drawCan(ease(p), (1 - ease(p)) * 100, 0);
      } else if (style === 'flag') {
        clear();
        drawGun(MUZZLE - (1 - ease(p)) * 170 + (p > 0.8 ? (rnd() - 0.5) * 3 : 0));
      } else if (style === 'pixelate') {
        clear();
        drawPixels(1 + p * p * 30, 1);
      } else if (style === 'fireworks') {
        drawScan(p);
      } else drawScan(p, style === 'typewriter' ? 1 - p * 0.75 : 1);
    } else if (style === 'scramble') {
      clear();
      drawCells(r, (c) => r >= c.lock, true);
    } else if (style === 'typewriter') {
      clear();
      const n = Math.floor(Math.min(1, r / T_RES) * visible.length + 0.5);
      drawCells(r, (_c, i) => i < n, false, false);
      const cur = visible[Math.min(n, visible.length - 1)];
      if (cur && Math.floor(r / 260) % 2 === 0) {
        ctx.fillStyle = '#7dffe0';
        ctx.fillRect(cur.x, cur.y - fs + 2, cw * 0.7, fs);
      }
    } else if (style === 'pixelate') {
      clear();
      drawPixels(30, Math.max(0, 1 - (r / T_RES) * 1.3));
      ctx.fillStyle = `rgba(${BG},.55)`;
      ctx.fillRect(0, 0, W, H);
      drawCells(r, (c) => r >= c.lock, false);
    } else if (style === 'iris') {
      clear();
      ctx.globalAlpha = 0.45;
      ctx.drawImage(o.source, ix, iy, iw, ih);
      ctx.globalAlpha = 1;
      const e = 1 - Math.pow(1 - Math.min(1, r / T_RES), 3);
      const rad = (e * Math.hypot(W, H)) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, rad, 0, Math.PI * 2);
      ctx.clip();
      clear();
      drawCells(r, () => true, false, false);
      ctx.restore();
      ctx.strokeStyle = 'rgba(120,255,220,.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, rad, 0, Math.PI * 2);
      ctx.stroke();
    } else if (style === 'ticker') {
      drawTicker(r);
    } else if (style === 'radar') {
      drawRadar(r);
    } else if (style === 'film') {
      drawFilm(r, t);
    } else if (style === 'parade') {
      drawParade(r, t);
    } else if (style === 'oldtype') {
      drawOldType(r, t);
    } else if (style === 'printer') {
      drawPrinter(r, t);
    } else if (style === 'train') {
      drawTrain(t);
    } else if (style === 'safe') {
      drawSafe(Math.min(1, r / T_RES), t, false);
    } else if (style === 'ink') {
      drawInk(r, t);
    } else if (style === 'jackpot') {
      drawJackpot(r, t);
    } else if (style === 'swarm') {
      drawSwarm(r, t);
    } else if (style === 'bubbles') {
      drawBubbles(r);
    } else if (style === 'ufo') {
      drawUfo(t);
    } else if (style === 'spotlight') {
      drawSpot(Math.min(1, r / (T_RES - 200)));
    } else if (style === 'plane') {
      drawPlane(t);
    } else if (style === 'moon') {
      const p = Math.min(1, r / (T_RES - 700));
      drawMoon(p * p * (3 - 2 * p), Math.min(1, Math.max(0, (r - (T_RES - 700)) / 700)), t);
    } else if (style === 'curtain') {
      const p = Math.min(1, r / (T_RES - 200));
      drawCurtain(p * p * (3 - 2 * p));
    } else if (style === 'can') {
      clear();
      ctx.font = `${fs}px ${FONT}`;
      for (const c of visible) {
        const p = (r - c.lock) / FLIGHT;
        if (p < 0) continue;
        const q = Math.min(1, p);
        ctx.fillStyle = q < 1 ? '#7dffe0' : '#e8fff4';
        ctx.shadowColor = 'rgba(80,255,190,.6)';
        ctx.shadowBlur = q < 1 ? 10 : 5;
        ctx.fillText(c.ch, mouthX + (c.x - mouthX) * q, mouthY + (c.y - mouthY) * q * q - 70 * q * (1 - q));
      }
      ctx.shadowBlur = 0;
      const out = ease((r - (T_RES - 450)) / 450);
      drawCan(1, out * 140, Math.sin(r / 45) * 0.04 * (1 - out));
    } else if (style === 'flag') {
      clear();
      const p = Math.min(1, r / 1100);
      const e = p * p * (3 - 2 * p); // slow start so the gun and the flag are seen leaving the barrel
      const L = MUZZLE * (1 - e);
      const R = MUZZLE + (W - MUZZLE) * e;
      const hh = (H / 2 - 6) * ease(p * 3);
      // a wavy cloth: the edges, the folds and the writing ripple like a flag in the wind, then settle
      const damp = 1 - clamp01((r - 1000) / 400);
      const wv = (x: number) => 8 * damp * (0.2 + 0.8 * clamp01((x - L) / Math.max(60, R - L))) * Math.sin((x - L) * 0.04 - t * 0.009);
      const notch = Math.min(14, (R - L) * 0.1) * damp;
      const flagPath = () => {
        ctx.beginPath();
        ctx.moveTo(L, gunY - hh + wv(L));
        for (let x = L + 6; x < R; x += 6) ctx.lineTo(x, gunY - hh + wv(x));
        ctx.lineTo(R, gunY - hh + wv(R));
        ctx.lineTo(R - notch, gunY + wv(R));
        ctx.lineTo(R, gunY + hh + wv(R));
        for (let x = R - 6; x > L; x -= 6) ctx.lineTo(x, gunY + hh + wv(x));
        ctx.lineTo(L, gunY + hh + wv(L));
        ctx.closePath();
      };
      ctx.save();
      flagPath();
      ctx.clip();
      ctx.fillStyle = 'rgb(22,34,46)';
      ctx.fillRect(L - 2, 0, R - L + 4, H);
      ctx.globalAlpha = damp;
      ctx.fillStyle = '#9b1c2e';
      ctx.fillRect(L - 2, 0, R - L + 4, H);
      for (let x = L; x < R; x += 6) {
        const s = Math.cos((x - L) * 0.04 - t * 0.009);
        ctx.fillStyle = s > 0 ? `rgba(255,255,255,${0.14 * s})` : `rgba(0,0,0,${-0.22 * s})`;
        ctx.fillRect(x, 0, 6, H);
      }
      ctx.globalAlpha = 1;
      ctx.font = `${fs}px ${FONT}`;
      ctx.fillStyle = '#fff6e0';
      for (const c of visible) ctx.fillText(c.ch, c.x, c.y + wv(c.x));
      ctx.restore();
      flagPath();
      ctx.strokeStyle = `rgba(224,176,48,${damp})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      drawGun(L + 4);
      if (r < 240) {
        const f = 1 - r / 240;
        ctx.fillStyle = `rgba(255,255,255,${0.5 * f})`;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = `rgba(255,200,40,${f})`;
        ctx.beginPath();
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const rad = (k % 2 ? 16 : 40) * (0.6 + f);
          ctx.lineTo(MUZZLE + Math.cos(a) * rad, gunY + Math.sin(a) * rad);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = `rgba(220,40,40,${f})`;
        ctx.font = `bold 22px ${FONT}`;
        ctx.fillText('BANG!', MUZZLE + 14, gunY - 44);
      }
    } else {
      if (r < 20) clear();
      drawFireworks(r);
    }
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
  return {
    done,
    skip: () => {
      skipped = true;
    },
  };
}
