import type { Rgba } from './codeart';
import { tryDecodeQrFrame } from './qrmodes';

export interface Scanner {
  stop(): void;
}

/**
 * Opens the rear camera and decodes frames until a valid secret packet is found.
 * `getPass` is read per frame so the passphrase can be typed while scanning.
 */
export async function startScanner(
  video: HTMLVideoElement,
  getPass: () => string,
  cb: { onStatus(msg: string): void; onFound(packet: Uint8Array, frame: Rgba): void },
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
      const frame: Rgba = { width: d.width, height: d.height, data: d.data };
      try {
        const r = await tryDecodeQrFrame(frame, getPass());
        if (!running) return;
        if (r.kind === 'packet') {
          stop();
          cb.onFound(r.packet, frame);
          return;
        }
        cb.onStatus(
          r.kind === 'none'
            ? 'Point the camera at the QR code…'
            : getPass()
              ? 'QR code found, but no secret yet. Hold steady, fill the frame, and check the passphrase.'
              : 'QR code found. If it is a fake QR, type the passphrase first; the scan is still running.',
        );
      } catch {
        /* a bad frame: keep scanning */
      }
    }
    if (running) timer = window.setTimeout(tick, 150);
  };
  tick();
  return { stop };
}
