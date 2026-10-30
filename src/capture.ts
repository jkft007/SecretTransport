import type { Rgba } from './codeart';

export interface Preview {
  grab(): Rgba | null;
  stop(): void;
}

/** Opens the rear camera in `video` and lets the caller take a full-resolution still. */
export async function startPreview(video: HTMLVideoElement): Promise<Preview> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs https or localhost and a browser with camera support.');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return {
    grab() {
      if (!video.videoWidth) return null;
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(video, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      return { width: d.width, height: d.height, data: d.data };
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
