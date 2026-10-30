# SecretTransport

Turn any text into an image you can paste into a message or email. Only someone with the passphrase can turn it back. Runs entirely in the browser; nothing is uploaded.

## Image styles
- **Code art**: a colourful mosaic that survives JPEG compression, resizing and screenshots.
- **QR code**: a standard QR holding the encrypted data (any phone scans it, but sees gibberish).
- **Fake QR code**: scans as a decoy you choose (e.g. a web link). The real secret is hidden in the QR's error-correction budget and is only recovered with the passphrase.
- **Hidden in a photo**:
  - *JPEG-safe* (default): bits stored in DCT coefficients with heavy redundancy and error correction. Survives normal JPEG recompression (about quality 50+), not cropping, rotation or resizing.
  - *Lossless*: LSB embedding, more capacity, but only survives as an original PNG.

**Copy message (image + link)** puts the image, the link to this site and a short explanation on the clipboard (as rich text plus plain text and a PNG) so you can paste it straight into an email or chat.

Encryption: AES-256-GCM, key from the passphrase via Argon2id (64 MiB, 3 passes), Reed-Solomon error correction. The reveal is animated, with 29 styles (matrix rain, fireworks, a safe opening, a train puffing the text out of its chimney, and more). The sender can pick one when creating the image: the choice is stored inside the encrypted data, so only the passphrase holder can see it, and it is played when the recipient reveals the secret. The recipient can still override it from the animation menu, and images with no choice get a random one.

## Files and documents
Choose **File or document** on the Hide tab to hide a PDF, spreadsheet, key file, zip or anything else instead of text. The file name and contents are both encrypted, and the recipient gets a **Save file** button (files are never opened automatically; executable-type files get an extra warning). Rough size limits per style: lossless photo ~400 KB, code art ~58 KB (images get big above 8 KB), JPEG-safe photo ~3 KB, QR ~1.6 KB, fake QR ~350 bytes. The app shows the limit for the chosen style and refuses oversize files.

## Hiding a picture itself
In **File or document** mode you can paste an image from the clipboard (Ctrl/Cmd+V, or **Paste an image from the clipboard**) and the picture itself is encrypted and hidden, byte for byte, instead of its text being read. The recipient sees a preview of the revealed picture, with **Save file** and **Copy image** buttons. Pictures are usually large, so the lossless photo style (or splitting across several images) is the practical way to carry them.

## Reading the secret from a picture of text
On the Hide tab (text mode), **Use camera**, **Choose image** or **Paste image** reads the text out of a picture (a note, a printed password, a page) and puts it in the secret box for you to check and edit before hiding. It runs entirely in the browser with [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0, English). The reader (about 7 MB) is served from this site's own files and downloaded only the first time you use it. Printed text works best; handwriting does not.

## Splitting across several images
If a secret does not fit in one image, it is encrypted once and cut into numbered parts (up to 60), each in its own image of the chosen style. On the Reveal tab, add all the images in any order (paste, drop, choose, or scan QR codes one after another); the app says exactly which parts are missing. **Copy message** puts every image plus the link into one rich-text clipboard entry for email; chat apps that take one image at a time can use each part's own Copy button.

## Camera scanning
**Scan QR with camera** (Reveal tab) reads QR and fake-QR codes live, including tilted or angled ones, using a perspective transform. Plain QR needs no passphrase to scan; for a fake QR, type the passphrase first or while scanning. Needs https or localhost and camera permission. Only the QR modes can be scanned: code art and photos need a clean image, not a camera view.

## Cover photos
Choose a file, or paste one from the clipboard (Ctrl/Cmd+V on the Hide tab with the photo style selected, or the **Paste cover from clipboard** button). JPEG, PNG and iPhone **HEIC/HEIF** photos work as cover images. HEIC is decoded in the browser with [libheif-js](https://github.com/catdad-experiments/libheif-js) (WebAssembly, LGPL-3.0), loaded only when a HEIC file is picked. Output is always PNG or JPEG-safe pixels, never HEIC.

## Run

```
npm install
npm run dev     # http://localhost:5173
npm test
npm run build   # static site in dist/
```

## Protection against guessing
Because everything runs in the browser, anyone who copies an image can guess passphrases offline, and no web page can rate-limit that. What the app does about it:
- **Argon2id key derivation** (memory-hard: 64 MiB per guess), so mass guessing on GPUs or custom hardware is expensive. The parameters are stored in each image's authenticated header; older PBKDF2 images still open.
- **No cheap shortcut.** In the photo and fake-QR styles, where the data hides depends on the passphrase and could be checked without decrypting. That position key is derived with the same memory-hard function, so it costs as much to guess as the encryption key. Images made before this change still open through a fallback.
- **Passphrase strength gate.** Weak passphrases (common passwords, patterns, short or repetitive ones, famous word phrases) are refused unless you tick "Use it anyway". The Generate button makes a 99-bit random one.
- **Lockout on this device.** After 4 wrong passphrases on the same images, further tries are delayed (5 s, then doubling up to 5 min). This only frustrates casual guessing at the keyboard; it cannot stop offline attacks, so a strong passphrase is still what matters.

## Limits
- Use a long random passphrase: anyone holding the image can guess offline. The image size hints at the message length.
- Fake QR hides the message from casual scanning, not from analysis: a forensic tool would see far more corrected errors than a normal QR has.
- Cropped, rotated or heavily resized image files cannot be decoded (QR codes seen by the camera are the exception).

## License

MIT
