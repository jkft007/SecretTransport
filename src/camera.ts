import type { Rgba } from './codeart';
import { tryDecodeQrFrame } from './qrmodes';

export interface Scanner {
  stop(): void;
}

/**
 * Opens the rear camera and decodes frames until the caller says to stop.
 * `getPass` is read per frame so the passphrase can be typed while scanning.
 * `onFound` gets every valid secret packet or split part; return true to keep scanning
 * (for the next part of a split secret), or false to stop the camera.
 */
export async function startScanner(
  video: HTMLVideoElement,
  getPass: () => string,
  cb: { onStatus(msg: string): void; onFound(frame: Uint8Array, image: Rgba): boolean },
): Promise<Scanner> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs https or localhost and a browser with camera support.');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let running = true;
  let timer = 0;
  let lastFound = '';

  const stop = () => {
    running = false;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  const tick = async () => {
    if (!running) return;
    if (video.videoWidth) {
      const f = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * f);
      canvas.height = Math.round(video.videoHeight * f);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const image: Rgba = { width: d.width, height: d.height, data: d.data };
      try {
        const r = await tryDecodeQrFrame(image, getPass());
        if (!running) return;
        if (r.kind === 'packet') {
          const key = Array.from(r.packet.subarray(0, 16)).join(',') + ':' + r.packet.length;
          // the same code stays in view for many frames: report it once
          if (key !== lastFound) {
            lastFound = key;
            if (!cb.onFound(r.packet, image)) {
              stop();
              return;
            }
          }
        } else {
          cb.onStatus(
            r.kind === 'none'
              ? 'Point the camera at the QR code…'
              : getPass()
                ? 'QR code found, but no secret yet. Hold steady, fill the frame, and check the passphrase.'
                : 'QR code found. If it is a fake QR, type the passphrase first; the scan is still running.',
          );
        }
      } catch {
        /* a bad frame: keep scanning */
      }
    }
    if (running) timer = window.setTimeout(tick, 150);
  };
  tick();
  return { stop };
}
