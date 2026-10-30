// Presentational only: a randomly chosen animation (matrix rain, scramble, typewriter, pixelate, iris,
// fireworks, curtain, can, flag) turns the scanned image into the decoded text.
export type RevealStyle = 'matrix' | 'scramble' | 'typewriter' | 'pixelate' | 'iris' | 'fireworks' | 'curtain' | 'can' | 'flag' | 'moon' | 'plane';
export const STYLES: RevealStyle[] = ['matrix', 'scramble', 'typewriter', 'pixelate', 'iris', 'fireworks', 'curtain', 'can', 'flag', 'moon', 'plane'];

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
  const FLIGHT = 500; // how long a letter takes to fall out of the can
  const FALL = 1100; // how long a parachuted word takes to float down
  const T_INTRO = style === 'matrix' ? T_SCAN + T_RAIN : style === 'curtain' || style === 'moon' ? 600 : style === 'can' || style === 'flag' || style === 'plane' ? 800 : 1000;
  const T_RES =
    style === 'iris' ? 1300
    : style === 'fireworks' ? Math.max(T_RESOLVE, 2200)
    : style === 'curtain' ? 1700
    : style === 'flag' ? 1400
    : style === 'moon' ? 2400
    : style === 'plane' ? Math.max(T_RESOLVE, 1400) + FALL + 100
    : style === 'can' ? Math.max(T_RESOLVE, 1400) + FLIGHT + 100
    : T_RESOLVE;
  const T_END = T_INTRO + T_RES + 250;
  const spread = style === 'fireworks' ? 0.7 : 0.8;
  const T_LOCK = style === 'can' ? T_RES - FLIGHT - 100 : T_RES;
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
      if (style === 'plane') {
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
      ctx.save();
      ctx.beginPath();
      ctx.rect(L, gunY - hh, R - L, hh * 2);
      ctx.clip();
      ctx.fillStyle = 'rgb(22,34,46)';
      ctx.fillRect(L, gunY - hh, R - L, hh * 2);
      drawCells(r, () => true, false, false);
      ctx.restore();
      ctx.strokeStyle = '#e0b030';
      ctx.lineWidth = 3;
      ctx.strokeRect(L, gunY - hh, R - L, hh * 2);
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
