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

Encryption: AES-256-GCM, key from the passphrase via PBKDF2-SHA256 (600k rounds), Reed-Solomon error correction. The reveal is animated.

## Camera scanning
**Scan QR with camera** (Reveal tab) reads QR and fake-QR codes live, including tilted or angled ones, using a perspective transform. Plain QR needs no passphrase to scan; for a fake QR, type the passphrase first or while scanning. Needs https or localhost and camera permission. Only the QR modes can be scanned: code art and photos need a clean image, not a camera view.

## Cover photos
JPEG, PNG and iPhone **HEIC/HEIF** photos work as cover images. HEIC is decoded in the browser with [libheif-js](https://github.com/catdad-experiments/libheif-js) (WebAssembly, LGPL-3.0), loaded only when a HEIC file is picked. Output is always PNG or JPEG-safe pixels, never HEIC.

## Run

```
npm install
npm run dev     # http://localhost:5173
npm test
npm run build   # static site in dist/
```

## Limits
- Use a long random passphrase: anyone holding the image can guess offline. The image size hints at the message length.
- Fake QR hides the message from casual scanning, not from analysis: a forensic tool would see far more corrected errors than a normal QR has.
- Cropped, rotated or heavily resized image files cannot be decoded (QR codes seen by the camera are the exception).

## License

MIT
