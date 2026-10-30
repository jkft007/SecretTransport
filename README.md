# SecretTransport

Turn any text into an image you can paste into a message or email. Only someone with the passphrase can turn it back. Runs entirely in the browser; nothing is uploaded.

- **Code art**: a colourful mosaic that survives JPEG compression, resizing and screenshots.
- **Hidden in a photo**: invisible LSB embedding in a photo. Only survives as an original PNG; most chat apps recompress and destroy it.
- Encryption: AES-256-GCM, key from the passphrase via PBKDF2-SHA256 (600k rounds). Reed-Solomon error correction for code art.
- Animated reveal when decoding.

## Run

```
npm install
npm run dev     # http://localhost:5173
npm test
npm run build   # static site in dist/
```

Use a long random passphrase: anyone holding the image can guess offline. The image size hints at the message length.
