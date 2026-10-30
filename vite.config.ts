import { defineConfig, type Plugin } from 'vite';

// Production builds ship a strict CSP: no network access at all, no third-party scripts.
const csp: Plugin = {
  name: 'strict-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const policy =
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`);
  },
};

export default defineConfig({
  base: './',
  plugins: [csp],
  test: { environment: 'node', testTimeout: 30000 },
});
