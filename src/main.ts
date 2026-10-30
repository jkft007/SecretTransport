import { decodeCodeArt, encodeCodeArt, MAX_PACKET, type Rgba } from './codeart';
import { cropTo8, dctCapacity, embedDct, extractDct, MAX_COVER_SIDE } from './dct';
import { decodeFakeQr, decodePlainQr, encodeFakeQr, encodePlainQr } from './qrmodes';
import { openPacket, sealText, WrongPassphraseError } from './crypto';
import { MODE_CODEART, MODE_DCT, MODE_FAKEQR, MODE_QR, MODE_STEGO, parsePacket } from './packet';
import { embed, extract, stegoCapacity } from './stego';
import { blobToRgba, copyImage, copyMessage, download, generateCover, rgbaToCanvas } from './imageio';
import { playReveal, type RevealHandle } from './reveal-anim';
import { startScanner, type Scanner } from './camera';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || $<HTMLInputElement>('chk-motion').checked;

function setStatus(el: HTMLElement, msg: string, error = false) {
  el.textContent = msg;
  el.classList.toggle('error', error);
}

// ---- tabs -------------------------------------------------------------------
function showTab(which: 'hide' | 'reveal') {
  for (const t of ['hide', 'reveal'] as const) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === which));
    $(`panel-${t}`).hidden = t !== which;
  }
}
$('tab-hide').onclick = () => showTab('hide');
$('tab-reveal').onclick = () => showTab('reveal');

// ---- passphrase helpers -----------------------------------------------------
function passBits(p: string): number {
  if (!p) return 0;
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/\d/.test(p)) pool += 10;
  if (/[^A-Za-z0-9]/.test(p)) pool += 32;
  return Math.min(p.length, new Set(p).size * 3) * Math.log2(Math.max(pool, 2));
}

function updateMeter() {
  const bits = passBits($<HTMLInputElement>('pass').value);
  const m = $('pass-meter');
  m.style.width = `${Math.min(100, (bits / 80) * 100)}%`;
  m.style.background = bits < 40 ? 'var(--err)' : bits < 64 ? '#e0a100' : 'var(--accent)';
  $('pass-note').textContent = bits === 0 ? '' : bits < 40 ? 'Weak: anyone holding the image could guess this.' : bits < 64 ? 'Okay. Longer is better.' : 'Strong.';
}
$('pass').addEventListener('input', updateMeter);

$('pass-toggle').onclick = () => {
  const i = $<HTMLInputElement>('pass');
  i.type = i.type === 'password' ? 'text' : 'password';
  $('pass-toggle').textContent = i.type === 'password' ? 'Show' : 'Hide';
};

$('pass-gen').onclick = () => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  const i = $<HTMLInputElement>('pass');
  i.value = chars.match(/.{4}/g)!.join('-');
  i.type = 'text';
  $('pass-toggle').textContent = 'Hide';
  updateMeter();
};

// ---- hide -------------------------------------------------------------------
const modeRadios = () => document.querySelectorAll<HTMLInputElement>('input[name=mode]');
type Mode = 'codeart' | 'qr' | 'fakeqr' | 'photo';
const currentMode = () => [...modeRadios()].find((r) => r.checked)!.value as Mode;
const photoKind = () => $<HTMLSelectElement>('photo-kind').value as 'dct' | 'lsb';
function syncModeUi() {
  const m = currentMode();
  $('decoy-row').hidden = m !== 'fakeqr';
  $('photo-opts').hidden = m !== 'photo';
  $('cover-row').hidden = m !== 'photo';
}
modeRadios().forEach((r) => r.addEventListener('change', syncModeUi));

let lastOut: HTMLCanvasElement | null = null;

