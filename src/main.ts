import { decodeCodeArt, encodeCodeArt, MAX_PACKET, type Rgba } from './codeart';
import { openPacket, sealText, WrongPassphraseError } from './crypto';
import { MODE_CODEART, MODE_STEGO } from './packet';
import { embed, extract, stegoCapacity } from './stego';
import { blobToRgba, copyImage, download, generateCover, rgbaToCanvas } from './imageio';
import { playReveal, type RevealHandle } from './reveal-anim';

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
const currentMode = () => [...modeRadios()].find((r) => r.checked)!.value as 'codeart' | 'stego';
modeRadios().forEach((r) => r.addEventListener('change', () => ($('cover-row').hidden = currentMode() !== 'stego')));

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
    const packet = await sealText(text, pass, mode === 'codeart' ? MODE_CODEART : MODE_STEGO);
    let img: Rgba;
    if (mode === 'codeart') {
      if (packet.length > MAX_PACKET) throw new Error('That is too much text for one image.');
      img = encodeCodeArt(packet);
      if (packet.length > 8000) {
        warn.textContent = 'This is a large image. Some apps shrink big images, which can make it unreadable. Consider splitting the text.';
        warn.hidden = false;
      }
    } else {
      const file = $<HTMLInputElement>('cover-file').files?.[0];
      const cover = file ? await blobToRgba(file, 2400) : generateCover();
      if (packet.length > stegoCapacity(cover)) throw new Error('The cover photo is too small for this much text. Pick a larger photo.');
      img = await embed(cover, packet, pass);
      warn.textContent = 'Send this as an original PNG file or attachment. Pasting it inline in Gmail, WhatsApp, iMessage and most social apps usually recompresses it and destroys the hidden data. If in doubt, use Code art.';
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
    let packet: Uint8Array | undefined;
    let mode: 'codeart' | 'stego' = 'codeart';
    try {
      packet = decodeCodeArt(loaded);
    } catch {
      try {
        packet = await extract(loaded, pass);
        mode = 'stego';
      } catch {
        /* fall through */
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
