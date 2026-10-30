// Presentational only: scan the image, rain glyphs, then decode the text character by character.
export interface RevealOptions {
  canvas: HTMLCanvasElement;
  source: CanvasImageSource & { width: number; height: number };
  text: string;
  mode: 'codeart' | 'stego';
  reduceMotion: boolean;
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
  shown.forEach((ln, r) => Array.from(ln).forEach((ch, c) => cells.push({ ch, x: pad + c * cw, y: pad + (r + 1) * lh - 7, lock: 0 })));
  const visible = cells.filter((c) => c.ch !== ' ');

  const T_SCAN = 1100;
  const T_RAIN = 700;
  const T_RESOLVE = Math.min(2600, Math.max(900, visible.length * 20));
  visible.forEach((c, i) => (c.lock = (i / Math.max(1, visible.length)) * T_RESOLVE * 0.8 + rnd() * T_RESOLVE * 0.2));
  const T_END = T_SCAN + T_RAIN + T_RESOLVE + 250;

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

  const frame = (now: number) => {
    const t = now - t0;
    if (skipped || t >= T_END) {
      drawFinal();
      resolveDone();
      return;
    }
    if (t < T_SCAN) {
      const p = t / T_SCAN;
      ctx.fillStyle = `rgb(${BG})`;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(o.source, ix, iy, iw, ih);
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
    } else if (t < T_SCAN + T_RAIN) {
      if (!rainStarted) {
        rainStarted = true;
        ctx.fillStyle = `rgb(${BG})`;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(o.source, ix, iy, iw, ih);
        ctx.globalAlpha = 1;
      }
      rain(0.14);
    } else {
      const r = t - T_SCAN - T_RAIN;
      ctx.fillStyle = `rgba(${BG},.35)`;
      ctx.fillRect(0, 0, W, H);
      rain(0);
      ctx.fillStyle = `rgba(${BG},.88)`;
      ctx.fillRect(pad / 2, pad / 2, W - pad, H - pad);
      ctx.font = `${fs}px ${FONT}`;
      const bucket = Math.floor(r / 70);
      visible.forEach((c, i) => {
        if (r >= c.lock) {
          const fresh = r - c.lock < 160;
          ctx.fillStyle = fresh ? '#7dffe0' : '#e8fff4';
          ctx.shadowColor = 'rgba(80,255,190,.6)';
          ctx.shadowBlur = fresh ? 12 : 5;
          ctx.fillText(c.ch, c.x, c.y);
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(70,220,160,.75)';
          ctx.fillText(glyph(bucket * 977 + i), c.x, c.y);
        }
      });
      ctx.shadowBlur = 0;
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
