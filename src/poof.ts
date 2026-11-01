// The end of the reading time: the revealed text on the stage goes up in a puff of smoke, and then a vortex spins up and sucks
// what is left in. Purely presentational; the caller clears the secret itself afterwards.

/** Where the lit pixels are (the text or picture on the stage): the middle of the vortex. */
function contentCentre(snap: HTMLCanvasElement): { x: number; y: number; w: number; h: number } {
  const W = snap.width;
  const H = snap.height;
  try {
    const d = snap.getContext('2d')!.getImageData(0, 0, W, H).data;
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    for (let y = 0; y < H; y += 3) {
      for (let x = 0; x < W; x += 3) {
        const k = (y * W + x) * 4;
        if (d[k] + d[k + 1] + d[k + 2] > 210) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 > x0 && y1 > y0) return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  } catch {
    /* an unreadable canvas: the middle will do */
  }
  return { x: W / 2, y: H / 2, w: W * 0.6, h: H * 0.3 };
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Smokes and swirls away what is drawn on `canvas`. Resolves when it is gone, or as soon as `cancelled()` says to stop. */
export function poofCanvas(canvas: HTMLCanvasElement, ms = 2800, cancelled: () => boolean = () => false): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width < 8 || canvas.height < 8) return Promise.resolve();
  const W = canvas.width;
  const H = canvas.height;
  const snap = document.createElement('canvas');
  snap.width = W;
  snap.height = H;
  snap.getContext('2d')!.drawImage(canvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowBlur = 0; // whatever glow the text was drawn with must not be applied to every block
  ctx.shadowColor = 'transparent';
  const c = contentCentre(snap);
  const S = Math.max(5, Math.round(W / 110));
  const n = Math.ceil(W / S);
  const m = Math.ceil(H / S);
  const rMax = Math.hypot(Math.max(c.x, W - c.x), Math.max(c.y, H - c.y));
  // each block of the picture: where it starts (as an angle and a distance from the vortex) and when it gets caught
  const blocks = Array.from({ length: n * m }, (_, k) => {
    const bx = (k % n) * S;
    const by = Math.floor(k / n) * S;
    const dx = bx + S / 2 - c.x;
    const dy = by + S / 2 - c.y;
    return { bx, by, r0: Math.hypot(dx, dy), a0: Math.atan2(dy, dx), late: Math.random() * 0.16 + (Math.hypot(dx, dy) / rMax) * 0.1 };
  });
  const puffs = Array.from({ length: 22 }, () => ({
    x: c.x + (Math.random() - 0.5) * c.w * 0.9,
    y: c.y + (Math.random() - 0.5) * c.h * 0.9,
    a: Math.random() * Math.PI * 2,
    v: 0.4 + Math.random() * 1.1,
    r: 26 + Math.random() * 46,
    g: 150 + Math.random() * 70,
  }));
  const motes = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: 0.25 + Math.random() * 0.75, s: 0.5 + Math.random(), z: 1 + Math.random() * 3 }));
  const t0 = performance.now();
  return new Promise((resolve) => {
    const frame = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgb(11,15,20)';
      ctx.fillRect(0, 0, W, H);
      if (cancelled() || p >= 1) return resolve();
      const t = now - t0;
      // the picture: it shakes at the poof, and then each block is caught by the vortex, spiralling in as it shrinks
      for (const b of blocks) {
        const q = clamp((p - 0.3 - b.late) / 0.55);
        if (q >= 1) continue;
        const e = q * q * (3 - 2 * q);
        const r = b.r0 * Math.pow(1 - e, 1.4);
        const a = b.a0 + e * e * 6.5;
        const s = Math.pow(1 - e, 0.7);
        const smoke = clamp((p - 0.04) / 0.18) * (1 - clamp((p - 0.3) / 0.15)); // the smoke hides the picture at the poof
        const tremble = q <= 0 ? Math.sin(t / 23 + b.bx) * 1.6 * (1 - clamp(p / 0.3)) : 0;
        ctx.save();
        ctx.globalAlpha = (1 - clamp((q - 0.75) / 0.25)) * (1 - 0.35 * smoke);
        ctx.translate(c.x + Math.cos(a) * r + tremble, c.y + Math.sin(a) * r);
        ctx.rotate(a - b.a0);
        ctx.scale(s, s);
        ctx.drawImage(snap, b.bx, b.by, Math.min(S, W - b.bx), Math.min(S, H - b.by), -S / 2, -S / 2, Math.min(S, W - b.bx), Math.min(S, H - b.by));
        ctx.restore();
      }
      // the poof: a bright flash, then puffs of smoke billowing out and thinning
      if (p < 0.5) {
        const flash = Math.max(0, 1 - p / 0.1);
        if (flash > 0) {
          const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(c.w, 120) * 0.7);
          g.addColorStop(0, `rgba(255,250,235,${0.85 * flash})`);
          g.addColorStop(1, 'rgba(255,250,235,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }
        const k = clamp(p / 0.34);
        for (const f of puffs) {
          const rad = f.r * (0.4 + 1.6 * Math.sqrt(k));
          const px = f.x + Math.cos(f.a) * f.v * k * 80;
          const py = f.y + Math.sin(f.a) * f.v * k * 60 - k * 30;
          const al = 0.62 * Math.min(1, p / 0.05) * (1 - clamp((p - 0.18) / 0.32));
          const g = ctx.createRadialGradient(px, py, rad * 0.1, px, py, rad);
          g.addColorStop(0, `rgba(${f.g + 30},${f.g + 30},${f.g + 35},${al})`);
          g.addColorStop(1, `rgba(${f.g},${f.g},${f.g + 5},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // the vortex: a dark core and grey smoke spiralling round it and in
      const v = clamp((p - 0.22) / 0.2) * (1 - clamp((p - 0.88) / 0.12));
      if (v > 0) {
        const core = 14 + 46 * v * (1 - clamp((p - 0.8) / 0.2));
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, core * 2.2);
        g.addColorStop(0, `rgba(2,3,6,${0.95 * v})`);
        g.addColorStop(0.5, `rgba(20,24,34,${0.6 * v})`);
        g.addColorStop(1, 'rgba(20,24,34,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c.x, c.y, core * 2.2, 0, Math.PI * 2);
        ctx.fill();
        const reach = Math.min(rMax, Math.max(W, H) * 0.5);
        for (const o of motes) {
          const life = (((p - 0.2) * 1.3 * o.s + o.r) % 1 + 1) % 1; // each mote spirals in and starts again at the edge
          const rr = reach * o.r * (1 - life) * (1 - 0.3 * life);
          const aa = o.a + life * 7 * o.s + p * 4;
          ctx.fillStyle = `rgba(205,210,222,${0.5 * v * (1 - life) * Math.min(1, life * 6)})`;
          ctx.beginPath();
          ctx.arc(c.x + Math.cos(aa) * rr, c.y + Math.sin(aa) * rr * 0.9, o.z * (1 + 1.5 * (1 - life)), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/**
 * What is left behind when the secret has destroyed itself: a bald little doodle with a long nose peeks over a wall and
 * grips the top with its fingers, with "WALLY WAS HERE" chalked on the wall. It slowly looks about, and stays until the
 * stage is next used (`canvas.dataset.wally` is cleared by the caller to stop it).
 */
export function wallyPeek(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0) { // the stage may have been hidden: size it as it is shown now
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(Math.max(280, rect.width) * dpr);
    canvas.height = Math.round(Math.max(180, rect.height) * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width < 8 || canvas.height < 8) return;
  const W = canvas.width;
  const H = canvas.height;
  const id = String(Math.random());
  canvas.dataset.wally = id;
  const u = Math.min(W, H);
  const R = u * 0.25; // the head
  const wallY = H * 0.66;
  const cx = W / 2;
  const chalk = '#ece8da';
  const t0 = performance.now();
  const frame = (now: number) => {
    if (canvas.dataset.wally !== id) return;
    const t = now - t0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgb(11,15,20)';
    ctx.fillRect(0, 0, W, H);
    const rise = Math.min(1, t / 700);
    const e = 1 - Math.pow(1 - rise, 3);
    const lift = (1 - e) * (R * 1.5); // he starts hidden below the wall and peeks up
    const look = rise < 1 ? 0 : Math.sin((t - 700) / 650) * 0.55; // then glances from side to side
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = chalk;
    ctx.lineWidth = Math.max(2, u * 0.012);
    // the head, with its eyes and long nose, behind the wall
    const hy = wallY + R * 0.18 + lift;
    ctx.fillStyle = 'rgb(11,15,20)';
    ctx.beginPath();
    ctx.arc(cx, hy, R, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    for (const s of [-1, 1]) {
      const ex = cx + s * R * 0.4;
      const ey = hy - R * 0.28;
      ctx.beginPath();
      ctx.arc(ex, ey, R * 0.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = chalk;
      ctx.beginPath();
      ctx.arc(ex + look * R * 0.1, ey + R * 0.02, R * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath(); // the nose: a long droop over the wall
    ctx.moveTo(cx - R * 0.07, hy - R * 0.45);
    ctx.bezierCurveTo(cx - R * 0.16, hy - R * 0.05, cx - R * 0.12, hy + R * 0.5, cx + R * 0.1, hy + R * 0.62);
    ctx.bezierCurveTo(cx + R * 0.22, hy + R * 0.5, cx + R * 0.14, hy - R * 0.05, cx + R * 0.07, hy - R * 0.45);
    ctx.stroke();
    ctx.beginPath(); // a little frown line
    ctx.moveTo(cx - R * 0.55, hy - R * 0.62);
    ctx.quadraticCurveTo(cx - R * 0.4, hy - R * 0.72, cx - R * 0.22, hy - R * 0.62);
    ctx.stroke();
    // his fingers gripping the top of the wall
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const fx = cx + s * (R * 1.1 + k * R * 0.2);
        const top = wallY - R * (0.3 - (k === 1 ? 0.06 : 0)) + lift * 0.6;
        ctx.fillStyle = 'rgb(11,15,20)';
        ctx.beginPath();
        ctx.roundRect(fx - R * 0.08, top, R * 0.16, wallY - top + R * 0.1, R * 0.08);
        ctx.fill();
        ctx.stroke();
      }
    }
    // the wall, which hides the rest of him
    ctx.fillStyle = 'rgb(23,29,37)';
    ctx.fillRect(0, wallY, W, H - wallY);
    ctx.beginPath();
    ctx.moveTo(0, wallY);
    ctx.lineTo(W, wallY);
    ctx.stroke();
    // the nose hangs down in front of the wall
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.12, wallY);
    ctx.bezierCurveTo(cx - R * 0.14, wallY + R * 0.25, cx - R * 0.1, wallY + R * 0.5 + (hy - wallY - R * 0.18) * 0.3, cx + R * 0.1, wallY + R * 0.62 + (hy - wallY - R * 0.18));
    ctx.bezierCurveTo(cx + R * 0.2, wallY + R * 0.5, cx + R * 0.16, wallY + R * 0.2, cx + R * 0.12, wallY);
    ctx.stroke();
    // chalked on the wall
    ctx.fillStyle = chalk;
    ctx.font = `700 ${Math.max(12, Math.round(u * 0.075))}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.9 * Math.min(1, Math.max(0, (t - 500) / 500));
    ctx.fillText('WALLY WAS HERE', cx, H - (H - wallY) * 0.3);
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
