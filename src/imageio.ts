import type { Rgba } from './codeart';

export function rgbaToCanvas(img: Rgba, canvas = document.createElement('canvas')): HTMLCanvasElement {
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas;
}

/** Decodes an image blob to raw pixels, flattened onto opaque white, without colour conversion. */
export async function blobToRgba(blob: Blob, maxSide = Infinity): Promise<Rgba> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  } catch {
    bmp = await createImageBitmap(blob);
  }
  const f = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * f));
  const h = Math.max(1, Math.round(bmp.height * f));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const d = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode PNG'))), 'image/png'));
}

export async function copyImage(canvas: HTMLCanvasElement): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('Copying images needs https or localhost. Use Download instead.');
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasToBlob(canvas) })]);
}

export function download(canvas: HTMLCanvasElement, name: string): void {
  canvasToBlob(canvas).then((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

/** A pleasant noisy gradient: the noise hides least-significant-bit changes. */
export function generateCover(w = 1280, h = 853): Rgba {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const hue = Math.floor(Math.random() * 360);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue} 60% 22%)`);
  g.addColorStop(1, `hsl(${(hue + 70) % 360} 65% 45%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = (0.2 + Math.random() * 0.4) * w;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `hsla(${(hue + Math.random() * 120) % 360} 80% 65% / 0.35)`);
    rg.addColorStop(1, 'hsla(0 0% 0% / 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  }
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d.data[i] += n;
    d.data[i + 1] += n;
    d.data[i + 2] += n;
    d.data[i + 3] = 255;
  }
  return { width: w, height: h, data: d.data };
}
