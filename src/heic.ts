// HEIC/HEIF fallback decoder for browsers without native support (everything except Safari).
// libheif-js (LGPL-3.0, WebAssembly) is loaded lazily, only when a HEIC file is actually picked.

const BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];

export async function looksLikeHeic(blob: Blob): Promise<boolean> {
  const name = (blob as File).name?.toLowerCase() ?? '';
  if (/image\/hei[cf]/.test(blob.type) || /\.hei[cf]$/.test(name)) return true;
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const tag = (o: number) => String.fromCharCode(...head.slice(o, o + 4));
  return head.length === 12 && tag(4) === 'ftyp' && BRANDS.includes(tag(8));
}

export async function decodeHeic(blob: Blob): Promise<HTMLCanvasElement> {
  const factory = (await import('libheif-js/libheif-wasm/libheif-bundle.mjs')).default;
  const libheif = await factory();
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await blob.arrayBuffer()));
  const image = images?.[0];
  if (!image) throw new Error('This HEIC file could not be decoded.');
  const w = image.get_width();
  const h = image.get_height();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(w, h);
  await new Promise<void>((resolve, reject) =>
    image.display(imageData, (out: ImageData | null) => (out ? resolve() : reject(new Error('This HEIC file could not be decoded.')))),
  );
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
