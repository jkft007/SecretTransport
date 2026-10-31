// Presentational only: a randomly chosen animation (matrix rain, scramble, typewriter, pixelate, iris,
// fireworks, curtain, can, flag) turns the scanned image into the decoded text.
export type RevealStyle = 'matrix' | 'scramble' | 'typewriter' | 'pixelate' | 'iris' | 'fireworks' | 'curtain' | 'can' | 'flag' | 'moon' | 'plane' | 'swarm' | 'bubbles' | 'ufo' | 'spotlight' | 'jackpot' | 'ink' | 'safe' | 'train' | 'oldtype' | 'printer' | 'ticker' | 'radar' | 'film' | 'parade' | 'asteroids' | 'hearts' | 'flowers' | 'bomb' | 'wizard' | 'minions' | 'snowglobe' | 'rocket' | 'lightning' | 'helicopters' | 'banner' | 'balloons' | 'quill' | 'dominoes' | 'treasure' | 'paperplanes' | 'ghosts';
export const STYLES: RevealStyle[] = [
  'matrix', 'scramble', 'typewriter', 'pixelate', 'iris', 'fireworks', 'curtain', 'can', 'flag', 'moon', 'plane',
  'swarm', 'bubbles', 'ufo', 'spotlight', 'jackpot', 'ink', 'safe', 'train', 'oldtype', 'printer',
  'ticker', 'radar', 'film', 'parade', 'asteroids',
  'hearts', 'flowers', 'bomb', 'wizard',
  'minions', 'snowglobe', 'rocket', 'lightning', 'helicopters', 'banner', 'balloons',
  'quill', 'dominoes', 'treasure', 'paperplanes', 'ghosts',
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
  const wordCount = Math.max(1, visible.filter((c, i) => i === 0 || visible[i - 1].y !== c.y || c.x - visible[i - 1].x >= cw * 1.01).length);
  const AST_DT = Math.min(350, Math.max(60, 2200 / wordCount)); // time between shots
  const AST_FLIGHT = 260; // how long a bullet takes to reach its rock
  const HEART_RISE = 1000; // how long a heart takes to carry its letter up
  const BLOOM = 500; // how long a flower takes to open
  const BOOM_T = 1000; // when the cartoon bomb goes off, measured from the end of the intro
  const WIZ_SPREAD = Math.max(6500, Math.min(13000, visible.length * 160)); // the magic ink takes its time
  const FLIGHT = 500; // how long a letter takes to fall out of the can
  const FALL = 1100; // how long a parachuted word takes to float down
  const SWARM = 700; // how long a speck of dust takes to fly to its letter
  const RISE = 900; // how long a bubble takes to float up to its place
  const WIN = 1000; // the jackpot celebration after the last reel stops
  const INK = 900; // how long invisible ink takes to darken once the flame reaches it
  const MIN_T = 1800; // a minion's whole trip: run in, throw, cheer, run off
  const AIR_T = 2050; // a helicopter's whole trip: fly in, lower, release, fly off
  const HELI_GAP = Math.min(700, Math.max(250, 3200 / Math.max(1, lineYs.length))); // one helicopter carries each line; this is the wait between them
  const BANNER_T = 2600; // how long the banner plane takes to bring the banner home
  const BAL_POP = 700; // a balloon pops this long after its letter's turn
  const BAL_SHRED = 450; // how long the bits of a popped balloon fly
  const COIN_T = 650; // how long a coin takes to fly out of the chest to its letter
  const PP_T = 1000; // a paper plane's whole trip: glide in, land, unfold
  const GHOST_T = 1100; // how long a letter takes to materialise out of the mist
  const STEAM = 900; // how long a letter takes to drift up from the chimney to its place
  const T_INTRO = style === 'matrix' ? T_SCAN + T_RAIN : ['curtain', 'moon', 'swarm', 'bubbles', 'ufo', 'spotlight', 'jackpot', 'ink', 'safe', 'train', 'oldtype', 'printer', 'ticker', 'radar', 'parade', 'asteroids', 'hearts', 'flowers', 'bomb', 'wizard', 'minions', 'snowglobe', 'rocket', 'lightning', 'helicopters', 'banner', 'balloons', 'quill', 'dominoes', 'treasure', 'paperplanes', 'ghosts'].includes(style) ? 600 : style === 'film' ? 1400 : style === 'can' || style === 'flag' || style === 'plane' ? 800 : 1000;
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
    : style === 'ink' ? Math.max(3500, Math.min(8000, visible.length * 90)) + INK + 100
    : style === 'safe' ? 2200
    : style === 'train' ? Math.max(T_RESOLVE, 1400) + STEAM + 100
    : style === 'oldtype' || style === 'printer' ? T_TYPE + 200
    : style === 'ticker' ? 200 * (lineYs.length - 1) + 1100 + 150
    : style === 'radar' ? RADAR_REV + 700
    : style === 'film' ? 1900
    : style === 'parade' ? Math.max(T_RESOLVE, 1400) + 300
    : style === 'asteroids' ? (wordCount - 1) * AST_DT + AST_FLIGHT + 600
    : style === 'hearts' ? Math.max(T_RESOLVE, 1400) + HEART_RISE + 300
    : style === 'flowers' ? Math.max(T_RESOLVE, 1400) + BLOOM + 500
    : style === 'bomb' ? BOOM_T + 1000
    : style === 'wizard' ? WIZ_SPREAD + 3600
    : style === 'minions' ? Math.max(T_RESOLVE, 1400) + MIN_T + 200
    : style === 'helicopters' ? HELI_GAP * (lineYs.length - 1) + AIR_T + 300
    : style === 'snowglobe' ? Math.max(T_RESOLVE, 2000) + 1800
    : style === 'rocket' ? T_TYPE + 500
    : style === 'lightning' ? 3600
    : style === 'banner' ? BANNER_T + 600
    : style === 'quill' ? T_TYPE + 700
    : style === 'dominoes' ? T_TYPE + 500
    : style === 'treasure' ? Math.max(T_RESOLVE, 1400) + COIN_T + 150
    : style === 'paperplanes' ? Math.max(T_RESOLVE, 1400) + PP_T + 300
    : style === 'ghosts' ? Math.max(T_RESOLVE, 1800) + GHOST_T + 300
    : style === 'balloons' ? Math.max(T_RESOLVE, 1400) + BAL_POP + BAL_SHRED + 100
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
    : style === 'hearts' ? T_RES - HEART_RISE - 300
    : style === 'flowers' ? T_RES - BLOOM - 500
    : style === 'minions' ? T_RES - MIN_T - 200
    : style === 'snowglobe' ? T_RES - 800
    : style === 'balloons' ? T_RES - BAL_POP - BAL_SHRED - 100
    : style === 'treasure' ? T_RES - COIN_T - 150
    : style === 'paperplanes' ? T_RES - PP_T - 300
    : style === 'ghosts' ? T_RES - GHOST_T - 300
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
    // The metal type ball rides along the line on its carriage, spins round to the next character, then strikes.
    const nxt = last + 1 < visible.length ? visible[last + 1] : undefined;
    const spinFor = (ch: string) => (ch.charCodeAt(0) * 0.61) % (Math.PI * 2);
    let hx = visible[0] ? visible[0].x + cw / 2 : W / 2;
    let hy = visible[0] ? visible[0].y : H / 2;
    let spin = 0;
    if (cur) {
      const k = nxt ? clamp01((r - typeAt[last]) / (typeAt[last + 1] - typeAt[last])) : 1;
      const ke = ease(k);
      hx = nxt ? cur.x + cw / 2 + (nxt.x - cur.x) * ke : cur.x + cw / 2;
      hy = nxt && nxt.y !== cur.y ? cur.y + (nxt.y - cur.y) * clamp01((k - 0.3) / 0.4) : cur.y; // carriage return
      spin = nxt ? spinFor(cur.ch) + (spinFor(nxt.ch) - spinFor(cur.ch) + Math.PI * 2) * ke : spinFor(cur.ch);
    }
    const strike = cur && age < 70 ? 5 : 0;
    const bR = 13;
    const bcy = hy - fs - 14 + strike; // centre of the ball, above the line being typed
    ctx.fillStyle = '#6b747d'; // the rail the carriage slides on
    ctx.fillRect(0, hy - fs - 40, W, 4);
    ctx.fillStyle = '#4a535c';
    ctx.fillRect(hx - 18, hy - fs - 40, 36, 12);
    ctx.fillRect(hx - 4, hy - fs - 30, 8, bcy - (hy - fs - 30)); // the arm holding the ball
    const bg =ctx.createRadialGradient(hx - 4, bcy - 4, 2, hx, bcy, bR);
    bg.addColorStop(0, '#f4f7fa');
    bg.addColorStop(0.6, '#a3adb8');
    bg.addColorStop(1, '#4a535c');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(hx, bcy, bR, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 6px monospace'; // the raised characters round the ball turn with it
    ctx.fillStyle = 'rgba(25,30,36,.85)';
    const faces = 'ETAOINSHRDLUCMFWYPGBVKXQJZ0123456789.,';
    for (let row = 0; row < 3; row++) {
      for (let j = 0; j < 9; j++) {
        const phi = spin + (j / 9) * Math.PI * 2;
        const c = Math.cos(phi);
        if (c < 0.2) continue;
        ctx.save();
        ctx.translate(hx + Math.sin(phi) * (bR - 2), bcy + (row - 1) * 6);
        ctx.scale(c, 1);
        ctx.fillText(faces[(j * 7 + row * 13) % faces.length], -2, 2);
        ctx.restore();
      }
    }
    ctx.fillStyle = '#2a2f36'; // the ribbon guide between the ball and the paper
    ctx.fillRect(hx - 9, bcy + bR - 1, 18, 5);
    if (strike) {
      ctx.fillStyle = 'rgba(20,20,25,.55)';
      ctx.fillRect(hx - 4, hy - fs * 0.75, 8, 3);
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

  // Asteroids: a vector-graphics ship shoots a rock for every word; each rock blows up and the word appears.
  const rocks = words.map(() => ({
    pts: Array.from({ length: 10 }, (_, j) => ({ a: (j / 10) * Math.PI * 2, f: 0.75 + rnd() * 0.4 })),
    spin: (rnd() - 0.5) * 0.002,
    ph: rnd() * 6,
    bits: Array.from({ length: 7 }, () => ({ a: rnd() * Math.PI * 2, v: 0.03 + rnd() * 0.05 })),
  }));
  const shipX = words.map((w) => W / 2 + (w.cx - W / 2) * 0.5);
  const SHIP_Y = H - 20;
  const rockPos = (i: number) => ({ x: words[i].cx, y: words[i].cells[0].y - fs * 0.3 });
  const drawAsteroids = (r: number, t: number) => {
    clear();
    const n = words.length;
    if (!n) return;
    ctx.strokeStyle = '#e8fff4';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(160,255,220,.8)';
    ctx.shadowBlur = 4;
    ctx.font = `${fs}px ${FONT}`;
    for (let i = 0; i < n; i++) {
      const hit = i * AST_DT + AST_FLIGHT;
      const { x, y } = rockPos(i);
      const rk = rocks[i];
      if (r < hit) {
        const rad = Math.min(38, Math.max(12, (words[i].x1 - words[i].x0) / 2));
        const cx = x + Math.sin(t / 900 + rk.ph) * 4;
        const cy = y + Math.cos(t / 1100 + rk.ph) * 3;
        ctx.beginPath();
        rk.pts.forEach((p, j) => {
          const a = p.a + t * rk.spin;
          const px = cx + Math.cos(a) * rad * p.f;
          const py = cy + Math.sin(a) * rad * p.f;
          if (j === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.stroke();
        continue;
      }
      const age = r - hit;
      if (age < 500) {
        ctx.globalAlpha = 1 - age / 500;
        for (const b of rk.bits) {
          const d = age * b.v;
          const x0 = x + Math.cos(b.a) * d;
          const y0 = y + Math.sin(b.a) * d;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + Math.cos(b.a + age / 120) * 9, y0 + Math.sin(b.a + age / 120) * 9);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = age < 200 ? '#ffffff' : '#e8fff4';
      for (const c of words[i].cells) ctx.fillText(c.ch, c.x, c.y);
    }
    // the ship swings toward the next rock, fires, and moves on
    const next = Math.min(n - 1, r < 0 ? 0 : Math.floor(r / AST_DT) + 1);
    const mv = Math.min(250, AST_DT);
    const k = clamp01(1 - (next * AST_DT - r) / mv);
    const prevX = next > 0 ? shipX[next - 1] : W / 2;
    const sx = r >= (n - 1) * AST_DT ? shipX[n - 1] : prevX + (shipX[next] - prevX) * ease(k);
    const tg = rockPos(next);
    const ang = Math.atan2(tg.x - sx, -(tg.y - SHIP_Y));
    ctx.save();
    ctx.translate(sx, SHIP_Y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 5);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // bullets in flight
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < n; i++) {
      const q = (r - i * AST_DT) / AST_FLIGHT;
      if (q < 0 || q >= 1) continue;
      const tp = rockPos(i);
      const a = Math.atan2(tp.x - shipX[i], -(tp.y - SHIP_Y));
      const ox = shipX[i] + Math.sin(a) * 12;
      const oy = SHIP_Y - Math.cos(a) * 12;
      ctx.fillRect(ox + (tp.x - ox) * q - 1.5, oy + (tp.y - oy) * q - 1.5, 3, 3);
    }
    ctx.shadowBlur = 0;
  };

  // Wizard's ink: aged parchment on which the writing seeps into view in scattered bits, lit by a wand tip.
  const wizAt: number[] = new Array(visible.length).fill(0);
  {
    const runs: number[][] = []; // the writing arrives in little runs of 1..5 letters, in a random order
    for (let i = 0; i < visible.length; ) {
      const n = Math.min(visible.length - i, 1 + Math.floor(rnd() * 5));
      runs.push(Array.from({ length: n }, (_, j) => i + j));
      i += n;
    }
    for (let k = runs.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [runs[k], runs[j]] = [runs[j], runs[k]];
    }
    runs.forEach((run, k) => {
      const start = (k / runs.length) * WIZ_SPREAD * 0.95 + rnd() * 120;
      run.forEach((idx, j) => (wizAt[idx] = start + j * 280));
    });
  }
  const stains = Array.from({ length: 9 }, () => ({ x: rnd() * W, y: rnd() * H, rx: 20 + rnd() * 50, ry: 10 + rnd() * 30 }));
  const drawWizard = (r: number, t: number) => {
    const pg = ctx.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, Math.hypot(W, H) / 2);
    pg.addColorStop(0, '#ead8a8');
    pg.addColorStop(1, '#b99b62');
    ctx.fillStyle = pg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(120,80,30,.07)';
    for (const s of stains) {
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `${fs}px ${FONT}`;
    let focus = -1;
    visible.forEach((c, i) => {
      const age = r - wizAt[i];
      if (age <= 0) return;
      const k = clamp01(age / 2400); // each letter seeps in very slowly
      if (age < 1500 && (focus < 0 || wizAt[i] > wizAt[focus])) focus = i;
      const bx = c.x + cw / 2;
      const by = c.y - fs * 0.3;
      const blot = ctx.createRadialGradient(bx, by, 0, bx, by, cw * (0.4 + 0.8 * ease(k)));
      blot.addColorStop(0, `rgba(60,35,10,${0.3 * (1 - 0.6 * k)})`);
      blot.addColorStop(1, 'rgba(60,35,10,0)');
      ctx.fillStyle = blot;
      ctx.fillRect(bx - cw * 1.3, by - cw * 1.3, cw * 2.6, cw * 2.6);
      ctx.globalAlpha = k;
      ctx.fillStyle = `rgb(${Math.round(224 - 182 * k)},${Math.round(160 - 134 * k)},${Math.round(48 - 36 * k)})`; // golden, cooling to ink
      ctx.shadowColor = 'rgba(255,190,60,.9)';
      ctx.shadowBlur = 10 * (1 - k);
      ctx.fillText(c.ch, c.x, c.y);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    });
    // the wand: its glowing tip rests on the writing that is appearing
    const tip = focus >= 0 ? { x: visible[focus].x + cw / 2, y: visible[focus].y - fs * 0.3 } : { x: W * 0.2 + Math.sin(t / 500) * 20, y: H * 0.35 + Math.cos(t / 700) * 12 };
    const bob = Math.sin(t / 180) * 2;
    ctx.strokeStyle = '#3b2616';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tip.x + 4, tip.y - 3 + bob);
    ctx.lineTo(tip.x + 40, tip.y - 38 + bob);
    ctx.stroke();
    ctx.lineCap = 'butt';
    const glow = ctx.createRadialGradient(tip.x, tip.y + bob, 0, tip.x, tip.y + bob, 22);
    glow.addColorStop(0, 'rgba(255,240,170,.9)');
    glow.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(tip.x - 24, tip.y + bob - 24, 48, 48);
    ctx.fillStyle = 'rgba(255,230,140,.9)';
    for (let k = 0; k < 7; k++) ctx.fillRect(tip.x + (rnd() - 0.5) * 30, tip.y + bob + (rnd() - 0.5) * 30, 1.5, 1.5);
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
    vg.addColorStop(0, 'rgba(70,40,10,0)');
    vg.addColorStop(1, 'rgba(70,40,10,.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    fadeToFinal(r);
  };

  // Old cartoon bomb: a round black bomb with a sparking fuse; it goes KA-BOOM and blows the letters into place.
  const bx = W / 2;
  const by = H / 2 + 12;
  const bR = Math.min(30, H * 0.14);
  const fuse = (u: number) => {
    const p0 = { x: bx + bR * 0.3, y: by - bR };
    const p1 = { x: bx + bR * 0.3, y: by - bR - 26 };
    const p2 = { x: bx + bR * 1.4, y: by - bR - 36 };
    return { x: (1 - u) * (1 - u) * p0.x + 2 * (1 - u) * u * p1.x + u * u * p2.x, y: (1 - u) * (1 - u) * p0.y + 2 * (1 - u) * u * p1.y + u * u * p2.y };
  };
  const starburst = (x: number, y: number, ro: number, ri: number, n: number, rot: number) => {
    ctx.beginPath();
    for (let k = 0; k < n * 2; k++) {
      const a = rot + (k / (n * 2)) * Math.PI * 2;
      const rad = k % 2 ? ri : ro;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
  };
  const smoke = Array.from({ length: 10 }, () => ({ a: rnd() * Math.PI * 2, v: 0.05 + rnd() * 0.07, s: 12 + rnd() * 16 }));
  const drawBomb = (r: number, t: number) => {
    clear();
    const boomAt = BOOM_T;
    const burn = clamp01(t / (T_INTRO + boomAt));
    if (r < boomAt) {
      const shake = Math.sin(t * 0.06) * burn * burn * burn * 3;
      ctx.save();
      ctx.translate(shake, 0);
      ctx.fillStyle = '#34343d'; // dark grey, so the bomb still shows against the dark stage
      ctx.strokeStyle = '#8a8a96';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by, bR * (1 + 0.04 * Math.sin(t / 60) * burn), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.beginPath();
      ctx.ellipse(bx - bR * 0.4, by - bR * 0.4, bR * 0.22, bR * 0.13, -0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a3a42'; // the cap the fuse comes out of
      ctx.fillRect(bx - 5, by - bR - 5, 12, 8);
      // the fuse burns down from its tip towards the bomb
      const f = 1 - burn;
      ctx.strokeStyle = '#c9a66b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let u = 0; u <= f + 1e-6; u += 0.05) {
        const q = fuse(Math.min(u, f));
        if (u === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      const tip = fuse(f);
      ctx.fillStyle = '#ffe14a';
      starburst(tip.x, tip.y, 6 + rnd() * 5, 2.5, 6, rnd() * 6);
      ctx.fill();
      ctx.fillStyle = '#ff7a1a';
      for (let k = 0; k < 5; k++) ctx.fillRect(tip.x + (rnd() - 0.5) * 18, tip.y + (rnd() - 0.5) * 18, 2, 2);
      ctx.restore();
      return;
    }
    const age = r - boomAt;
    // smoke
    for (const s of smoke) {
      const k = clamp01(age / 800);
      ctx.fillStyle = `rgba(150,150,155,${0.5 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(bx + Math.cos(s.a) * age * s.v * 1.4, by + Math.sin(s.a) * age * s.v - age * 0.02, s.s * (0.5 + k * 1.4), 0, Math.PI * 2);
      ctx.fill();
    }
    // the letters are blown out from the bomb into place
    ctx.font = `${fs}px ${FONT}`;
    visible.forEach((c, i) => {
      const q = clamp01((age - (i % 7) * 15) / 700);
      if (q <= 0) return;
      const e = ease(q);
      ctx.save();
      ctx.translate(bx + (c.x + cw / 2 - bx) * e, by + (c.y - fs * 0.3 - by) * e);
      ctx.rotate((1 - q) * (i % 2 ? 6 : -6));
      ctx.scale(0.5 + 0.5 * e, 0.5 + 0.5 * e);
      ctx.fillStyle = q < 1 ? '#fff6c0' : '#e8fff4';
      ctx.shadowColor = 'rgba(255,170,60,.9)';
      ctx.shadowBlur = q < 1 ? 10 : 4;
      ctx.fillText(c.ch, -cw / 2, fs * 0.3);
      ctx.restore();
    });
    // the comic starburst
    const sb = 1 - clamp01((age - 250) / 350);
    if (sb > 0) {
      const grow = 70 + age * 0.3;
      ctx.globalAlpha = sb;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#222';
      ctx.fillStyle = '#ff5a1f';
      starburst(bx, by, grow, grow * 0.6, 12, 0.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffe14a';
      starburst(bx, by, grow * 0.75, grow * 0.45, 12, 0.2);
      ctx.fill();
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(-0.14);
      ctx.font = `italic bold ${Math.round(Math.min(26, grow * 0.3))}px serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#222';
      ctx.strokeText('KA-BOOM!', 0, 8);
      ctx.fillStyle = '#d4121a';
      ctx.fillText('KA-BOOM!', 0, 8);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    if (age < 220) {
      ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - age / 220)})`;
      ctx.fillRect(0, 0, W, H);
    }
  };

  // Hearts: lots of hearts drift up; each carries a letter into place and pops into little hearts.
  const heartPath = (x: number, y: number, s: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.6, y - s * 0.1, x - s * 0.7, y - s * 1.2, x, y - s * 0.4);
    ctx.bezierCurveTo(x + s * 0.7, y - s * 1.2, x + s * 1.6, y - s * 0.1, x, y + s * 0.9);
    ctx.closePath();
  };
  const bgHearts = Array.from({ length: 45 }, () => ({ x: rnd() * W, o: rnd() * (H + 60), vy: 0.03 + rnd() * 0.05, ph: rnd() * 6, s: 5 + rnd() * 9, h: 335 + Math.floor(rnd() * 25) }));
  const drawHearts = (r: number, t: number) => {
    clear();
    for (const b of bgHearts) {
      const y = H + 30 - ((t * b.vy + b.o) % (H + 60));
      ctx.fillStyle = `hsla(${b.h},85%,60%,.28)`;
      heartPath(b.x + Math.sin(t / 600 + b.ph) * 14, y, b.s);
      ctx.fill();
    }
    ctx.font = `${fs}px ${FONT}`;
    const hs = cw * 0.75;
    const settled: Cell[] = []; // arrived letters, drawn last so the popping hearts never cover them
    visible.forEach((c, i) => {
      const p = (r - c.lock) / HEART_RISE;
      if (p < 0) return;
      const k = Math.min(1, p);
      const x = c.x + cw / 2 + Math.sin(p * 6 + i) * 10 * (1 - k);
      const y = H + 20 + (c.y - fs * 0.3 - H - 20) * ease(k);
      if (p < 1) {
        ctx.fillStyle = `hsl(${340 + (i * 7) % 20},85%,58%)`;
        heartPath(x, y, hs);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(c.ch, x - cw / 2, y + fs * 0.3);
        return;
      }
      settled.push(c);
      const pop = ((p - 1) * HEART_RISE) / 350; // the heart bursts into little ones
      if (pop < 1) {
        for (let j = 0; j < 4; j++) {
          const a = (j / 4) * Math.PI * 2 + i;
          ctx.fillStyle = `rgba(255,90,140,${1 - pop})`;
          heartPath(c.x + cw / 2 + Math.cos(a) * pop * 14, c.y - fs * 0.3 + Math.sin(a) * pop * 14, 2.5);
          ctx.fill();
        }
      }
    });
    ctx.fillStyle = '#ffe8f0';
    ctx.shadowColor = 'rgba(255,90,140,.8)';
    ctx.shadowBlur = 6;
    for (const c of settled) ctx.fillText(c.ch, c.x, c.y);
    ctx.shadowBlur = 0;
    fadeToFinal(r);
  };

  // Flowers: a flower blooms around every letter until the whole stage is a garden.
  const petal = (x: number, y: number, rad: number, rot: number, hue: number, centre: string) => {
    ctx.fillStyle = `hsl(${hue},85%,78%)`;
    for (let k = 0; k < 6; k++) {
      const a = rot + (k / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * rad * 0.55, y + Math.sin(a) * rad * 0.55, rad * 0.5, rad * 0.28, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = centre;
    ctx.beginPath();
    ctx.arc(x, y, rad * 0.38, 0, Math.PI * 2);
    ctx.fill();
  };
  const stems = Array.from({ length: 14 }, (_, i) => ({ x: ((i + 0.5) / 14) * W + (rnd() - 0.5) * 16, hgt: 30 + rnd() * 40, h: Math.floor(rnd() * 360), ph: rnd() * 6 }));
  const drawFlowers = (r: number, t: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#16324a');
    sky.addColorStop(1, '#1f4a2c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    for (const s of stems) {
      const sway = Math.sin(t / 700 + s.ph) * 5;
      const grow = clamp01((t + 200) / 700);
      ctx.strokeStyle = '#3f9c4f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, H);
      ctx.quadraticCurveTo(s.x + sway * 0.4, H - s.hgt * grow * 0.5, s.x + sway, H - s.hgt * grow);
      ctx.stroke();
      petal(s.x + sway, H - s.hgt * grow, 9 * grow, t / 2000 + s.ph, s.h, '#ffd23f');
    }
    ctx.font = `${fs}px ${FONT}`;
    const open: Cell[] = []; // letters are drawn after all the petals so no flower covers a neighbour
    visible.forEach((c, i) => {
      const p = (r - c.lock) / BLOOM;
      if (p <= 0) return;
      const k = Math.min(1, p);
      const grow = 1 + 0.25 * Math.sin(k * Math.PI) * (k < 1 ? 1 : 0); // a little overshoot as it opens
      petal(c.x + cw / 2, c.y - fs * 0.3, cw * 0.85 * ease(k) * grow, i * 0.7 + k * 0.8, (i * 47) % 360, '#fff4b0');
      open.push(c);
    });
    ctx.fillStyle = '#3a1830';
    for (const c of open) ctx.fillText(c.ch, c.x, c.y);
    fadeToFinal(r);
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

  // ---- Minions, snow globe, rocket, lightning and helicopters ------------------------------------
  const wt = words.map((w, i) => ({ w, i, t0: Math.min(...w.cells.map((c) => c.lock)) }));
  const textLit = (c: Cell, color: string, glow: string, blur = 5, x = c.x, y = c.y, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.shadowColor = glow;
    ctx.shadowBlur = blur;
    ctx.fillText(c.ch, x, y);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  };
  const circ = (x: number, y: number, rad: number) => {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };

  // Minions: a little yellow helper runs in carrying a word, tosses it up into place, cheers and runs off.
  const RUNIN = 650;
  const THROW = 450;
  const minion = (x: number, gy: number, dir: number, ph: number, eyes: number, up: number, hop: number) => {
    ctx.save();
    ctx.translate(x, gy - hop);
    ctx.scale(dir * 0.95, 0.95);
    const sw = Math.sin(ph);
    ctx.fillStyle = '#1b1b1f';
    ctx.fillRect(-8 + sw * 2, -4, 7, 4);
    ctx.fillRect(1 - sw * 2, -4, 7, 4);
    ctx.fillStyle = '#ffd83a';
    ctx.beginPath();
    ctx.moveTo(-9, -4);
    ctx.lineTo(-9, -27);
    ctx.arc(0, -27, 9, Math.PI, 0);
    ctx.lineTo(9, -4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2f5fa8';
    ctx.fillRect(-9, -13, 18, 9);
    ctx.fillRect(-5, -17, 10, 5);
    ctx.strokeStyle = '#2f5fa8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, -17);
    ctx.lineTo(-9, -24);
    ctx.moveTo(5, -17);
    ctx.lineTo(9, -24);
    ctx.stroke();
    ctx.fillStyle = '#4a4a52';
    ctx.fillRect(-9, -30, 18, 4);
    const er = eyes === 1 ? 5.4 : 4.1;
    for (const ex of eyes === 1 ? [0] : [-4, 4]) {
      ctx.fillStyle = '#c9ced6';
      circ(ex, -28, er + 1.3);
      ctx.fillStyle = '#ffffff';
      circ(ex, -28, er);
      ctx.fillStyle = '#5a3a1a';
      circ(ex + 1, -28, er * 0.45);
      ctx.fillStyle = '#111111';
      circ(ex + 1.3, -28, er * 0.2);
    }
    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-3, -35.5);
    ctx.lineTo(-4, -40);
    ctx.moveTo(0, -36);
    ctx.lineTo(0, -41);
    ctx.moveTo(3, -35.5);
    ctx.lineTo(4, -40);
    ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(1, -21, 2.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = '#ffd83a';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const hx = (11 - 2 * up) * s;
      const hy = -6 - 27 * up + (1 - up) * sw * 2 * s;
      ctx.beginPath();
      ctx.moveTo(9 * s, -15);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = '#222222';
      circ(hx, hy, 2.2);
    }
    ctx.lineCap = 'butt';
    ctx.restore();
  };
  const drawMinions = (r: number, t: number) => {
    const gy = H - 12;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#16324a');
    bg.addColorStop(1, '#1d2f3c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.fillRect(0, gy + 2, W, H - gy);
    ctx.font = `${fs}px ${FONT}`;
    const settled: Cell[] = [];
    const carried: { c: Cell; x: number; y: number }[] = [];
    for (const { w, i, t0 } of wt) {
      const rr = r - t0;
      if (rr < 0) continue;
      const dirIn = i % 2 ? -1 : 1; // 1: runs in from the left
      const edge = dirIn > 0 ? -30 : W + 30;
      const eyes = i % 3 === 0 ? 1 : 2;
      const wy = gy - 52 - (i % 3) * 15; // carried words ride at three heights so they do not pile up
      if (rr < RUNIN) {
        const q = rr / RUNIN;
        const x = edge + (w.cx - edge) * (1 - Math.pow(1 - q, 2));
        const ph = rr / 70;
        minion(x, gy, dirIn, ph, eyes, 1, Math.abs(Math.sin(ph)) * 2.5);
        for (const c of w.cells) carried.push({ c, x: c.x + (x - w.cx), y: wy });
      } else if (rr < RUNIN + THROW) {
        const p = (rr - RUNIN) / THROW;
        minion(w.cx, gy, dirIn, 0, eyes, 1 - p, Math.sin(p * Math.PI) * 6);
        for (const c of w.cells) carried.push({ c, x: c.x, y: wy + (c.y - wy) * ease(p) - Math.sin(p * Math.PI) * 18 });
      } else {
        settled.push(...w.cells);
        const e = rr - RUNIN - THROW;
        if (e < 150) minion(w.cx, gy, dirIn, 0, eyes, 1, Math.abs(Math.sin((e / 150) * Math.PI)) * 7);
        else if (e < 700) {
          const q = (e - 150) / 550;
          const target = dirIn > 0 ? W + 30 : -30;
          minion(w.cx + (target - w.cx) * q * q, gy, dirIn, e / 70, eyes, 0, Math.abs(Math.sin(e / 70)) * 2.5);
        }
      }
    }
    for (const k of carried) textLit(k.c, '#fff3b0', 'rgba(255,216,58,.7)', 6, k.x, k.y);
    for (const c of settled) textLit(c, '#fff3b0', 'rgba(255,216,58,.5)', 4);
    fadeToFinal(r);
  };

  // Snow globe: shaken, the snow swirls, then settles and the writing appears under it.
  const globeFlakes = Array.from({ length: 150 }, () => ({ x: rnd() * W, y: rnd() * H, s: 1 + rnd() * 2.4, ph: rnd() * 6, v: 0.25 + rnd() * 0.6 }));
  const drawSnowglobe = (r: number, t: number) => {
    const settle = clamp01(r / (T_RES - 700));
    const shake = 1 - settle;
    const jolt = Math.max(0, 1 - t / (T_INTRO + 500));
    ctx.save();
    ctx.translate(Math.sin(t / 22) * 6 * jolt, Math.cos(t / 27) * 4 * jolt);
    const bg = ctx.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.5, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#1d3f6e');
    bg.addColorStop(1, '#0a1530');
    ctx.fillStyle = bg;
    ctx.fillRect(-10, -10, W + 20, H + 20);
    const gh = 14 + 26 * settle;
    ctx.fillStyle = '#e8f1fb';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H - gh);
    ctx.quadraticCurveTo(W / 2, H - gh - 14, W, H - gh);
    ctx.lineTo(W, H);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (const f of globeFlakes) {
      const y = (((f.y + t * 0.04 * f.v + Math.cos(t / 260 + f.ph) * 70 * shake) % H) + H) % H;
      const x = (((f.x + Math.sin(t / 340 + f.ph) * (14 + 70 * shake)) % W) + W) % W;
      circ(x, y, f.s);
    }
    ctx.font = `${fs}px ${FONT}`;
    for (const c of visible) textLit(c, '#f4fbff', 'rgba(160,210,255,.9)', 6, c.x, c.y, clamp01((r - c.lock) / 600));
    ctx.restore();
    fadeToFinal(r);
  };

  // Rocket: it skywrites the message, one letter at a time, trailing rocketSmoke.
  const nightStars = Array.from({ length: 50 }, () => ({ x: rnd() * W, y: rnd() * H, s: 0.5 + rnd() * 1.3, p: rnd() * 6 }));
  const rocketSmoke: { x: number; y: number; t0: number }[] = [];
  let rvx = 1;
  let rvy = 0;
  const rocketPos = (r: number) => {
    if (!visible.length) return { x: W / 2, y: H / 2 };
    if (r < 0) {
      const q = ease((r + T_INTRO) / T_INTRO);
      return { x: -50 + (visible[0].x - 6 + 50) * q, y: visible[0].y - fs * 0.3 };
    }
    const k = Math.max(0, latest(r));
    const cur = visible[k];
    const nxt = visible[k + 1];
    if (!nxt) {
      const d = Math.max(0, r - typeAt[k]);
      return { x: cur.x + cw / 2 + d * 0.9, y: cur.y - fs * 0.3 - d * 0.25 };
    }
    const f = clamp01((r - typeAt[k]) / Math.max(1, typeAt[k + 1] - typeAt[k]));
    return { x: cur.x + cw / 2 + (nxt.x - cur.x) * f, y: cur.y - fs * 0.3 + (nxt.y - cur.y) * f };
  };
  const drawRocket = (r: number, t: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#050a18');
    sky.addColorStop(1, '#14264a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    for (const s of nightStars) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.4 * Math.sin(t / 400 + s.p)})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    const p = rocketPos(r);
    const q = rocketPos(r - 40);
    rvx += (p.x - q.x - rvx) * 0.25;
    rvy += (p.y - q.y - rvy) * 0.25;
    const ang = Math.hypot(rvx, rvy) > 0.2 ? Math.atan2(rvy, rvx) : 0;
    rocketSmoke.push({ x: p.x - Math.cos(ang) * 30, y: p.y - Math.sin(ang) * 30, t0: t });
    if (rocketSmoke.length > 140) rocketSmoke.shift();
    for (const s of rocketSmoke) {
      const age = t - s.t0;
      const a = 0.4 * (1 - age / 1000);
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(220,225,235,${a})`;
      circ(s.x, s.y - age * 0.01, 3 + age / 110);
    }
    ctx.font = `${fs}px ${FONT}`;
    visible.forEach((c, i) => {
      if (r < typeAt[i]) return;
      const fresh = r - typeAt[i] < 260;
      textLit(c, fresh ? '#ffe2b0' : '#eaf6ff', fresh ? 'rgba(255,170,60,.9)' : 'rgba(120,180,255,.6)', fresh ? 12 : 5);
    });
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    ctx.scale(0.85, 0.85);
    const fl = 9 + 6 * Math.sin(t / 40);
    ctx.fillStyle = '#ffb02e';
    ctx.beginPath();
    ctx.moveTo(-34, -3);
    ctx.lineTo(-34 - fl, 0);
    ctx.lineTo(-34, 3);
    ctx.fill();
    ctx.fillStyle = '#e0443a';
    ctx.beginPath();
    ctx.moveTo(-34, -4.5);
    ctx.lineTo(-40, -10);
    ctx.lineTo(-24, -4.5);
    ctx.moveTo(-34, 4.5);
    ctx.lineTo(-40, 10);
    ctx.lineTo(-24, 4.5);
    ctx.fill();
    ctx.fillStyle = '#f3f6fa';
    ctx.fillRect(-34, -4.5, 24, 9);
    ctx.fillStyle = '#e0443a';
    ctx.beginPath();
    ctx.moveTo(-10, -4.5);
    ctx.lineTo(0, 0);
    ctx.lineTo(-10, 4.5);
    ctx.fill();
    ctx.fillStyle = '#7fc4ff';
    circ(-19, 0, 2.6);
    ctx.restore();
    fadeToFinal(r);
  };

  // Lightning: a storm; each flash lights up part of the message.
  const FLS = 5;
  const makeBolt = (x0: number, yEnd: number) => {
    const pts: [number, number][] = [[x0, 0]];
    let x = x0;
    let y = 0;
    while (y < yEnd) {
      y += 14 + rnd() * 16;
      x += (rnd() - 0.5) * 34;
      pts.push([x, y]);
    }
    return pts;
  };
  const flashes = [{ at: -250, bolt: makeBolt(W * 0.8, H * 0.5) }, ...Array.from({ length: FLS }, (_, i) => ({ at: 250 + i * 600, bolt: makeBolt(W * (0.12 + rnd() * 0.76), H * (0.45 + rnd() * 0.4)) }))];
  const rainDrops = Array.from({ length: 90 }, () => ({ x: rnd() * W, y: rnd() * H, l: 8 + rnd() * 10, v: 0.6 + rnd() * 0.5 }));
  const groupOf = (i: number) => Math.min(FLS - 1, Math.floor((i / Math.max(1, visible.length)) * FLS));
  const drawStorm = (r: number, t: number) => {
    let f = 0;
    for (const s of flashes) {
      if (r >= s.at) f = Math.max(f, Math.exp(-(r - s.at) / 120));
      if (r >= s.at + 170) f = Math.max(f, 0.5 * Math.exp(-(r - s.at - 170) / 90));
    }
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `rgb(${10 + f * 90},${14 + f * 100},${28 + f * 120})`);
    sky.addColorStop(1, `rgb(${6 + f * 40},${9 + f * 44},${16 + f * 60})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = `rgba(${30 + f * 150},${36 + f * 160},${60 + f * 170},.9)`;
    for (let x = -20; x < W + 40; x += 70) {
      ctx.beginPath();
      ctx.ellipse(x, 6, 55, 26 + ((x * 7) % 11), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(170,190,230,.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of rainDrops) {
      const y = (d.y + t * d.v * 0.9) % H;
      const x = (d.x - t * 0.12 * d.v + W * 4) % W;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + d.l);
    }
    ctx.stroke();
    for (const s of flashes) {
      const age = r - s.at;
      if (age < 0 || age > 200) continue;
      ctx.strokeStyle = `rgba(235,245,255,${1 - age / 200})`;
      ctx.shadowColor = '#9cf';
      ctx.shadowBlur = 14;
      ctx.lineWidth = 3;
      ctx.beginPath();
      s.bolt.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.font = `${fs}px ${FONT}`;
    visible.forEach((c, i) => {
      if (r >= flashes[1 + groupOf(i)].at) textLit(c, '#d4e3ff', 'rgba(150,190,255,.9)', 3 + 14 * f);
    });
    if (f > 0.02) {
      ctx.fillStyle = `rgba(200,220,255,${f * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    fadeToFinal(r);
  };

  // Helicopters: each word is slung under a helicopter, flown over its spot and lowered into place.
  const IN = 750;
  const LOW = 550;
  const HOLD = 150;
  const heli = (x: number, y: number, dir: number, t: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.fillStyle = '#4d6a3f';
    ctx.beginPath();
    ctx.moveTo(-14, -4);
    ctx.lineTo(-46, -8);
    ctx.lineTo(-46, -3);
    ctx.lineTo(-14, 5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-46, -8);
    ctx.lineTo(-52, -17);
    ctx.lineTo(-43, -8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5b7a4a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#bfe6ff';
    ctx.beginPath();
    ctx.ellipse(10, -2, 9, 6, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-16, 17);
    ctx.lineTo(18, 17);
    ctx.moveTo(-8, 11);
    ctx.lineTo(-10, 17);
    ctx.moveTo(8, 11);
    ctx.lineTo(10, 17);
    ctx.moveTo(0, -12);
    ctx.lineTo(0, -18);
    ctx.stroke();
    const bl = 8 + 34 * Math.abs(Math.cos(t / 38));
    ctx.strokeStyle = 'rgba(210,220,230,.9)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-bl, -18);
    ctx.lineTo(bl, -18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(200,210,220,.12)';
    ctx.beginPath();
    ctx.ellipse(0, -18, 38, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    const tb = 3 + 7 * Math.abs(Math.sin(t / 30));
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(210,220,230,.9)';
    ctx.beginPath();
    ctx.moveTo(-48, -9 - tb);
    ctx.lineTo(-48, -9 + tb);
    ctx.stroke();
    ctx.restore();
  };
  // One helicopter per line of text; it hovers over the left or right of the line and slings the whole line.
  const heliLines = lineYs.map((y, k) => {
    const cs = visible.filter((c) => c.y === y);
    const x0 = cs[0].x;
    const x1 = cs[cs.length - 1].x + cw;
    return { w: { cells: cs, x0, x1, cx: x0 + (x1 - x0) * (k % 2 ? 0.3 : 0.7) }, i: k, t0: k * HELI_GAP };
  });
  const heliClouds = Array.from({ length: 6 }, () => ({ x: rnd() * W, y: H * (0.2 + rnd() * 0.6), s: 24 + rnd() * 40 }));
  const drawHelis = (r: number, t: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#27486b');
    sky.addColorStop(1, `rgb(${BG})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    for (const k of heliClouds) {
      const x = (((k.x - t * 0.03) % (W + 120)) + W + 120) % (W + 120) - 60;
      ctx.beginPath();
      ctx.ellipse(x, k.y, k.s, k.s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `${fs}px ${FONT}`;
    const hanging: { c: Cell; x: number; y: number }[] = [];
    const settled: Cell[] = [];
    for (const { w, i, t0 } of heliLines) {
      const rr = r - t0;
      if (rr < 0) continue;
      const dirIn = i % 2 ? -1 : 1;
      const edge = dirIn > 0 ? -70 : W + 70;
      const hy = Math.max(26, w.cells[0].y - 74);
      const hang = hy + 52;
      let hx = w.cx;
      let hyy = hy + Math.sin(t / 160 + i) * 2;
      let ropes = true;
      if (rr < IN) {
        const q = rr / IN;
        hx = edge + (w.cx - edge) * (1 - Math.pow(1 - q, 2));
      } else if (rr >= IN + LOW) {
        settled.push(...w.cells);
        const e = rr - IN - LOW;
        if (e >= HOLD) {
          ropes = false;
          const q = (e - HOLD) / (AIR_T - IN - LOW - HOLD);
          if (q >= 1) continue;
          const target = dirIn > 0 ? W + 80 : -80;
          hx = w.cx + (target - w.cx) * q * q;
          hyy = hy - 30 * q;
        }
      }
      const p = rr < IN ? 0 : clamp01((rr - IN) / LOW);
      const ox = hx - w.cx;
      const lowered = (cy: number) => hang + (cy - hang) * ease(p);
      if (ropes) {
        const top = lowered(w.cells[0].y) - fs + 2;
        ctx.strokeStyle = '#d9c9a0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(hx - 7, hyy + 17);
        ctx.lineTo(w.x0 + ox, top);
        ctx.moveTo(hx + 7, hyy + 17);
        ctx.lineTo(w.x1 + ox, top);
        ctx.stroke();
      }
      heli(hx, hyy, dirIn, t);
      if (rr < IN + LOW) for (const c of w.cells) hanging.push({ c, x: c.x + ox, y: lowered(c.y) });
    }
    for (const k of hanging) textLit(k.c, '#fff3d8', 'rgba(255,220,150,.6)', 5, k.x, k.y);
    for (const c of settled) textLit(c, '#fff3d8', 'rgba(255,220,150,.45)', 4);
    fadeToFinal(r);
  };
  // Banner plane: a plane tows a banner carrying the message across the sky and leaves it hanging in place.
  const bPad = 12;
  const bx0 = Math.min(...visible.map((c) => c.x)) - bPad;
  const bx1 = Math.max(...visible.map((c) => c.x + cw)) + bPad;
  const by0 = Math.min(...visible.map((c) => c.y)) - fs - 4;
  const by1 = Math.max(...visible.map((c) => c.y)) + 8;
  const bPlaneY = Math.max(26, by0 - 46);
  const towPlane = (x: number, y: number, t: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1); // drawn facing right, flown facing left
    ctx.fillStyle = '#d23b3b';
    ctx.beginPath();
    ctx.moveTo(-26, -1);
    ctx.lineTo(-32, -13);
    ctx.lineTo(-19, -2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-24, 1, 8, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, 27, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.ellipse(0, 2.5, 23, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#bfe6ff';
    ctx.beginPath();
    ctx.ellipse(5, -6, 7, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b32e2e';
    ctx.beginPath();
    ctx.ellipse(-2, 5, 15, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(8, 12);
    ctx.stroke();
    ctx.fillStyle = '#2a2a2a';
    circ(8, 13, 2.6);
    const bl = 3 + 11 * Math.abs(Math.sin(t / 22));
    ctx.strokeStyle = 'rgba(225,225,225,.9)';
    ctx.beginPath();
    ctx.moveTo(28, -bl);
    ctx.lineTo(28, bl);
    ctx.stroke();
    ctx.restore();
  };
  const bannerClouds = Array.from({ length: 6 }, () => ({ x: rnd() * W, y: H * (0.2 + rnd() * 0.6), s: 24 + rnd() * 40 }));
  const drawBanner = (r: number, t: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2d5b87');
    sky.addColorStop(1, `rgb(${BG})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    for (const k of bannerClouds) {
      const x = (((k.x - t * 0.03) % (W + 120)) + W + 120) % (W + 120) - 60;
      ctx.beginPath();
      ctx.ellipse(x, k.y, k.s, k.s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const q = clamp01((r + T_INTRO) / (T_INTRO + BANNER_T));
    const px = W + 70 + (bx0 - 80 - (W + 70)) * (1 - Math.pow(1 - q, 2.2));
    const gone = clamp01((r - BANNER_T) / 600); // once the banner is home the plane climbs away
    const planeX = px - gone * 160;
    const planeY = bPlaneY - gone * 90;
    const damp = 1 - 0.85 * clamp01((r - BANNER_T + 300) / 600);
    const bL = px + 80;
    const ox = bL - bx0;
    const bw = bx1 - bx0;
    const wv = (x: number) => 7 * damp * (0.15 + 0.85 * clamp01((x - bL) / bw)) * Math.sin((x - bL) * 0.05 - t * 0.012);
    if (gone < 1) {
      ctx.strokeStyle = `rgba(217,207,168,${1 - gone})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(planeX + 30, planeY + 3);
      ctx.lineTo(bL, by0 + wv(bL));
      ctx.moveTo(planeX + 30, planeY + 3);
      ctx.lineTo(bL, by1 + wv(bL));
      ctx.stroke();
    }
    const cloth = () => {
      ctx.beginPath();
      ctx.moveTo(bL, by0 + wv(bL));
      for (let x = bL + 6; x < bL + bw; x += 6) ctx.lineTo(x, by0 + wv(x));
      ctx.lineTo(bL + bw, by0 + wv(bL + bw));
      ctx.lineTo(bL + bw, by1 + wv(bL + bw));
      for (let x = bL + bw - 6; x > bL; x -= 6) ctx.lineTo(x, by1 + wv(x));
      ctx.lineTo(bL, by1 + wv(bL));
      ctx.closePath();
    };
    ctx.save();
    cloth();
    ctx.clip();
    ctx.fillStyle = '#f6f0dc';
    ctx.fillRect(bL - 2, by0 - 12, bw + 4, by1 - by0 + 24);
    for (let x = bL; x < bL + bw; x += 6) {
      const s = Math.cos((x - bL) * 0.05 - t * 0.012);
      ctx.fillStyle = s > 0 ? `rgba(255,255,255,${0.25 * s * damp})` : `rgba(80,60,20,${-0.12 * s * damp})`;
      ctx.fillRect(x, by0 - 12, 6, by1 - by0 + 24);
    }
    ctx.font = `${fs}px ${FONT}`;
    ctx.fillStyle = '#7a1424';
    for (const c of visible) ctx.fillText(c.ch, c.x + ox, c.y + wv(c.x + ox));
    ctx.restore();
    cloth();
    ctx.strokeStyle = '#b83a3a';
    ctx.lineWidth = 2;
    ctx.stroke();
    towPlane(planeX, planeY, t);
    fadeToFinal(r);
  };

  // Balloons: a bunch floats up with a letter behind each; they pop one by one to show the message.
  const balloons = visible.map((c, i) => ({ c, hue: (i * 47 + rnd() * 30) % 360, rs: -T_INTRO + rnd() * 400, ph: rnd() * 6 }));
  const drawBalloons = (r: number, t: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1b2c4f');
    sky.addColorStop(1, '#2a1f4a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    const rad = cw * 0.95;
    const letters: Cell[] = [];
    for (const b of balloons) {
      const pt = b.c.lock + BAL_POP;
      const cx0 = b.c.x + cw / 2;
      const cy0 = b.c.y - fs * 0.3;
      if (r >= pt) {
        letters.push(b.c);
        const a = (r - pt) / BAL_SHRED;
        if (a < 1) {
          if (a < 0.18) {
            ctx.fillStyle = `rgba(255,240,160,${1 - a / 0.18})`;
            ctx.beginPath();
            for (let k = 0; k < 10; k++) {
              const ang = (k / 10) * Math.PI * 2;
              const rr = (k % 2 ? rad * 0.6 : rad * 1.5) * (0.5 + a * 4);
              ctx.lineTo(cx0 + Math.cos(ang) * rr, cy0 + Math.sin(ang) * rr);
            }
            ctx.closePath();
            ctx.fill();
          }
          for (let k = 0; k < 6; k++) {
            const ang = (k / 6) * Math.PI * 2 + b.ph;
            const d = a * 22;
            ctx.fillStyle = `hsla(${b.hue},80%,60%,${1 - a})`;
            circ(cx0 + Math.cos(ang) * d, cy0 + Math.sin(ang) * d + a * a * 14, 2.2 * (1 - a * 0.5));
          }
        }
        continue;
      }
      if (r < b.rs) continue;
      const rise = clamp01((r - b.rs) / 900);
      const y = H + 40 + (cy0 - (H + 40)) * ease(rise) + Math.sin(t / 500 + b.ph) * 2 * rise;
      const x = cx0 + Math.sin(t / 700 + b.ph) * 1.5;
      const sw = 1 + 0.25 * clamp01((r - (pt - 160)) / 160); // it swells just before it pops
      const ry = rad * 1.18 * sw;
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + ry);
      ctx.quadraticCurveTo(x + 5, y + ry + 9, x - 2, y + ry + 18);
      ctx.stroke();
      ctx.fillStyle = `hsl(${b.hue},78%,58%)`;
      ctx.beginPath();
      ctx.ellipse(x, y, rad * sw, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 2, y + ry - 1);
      ctx.lineTo(x + 2, y + ry - 1);
      ctx.lineTo(x, y + ry + 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.beginPath();
      ctx.ellipse(x - rad * 0.35 * sw, y - rad * 0.4 * sw, rad * 0.2, rad * 0.32, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `${fs}px ${FONT}`;
    for (const c of letters) textLit(c, '#fff6d0', 'rgba(255,200,90,.7)', 6);
    fadeToFinal(r);
  };
  // Quill: a feather pen rises out of an ink pot and writes the message in cursive on parchment.
  const QFONT = (px: number) => `italic ${px}px 'Segoe Script','Snell Roundhand','Brush Script MT','Lucida Handwriting','Apple Chancery',cursive`;
  const qLines = lineYs.map((y) => {
    const first = visible.findIndex((c) => c.y === y);
    let last = first;
    for (let i = first; i < visible.length && visible[i].y === y; i++) last = i;
    return { y, text: cells.filter((c) => c.y === y).map((c) => c.ch).join(''), t0: typeAt[first], t1: typeAt[last] + perChar, w: 0, x0: 0 };
  });
  let qs = fs * 1.3;
  ctx.font = QFONT(qs);
  const qWidest = Math.max(1, ...qLines.map((l) => ctx.measureText(l.text).width));
  if (qWidest > W - pad * 2) qs *= (W - pad * 2) / qWidest;
  ctx.font = QFONT(qs);
  for (const l of qLines) {
    l.w = ctx.measureText(l.text).width;
    l.x0 = (W - l.w) / 2;
  }
  const potX = W - 56;
  const potY = H - 22;
  const mouth = { x: potX - 2, y: potY - 36 };
  const nibAt = (l: { y: number }, x: number) => ({ x, y: l.y - qs * 0.2 });
  const penAt = (r: number) => {
    const first = qLines[0];
    if (r < 0) {
      const e = ease((r + T_INTRO) / T_INTRO);
      const s = nibAt(first, first.x0);
      return { x: mouth.x + (s.x - mouth.x) * e, y: mouth.y + (s.y - mouth.y) * e - 60 * Math.sin(Math.PI * e) };
    }
    let k = 0;
    qLines.forEach((l, i) => {
      if (r >= l.t0) k = i;
    });
    const l = qLines[k];
    if (r <= l.t1) {
      const f = clamp01((r - l.t0) / Math.max(1, l.t1 - l.t0));
      const n = nibAt(l, l.x0 + l.w * f);
      return { x: n.x, y: n.y + Math.sin(r / 55) * 2.5 };
    }
    const a = nibAt(l, l.x0 + l.w);
    const nx = qLines[k + 1];
    if (nx) {
      const b = nibAt(nx, nx.x0);
      const f = ease((r - l.t1) / Math.max(1, nx.t0 - l.t1));
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f - 14 * Math.sin(Math.PI * f) };
    }
    const f = ease((r - l.t1) / 500);
    return { x: a.x + (mouth.x - a.x) * f, y: a.y + (mouth.y - a.y) * f - 40 * Math.sin(Math.PI * f) };
  };
  const drawQuill = (r: number, t: number) => {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#efe0b8');
    bg.addColorStop(1, '#dcc48c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(90,60,20,0)');
    vg.addColorStop(1, 'rgba(90,60,20,.3)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#24180c';
    for (const l of qLines) {
      const p = r < l.t0 ? 0 : clamp01((r - l.t0) / Math.max(1, l.t1 - l.t0));
      if (p <= 0) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(l.x0 - 6, l.y - qs * 1.4, l.w * p + (p >= 1 ? 24 : 2), qs * 2);
      ctx.clip();
      ctx.font = QFONT(qs);
      ctx.fillText(l.text, l.x0, l.y);
      ctx.restore();
    }
    // the ink pot
    ctx.fillStyle = '#1d2b3a';
    ctx.beginPath();
    ctx.moveTo(potX - 24, potY);
    ctx.lineTo(potX - 24, potY - 22);
    ctx.quadraticCurveTo(potX - 24, potY - 30, potX - 12, potY - 31);
    ctx.lineTo(potX + 12, potY - 31);
    ctx.quadraticCurveTo(potX + 24, potY - 30, potX + 24, potY - 22);
    ctx.lineTo(potX + 24, potY);
    ctx.quadraticCurveTo(potX, potY + 8, potX - 24, potY);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,200,240,.25)';
    ctx.beginPath();
    ctx.ellipse(potX - 15, potY - 14, 3, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#050708';
    ctx.beginPath();
    ctx.ellipse(potX, potY - 33, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // the quill itself
    const p = penAt(r);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-0.08 + Math.sin(t / 380) * 0.02);
    ctx.fillStyle = '#f7f3e8';
    ctx.strokeStyle = '#a79f8c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(5, -14);
    ctx.bezierCurveTo(-26, -52, -10, -102, 62, -132);
    ctx.bezierCurveTo(48, -98, 42, -56, 5, -14);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let k = 1; k < 8; k++) {
      const f = k / 8;
      const sx = 62 * f;
      const sy = -132 * f;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - 16 * Math.sin(f * 3), sy + 9);
    }
    ctx.stroke();
    ctx.strokeStyle = '#7d725d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(62, -132);
    ctx.stroke();
    ctx.fillStyle = '#24180c';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(4, -10);
    ctx.lineTo(-3, -9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    fadeToFinal(r);
  };

  // Dominoes: a row of tiles stands over the writing and topples in a chain, uncovering each letter.
  const domH = fs * 1.1;
  const domW = cw * 0.72;
  const drawDominoes = (r: number) => {
    clear();
    ctx.font = `${fs}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    for (const y of lineYs) ctx.fillRect(pad / 2, y + 3, W - pad, 1);
    visible.forEach((c, i) => {
      const appear = clamp01((r + T_INTRO - (i / visible.length) * (T_INTRO - 150)) / 150);
      if (appear <= 0) return;
      const fall = clamp01((r - typeAt[i]) / 170);
      ctx.save();
      ctx.globalAlpha = appear;
      ctx.translate(c.x + cw / 2 + domW / 2, c.y + 3);
      ctx.rotate(fall * (Math.PI / 2 - 0.05));
      ctx.fillStyle = `hsl(${(i * 23) % 360},65%,46%)`;
      ctx.fillRect(-domW, -domH, domW, domH);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillRect(-domW, -domH * 0.55, domW, 1.2);
      ctx.restore();
    });
    visible.forEach((c, i) => {
      const age = r - typeAt[i] - 60;
      if (age < 0) return;
      textLit(c, age < 250 ? '#ffffff' : '#e8fff4', 'rgba(80,255,190,.6)', age < 250 ? 10 : 5);
    });
    fadeToFinal(r);
  };

  // Treasure chest: the lid creaks open and gold coins fly out, each landing as a letter.
  const chX = W / 2;
  const chY = H - 16;
  const chH = 34;
  const coinFrom = { x: chX, y: chY - chH - 8 };
  const drawTreasure = (r: number, t: number) => {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0e1a26');
    bg.addColorStop(1, '#1a2530');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const open = ease((r + T_INTRO) / T_INTRO);
    const glow = ctx.createRadialGradient(chX, chY - chH, 4, chX, chY - chH, 90);
    glow.addColorStop(0, `rgba(255,214,90,${0.55 * open})`);
    glow.addColorStop(1, 'rgba(255,214,90,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(chX - 35, chY - chH, 70, chH);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    for (let k = 1; k < 4; k++) ctx.fillRect(chX - 35, chY - chH + k * (chH / 4), 70, 1);
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(chX - 36, chY - chH, 72, 4);
    ctx.fillRect(chX - 26, chY - chH, 5, chH);
    ctx.fillRect(chX + 21, chY - chH, 5, chH);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(chX - 8, chY - chH + 8, 16, 9);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.ellipse(chX, chY - chH + 1, 30, 5 * open, 0, 0, Math.PI * 2);
    ctx.fill();
    const lidY = chY - chH - 16 - open * 26;
    ctx.fillStyle = open > 0.5 ? '#4a1a14' : '#7a4f2a';
    ctx.fillRect(chX - (35 - open * 5), lidY, 70 - open * 10, 16);
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(chX - (36 - open * 5), lidY, 72 - open * 10, 3);
    ctx.font = `${fs}px ${FONT}`;
    const landed: Cell[] = [];
    for (const c of visible) {
      const q = (r - c.lock) / COIN_T;
      if (q < 0) continue;
      const tx = c.x + cw / 2;
      const ty = c.y - fs * 0.3;
      if (q >= 1) {
        landed.push(c);
        const a = (q - 1) * COIN_T;
        if (a < 260) {
          ctx.fillStyle = `rgba(255,224,120,${0.6 * (1 - a / 260)})`;
          circ(tx, ty, 4 + a / 26);
        }
        continue;
      }
      const e = q * q * (3 - 2 * q);
      const x = coinFrom.x + (tx - coinFrom.x) * e;
      const y = coinFrom.y + (ty - coinFrom.y) * e - (50 + Math.abs(tx - coinFrom.x) * 0.15) * 4 * q * (1 - q);
      const sq = Math.max(0.15, Math.abs(Math.cos(q * 14 + c.x)));
      ctx.fillStyle = '#b8870b';
      ctx.beginPath();
      ctx.ellipse(x, y, 5 * sq + 0.8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.ellipse(x, y, 4 * sq, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const c of landed) textLit(c, r - c.lock - COIN_T < 260 ? '#ffe59a' : '#e8fff4', 'rgba(255,200,80,.7)', 6);
    fadeToFinal(r);
    void t;
  };

  // Paper planes: each word is folded into a plane that glides in, lands on its spot and unfolds into the word.
  const ppStart = wt.map(() => 16 + rnd() * H * 0.4);
  const planePos = (i: number, w: { cx: number; cells: Cell[] }, q: number) => {
    const sx = i % 2 ? W + 30 : -30;
    const ex = w.cx;
    const ey = w.cells[0].y - fs * 0.3;
    const e = q * q * (3 - 2 * q);
    return { x: sx + (ex - sx) * e, y: ppStart[i] + (ey - ppStart[i]) * e + Math.sin(q * Math.PI * 2) * 20 * (1 - q) };
  };
  const drawPlanes = (r: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#223a5c');
    sky.addColorStop(1, `rgb(${BG})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.font = `${fs}px ${FONT}`;
    const shown: Cell[] = [];
    const FLY_T = PP_T - 200;
    for (const { w, i, t0 } of wt) {
      const rr = r - t0;
      if (rr < 0) continue;
      if (rr >= FLY_T) {
        shown.push(...w.cells);
        const a = (rr - FLY_T) / 200;
        if (a < 1) {
          ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - a)})`;
          ctx.beginPath();
          ctx.ellipse(w.cx, w.cells[0].y - fs * 0.3, (w.x1 - w.x0) / 2 + 6 * a, 10 + 8 * a, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      const q = rr / FLY_T;
      for (let k = 6; k >= 1; k--) {
        const pq = q - k * 0.035;
        if (pq < 0) continue;
        const tp = planePos(i, w, pq);
        ctx.fillStyle = `rgba(255,255,255,${0.35 - k * 0.05})`;
        circ(tp.x, tp.y, 1.6);
      }
      const p = planePos(i, w, q);
      const n = planePos(i, w, Math.min(1, q + 0.02));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(n.y - p.y, n.x - p.x));
      ctx.fillStyle = '#f4f4f8';
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-10, -7);
      ctx.lineTo(-2, 0);
      ctx.fill();
      ctx.fillStyle = '#c4c8d6';
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-10, 5);
      ctx.lineTo(-2, 0);
      ctx.fill();
      ctx.restore();
    }
    for (const c of shown) textLit(c, '#f4f8ff', 'rgba(150,200,255,.7)', 5);
    fadeToFinal(r);
  };
  // Ghostly letters: pale sheets drift through a moonlit mist and each letter materialises out of it, shivering, then settles.
  const ghostSheet = (x: number, y: number, sz: number, ph: number, alpha: number, dir: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir * sz, sz);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#dff3ff';
    ctx.shadowColor = 'rgba(160,220,255,.8)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(-18, 22);
    ctx.quadraticCurveTo(-20, -22, 0, -22);
    ctx.quadraticCurveTo(20, -22, 18, 22);
    for (let k = 0; k < 4; k++) {
      const x1 = 18 - (k + 0.5) * 9;
      ctx.quadraticCurveTo(x1 + 2, 22 + (k % 2 ? 7 : -3) + Math.sin(ph + k) * 3, 18 - (k + 1) * 9, 22);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#16233a';
    ctx.beginPath();
    ctx.ellipse(-6, -8, 3, 5, 0, 0, Math.PI * 2);
    ctx.ellipse(6, -8, 3, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 4, 3.5, 5 + Math.sin(ph) * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  };
  const ghosts = [0, 1, 2].map((k) => ({ y: H * (0.2 + 0.3 * k) + rnd() * 20, sp: 0.045 + rnd() * 0.03, off: rnd() * W, sz: 0.9 + rnd() * 0.5 }));
  const drawGhosts = (r: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0e1a30');
    sky.addColorStop(1, `rgb(${BG})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(235,245,255,.9)';
    circ(W * 0.86, H * 0.16, 16);
    for (let k = 0; k < 4; k++) {
      const fx = ((k * 0.31 + r * 0.00004 * (k + 1)) % 1.4) * W - W * 0.2;
      const g = ctx.createRadialGradient(fx, H * (0.25 + 0.2 * k), 5, fx, H * (0.25 + 0.2 * k), W * 0.3);
      g.addColorStop(0, 'rgba(170,200,230,.13)');
      g.addColorStop(1, 'rgba(170,200,230,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    const fade = r > T_RES - 300 ? Math.max(0, 1 - (r - T_RES + 300) / 300) : 1;
    ghosts.forEach((g, k) => {
      const span = W + 120;
      const gx = (((g.off + (r + T_INTRO) * g.sp * (k % 2 ? -1 : 1)) % span) + span) % span - 60;
      ghostSheet(gx, g.y + Math.sin(r / 400 + k * 2) * 12, g.sz, r / 200 + k, 0.28 * fade, k % 2 ? -1 : 1);
    });
    ctx.font = `${fs}px ${FONT}`;
    for (const c of visible) {
      const rr = r - c.lock;
      if (rr < 0) continue;
      const q = Math.min(1, rr / GHOST_T);
      const flick = q < 1 ? 0.65 + 0.35 * Math.sin(rr / 55 + c.x) : 1;
      const wob = Math.sin(rr / 90 + c.x * 0.37) * (1 - q) * 4;
      const rise = (1 - ease(q)) * 16;
      if (q < 1) textLit(c, '#bfe4ff', 'rgba(150,210,255,.6)', 10, c.x + wob * 1.6, c.y + rise + 10, 0.22 * q * flick);
      textLit(c, '#e6f6ff', 'rgba(150,220,255,.85)', 8 + (1 - q) * 6, c.x + wob, c.y + rise, Math.min(1, (0.15 + q) * flick));
    }
    fadeToFinal(r);
  };
  const special: Partial<Record<RevealStyle, (r: number, t: number) => void>> = {
    minions: drawMinions,
    snowglobe: drawSnowglobe,
    rocket: drawRocket,
    lightning: drawStorm,
    helicopters: drawHelis,
    banner: drawBanner,
    balloons: drawBalloons,
    quill: drawQuill,
    dominoes: drawDominoes,
    treasure: drawTreasure,
    paperplanes: drawPlanes,
    ghosts: drawGhosts,
  };

  const frame = (now: number) => {
    const t = now - t0;
    if (skipped || t >= T_END) {
      drawFinal();
      resolveDone();
      return;
    }
    const r = t - T_INTRO;
    const own = special[style];
    if (own) {
      own(r, t);
      requestAnimationFrame(frame);
      return;
    }
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
      if (style === 'wizard') {
        drawWizard(r, t);
      } else if (style === 'bomb') {
        drawBomb(r, t);
      } else if (style === 'hearts') {
        drawHearts(r, t);
      } else if (style === 'flowers') {
        drawFlowers(r, t);
      } else if (style === 'asteroids') {
        drawAsteroids(r, t);
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
    } else if (style === 'wizard') {
      drawWizard(r, t);
    } else if (style === 'bomb') {
      drawBomb(r, t);
    } else if (style === 'hearts') {
      drawHearts(r, t);
    } else if (style === 'flowers') {
      drawFlowers(r, t);
    } else if (style === 'asteroids') {
      drawAsteroids(r, t);
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
