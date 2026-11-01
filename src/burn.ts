// The end of the reading time: the revealed text on the stage burns away from the bottom up, charring and flaring as it goes.
// Purely presentational; the caller clears the secret itself afterwards.

/** Burns what is drawn on `canvas`. Resolves when it has burnt away, or as soon as `cancelled()` says to stop. */
export function burnCanvas(canvas: HTMLCanvasElement, ms = 1800, cancelled: () => boolean = () => false): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width < 8 || canvas.height < 8) return Promise.resolve();
  const W = canvas.width;
  const H = canvas.height;
  const snap = document.createElement('canvas');
  snap.width = W;
  snap.height = H;
  snap.getContext('2d')!.drawImage(canvas, 0, 0);
  ctx.shadowBlur = 0; // whatever glow the text was drawn with must not be applied to every block
  ctx.shadowColor = 'transparent';
  const S = Math.max(6, Math.round(W / 90));
  const n = Math.ceil(W / S);
  const m = Math.ceil(H / S);
  // When each block catches: the bottom row first, the top last, with some ragged edges.
  const catches = Array.from({ length: n * m }, (_, k) => (1 - Math.floor(k / n) / m) * 0.7 + Math.random() * 0.15);
  const t0 = performance.now();
  return new Promise((resolve) => {
    const frame = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgb(11,15,20)';
      ctx.fillRect(0, 0, W, H);
      if (cancelled() || p >= 1) return resolve();
      for (let j = 0; j < m; j++) {
        for (let i = 0; i < n; i++) {
          const q = (p - catches[j * n + i]) / 0.22;
          if (q >= 1) continue;
          const bx = i * S;
          const by = j * S;
          const bw = Math.min(S, W - bx);
          const bh = Math.min(S, H - by);
          ctx.drawImage(snap, bx, by, bw, bh, bx, by, bw, bh);
          if (q <= 0) continue;
          ctx.fillStyle = `rgba(20,12,8,${Math.min(0.92, q * 1.7)})`; // charring
          ctx.fillRect(bx, by, bw, bh);
          if (q < 0.55) {
            ctx.fillStyle = `rgba(255,${Math.round(140 + 90 * q)},40,${0.85 * (1 - q * 1.7)})`; // the glowing edge
            ctx.fillRect(bx, by, bw, bh);
            ctx.fillStyle = `rgba(255,${Math.round(200 - 70 * q)},60,${0.38 * (1 - q * 1.8)})`; // a flame licking up
            ctx.beginPath();
            ctx.arc(bx + bw / 2 + Math.sin(now / 70 + i) * S * 0.35, by - q * S * 2.6, S * (0.3 + 0.22 * (1 - q)), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