$('btn-create').onclick = async () => {
  const text = $<HTMLTextAreaElement>('secret').value;
  const pass = $<HTMLInputElement>('pass').value;
  const status = $('hide-status');
  if (!text) return setStatus(status, 'Enter some text to hide.', true);
  if (!pass) return setStatus(status, 'Enter a passphrase (or press Generate).', true);

  const btn = $<HTMLButtonElement>('btn-create');
  btn.disabled = true;
  setStatus(status, 'Encrypting…');
  $('out-wrap').hidden = true;
  const warn = $('warn');
  warn.hidden = true;
  try {
    const mode = currentMode();
    const kind = photoKind();
    const packetMode = { codeart: MODE_CODEART, qr: MODE_QR, fakeqr: MODE_FAKEQR, photo: kind === 'dct' ? MODE_DCT : MODE_STEGO }[mode];
    const packet = await sealText(text, pass, packetMode);
    let img: Rgba;
    if (mode === 'codeart') {
      if (packet.length > MAX_PACKET) throw new Error('That is too much text for one image.');
      img = encodeCodeArt(packet);
      if (packet.length > 8000) {
        warn.textContent = 'This is a large image. Some apps shrink big images, which can make it unreadable. Consider splitting the text.';
        warn.hidden = false;
      }
    } else if (mode === 'qr') {
      img = encodePlainQr(packet);
      warn.textContent = 'Anyone can scan this QR code, but they will only see encrypted gibberish without the passphrase.';
      warn.hidden = false;
    } else if (mode === 'fakeqr') {
      const decoy = $<HTMLInputElement>('decoy').value;
      if (!decoy) throw new Error('Enter the decoy text a scanner should show.');
      img = await encodeFakeQr(packet, decoy, pass);
      warn.textContent = 'A phone scanner will show your decoy. Keep the image at its original size: cropping or heavy shrinking breaks the hidden data.';
      warn.hidden = false;
    } else {
      const file = $<HTMLInputElement>('cover-file').files?.[0];
      let cover = file ? await blobToRgba(file, kind === 'dct' ? MAX_COVER_SIDE : 2400) : generateCover();
      if (kind === 'dct') {
        cover = cropTo8(cover);
        if (packet.length > dctCapacity(cover)) throw new Error('The cover photo is too small for this much text. Pick a larger photo or use less text.');
        img = await embedDct(cover, packet, pass);
        warn.textContent = 'Survives normal JPEG recompression, but not cropping, rotating or heavy resizing. Photos are limited to 1280 px so most apps leave them alone.';
      } else {
        if (packet.length > stegoCapacity(cover)) throw new Error('The cover photo is too small for this much text. Pick a larger photo.');
        img = await embed(cover, packet, pass);
        warn.textContent = 'Send this as an original PNG file or attachment. Pasting it inline in Gmail, WhatsApp, iMessage and most social apps usually recompresses it and destroys the hidden data. If in doubt, use the JPEG-safe method.';
      }
      warn.hidden = false;
    }
    lastOut = rgbaToCanvas(img, $<HTMLCanvasElement>('out-canvas'));
    $('out-info').textContent = `${img.width} × ${img.height} px · ${packet.length} bytes of encrypted data`;
    $('out-wrap').hidden = false;
    setStatus(status, 'Done. Copy it into your message, or download it.');
  } catch (e) {
    setStatus(status, (e as Error).message, true);
  } finally {
    btn.disabled = false;
  }
};

$('btn-copy').onclick = async () => {
  try {
    await copyImage(lastOut!);
    setStatus($('hide-status'), 'Image copied. Paste it into your message.');
  } catch (e) {
    setStatus($('hide-status'), (e as Error).message, true);
  }
};
$('btn-copy-msg').onclick = async () => {
  try {
    await copyMessage(lastOut!, location.origin + location.pathname);
    setStatus($('hide-status'), 'Message copied: paste it into an email or chat. If an app only takes the image, paste the link separately.');
  } catch (e) {
    setStatus($('hide-status'), (e as Error).message, true);
  }
};
$('btn-download').onclick = () => download(lastOut!, 'secret.png');

// ---- reveal -----------------------------------------------------------------
let loaded: Rgba | null = null;
let handle: RevealHandle | null = null;
let clearTimer: number | undefined;

async function loadBlob(blob: Blob) {
  const status = $('reveal-status');
  try {
    loaded = await blobToRgba(blob);
    const t = rgbaToCanvas(loaded, $<HTMLCanvasElement>('thumb'));
    t.hidden = false;
    $('drop-text').innerHTML = '<b>Image loaded.</b> Enter the passphrase below, or paste another image.';
    setStatus(status, '');
    showTab('reveal');
    $<HTMLInputElement>('pass2').focus();
  } catch {
    setStatus(status, 'Could not read that image.', true);
  }
}

document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  const file = item?.getAsFile();
  if (file) {
    e.preventDefault();
    loadBlob(file);
  }
});
$<HTMLInputElement>('file-in').onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) loadBlob(f);
};
const drop = $('drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) loadBlob(f);
});

function clearResult() {
  clearTimeout(clearTimer);
  clearInterval(clearTimer);
  $<HTMLTextAreaElement>('plain').value = '';
  $('result').hidden = true;
  $('stage-wrap').hidden = true;
  $('timer').textContent = '';
  handle?.skip();
}
$('btn-clear').onclick = clearResult;
$('btn-skip').onclick = () => handle?.skip();
$('btn-copy-plain').onclick = async () => {
  await navigator.clipboard.writeText($<HTMLTextAreaElement>('plain').value);
  setStatus($('reveal-status'), 'Text copied.');
};

