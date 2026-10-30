// Reads text out of a picture, entirely in the browser (Tesseract.js, English).
// The worker, engine and language data are our own files under ./ocr/ and load on first use only.
import type { Rgba } from './codeart';
import { rgbaToCanvas } from './imageio';

export interface OcrResult {
  text: string;
  confidence: number; // 0-100
}

type Progress = (message: string, fraction: number) => void;

interface TessWorker {
  recognize(image: HTMLCanvasElement): Promise<{ data: { text: string; confidence: number } }>;
}

let workerPromise: Promise<TessWorker> | null = null;
let onProgress: Progress | null = null;

const STATUS_TEXT: Record<string, string> = {
  'loading tesseract core': 'Loading the text reader (first use only)…',
  'initializing tesseract': 'Starting the text reader…',
  'loading language traineddata': 'Loading English language data (first use only)…',
  'loaded language traineddata': 'Loading English language data…',
  'initializing api': 'Starting the text reader…',
  'recognizing text': 'Reading text…',
};

function getWorker(): Promise<TessWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = new URL('./ocr/', document.baseURI).href;
      return (await createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base,
        langPath: base,
        workerBlobURL: false,
        gzip: true,
        logger: (m: { status: string; progress: number }) => onProgress?.(STATUS_TEXT[m.status] ?? m.status, m.progress),
      })) as unknown as TessWorker;
    })().catch((e) => {
      workerPromise = null; // allow a retry
      throw e;
    });
  }
  return workerPromise;
}

/** Greyscale + auto-levels, and scale to a size Tesseract reads well. Helps phone photos a lot. */
export function prepareForOcr(img: Rgba): HTMLCanvasElement {
  const src = rgbaToCanvas(img);
  const longest = Math.max(img.width, img.height);
  const scale = longest > 2400 ? 2400 / longest : longest < 1000 ? Math.min(3, 1400 / longest) : 1;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.data.length; i += 4) {
    const g = Math.round(0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2]);
    d.data[i] = g;
    hist[g]++;
  }
  const total = w * h;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.02; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.02; hi--);
  const range = Math.max(40, hi - lo);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d.data[i] - lo) * 255) / range));
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

export function tidyText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function readText(img: Rgba, progress: Progress): Promise<OcrResult> {
  onProgress = progress;
  try {
    progress('Loading the text reader (first use only)…', 0);
    const worker = await getWorker();
    const { data } = await worker.recognize(prepareForOcr(img));
    return { text: tidyText(data.text), confidence: Math.round(data.confidence) };
  } finally {
    onProgress = null;
  }
}