$('btn-reveal').onclick = async () => {
  const status = $('reveal-status');
  const pass = $<HTMLInputElement>('pass2').value;
  if (!loaded) return setStatus(status, 'Paste or choose the image first.', true);
  if (!pass) return setStatus(status, 'Enter the passphrase.', true);

  clearResult();
  const btn = $<HTMLButtonElement>('btn-reveal');
  btn.disabled = true;
  setStatus(status, 'Decoding…');
  try {
    const img = loaded;
    const attempts: [() => Promise<Uint8Array> | Uint8Array, 'codeart' | 'stego'][] = [
      [() => decodePlainQr(img), 'codeart'],
      [() => decodeCodeArt(img), 'codeart'],
      [() => decodeFakeQr(img, pass), 'codeart'],
      [() => extractDct(img, pass), 'stego'],
      [() => extract(img, pass), 'stego'],
    ];
    let packet: Uint8Array | undefined;
    let mode: 'codeart' | 'stego' = 'codeart';
    for (const [fn, m] of attempts) {
      try {
        const p = await fn();
        parsePacket(p); // validates framing and checksum
        packet = p;
        mode = m;
        break;
      } catch {
        /* try the next method */
      }
    }
    if (!packet) throw new Error('No hidden secret found in this image. It may have been cropped, recompressed or resized by the app it travelled through.');
    const text = await openPacket(packet, pass);

    setStatus(status, '');
    $('stage-wrap').hidden = false;
    $<HTMLTextAreaElement>('plain').value = '';
    const source = rgbaToCanvas(loaded);
    handle = playReveal({ canvas: $<HTMLCanvasElement>('stage'), source, text, mode, reduceMotion: reducedMotion() });
    await handle.done;
    $<HTMLTextAreaElement>('plain').value = text;
    $('result').hidden = false;

    let left = 60;
    const tick = () => {
      $('timer').textContent = `Clears in ${left}s`;
      if (left-- <= 0) clearResult();
    };
    tick();
    clearTimer = window.setInterval(tick, 1000);
  } catch (e) {
    if (e instanceof WrongPassphraseError) {
      const card = $('panel-reveal');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    }
    setStatus(status, (e as Error).message, true);
  } finally {
    btn.disabled = false;
  }
};

syncModeUi();

$('btn-paste').onclick = async () => {
  const status = $('reveal-status');
  try {
    if (!navigator.clipboard?.read) throw new Error('unsupported');
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) return void (await loadBlob(await item.getType(type)));
    }
    setStatus(status, 'No image found on the clipboard. Copy the image first, then try again.', true);
  } catch (e) {
    const denied = (e as Error).name === 'NotAllowedError';
    setStatus(status, denied ? 'Clipboard access was blocked. Allow it in the browser, or press Ctrl/Cmd+V instead.' : 'This browser cannot read the clipboard here (needs https or localhost). Press Ctrl/Cmd+V instead.', true);
  }
};

// ---- camera scanning --------------------------------------------------------
let scanner: Scanner | null = null;

function stopScan() {
  scanner?.stop();
  scanner = null;
  $('cam-wrap').hidden = true;
  $<HTMLButtonElement>('btn-scan').disabled = false;
}

$('btn-scan').onclick = async () => {
  const status = $('reveal-status');
  stopScan();
  try {
    $<HTMLButtonElement>('btn-scan').disabled = true;
    $('cam-wrap').hidden = false;
    setStatus(status, 'Starting camera…');
    scanner = await startScanner($<HTMLVideoElement>('cam'), () => $<HTMLInputElement>('pass2').value, {
      onStatus: (m) => setStatus(status, m),
      onFound: (_packet, frame) => {
        stopScan();
        loaded = frame;
        rgbaToCanvas(frame, $<HTMLCanvasElement>('thumb')).hidden = false;
        $('drop-text').innerHTML = '<b>QR code scanned.</b>';
        if ($<HTMLInputElement>('pass2').value) $<HTMLButtonElement>('btn-reveal').click();
        else {
          setStatus(status, 'Scanned. Enter the passphrase and press Reveal.');
          $<HTMLInputElement>('pass2').focus();
        }
      },
    });
  } catch (e) {
    stopScan();
    const err = e as Error;
    const msg =
      err.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in the browser and try again.'
      : err.name === 'NotFoundError' ? 'No camera was found on this device.'
      : err.message || 'Could not start the camera.';
    setStatus(status, msg, true);
  }
};
$('btn-scan-stop').onclick = () => {
  stopScan();
  setStatus($('reveal-status'), '');
};
document.addEventListener('visibilitychange', () => document.hidden && stopScan());
$('tab-hide').addEventListener('click', stopScan);
