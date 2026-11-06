// Builds the pages into /public. Cloudflare runs this before each deploy (see wrangler.jsonc).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'public');
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(here, 'app.tsx')],
  bundle: true,
  outfile: path.join(out, 'app.js'),
  format: 'esm',
  minify: true,
  target: 'es2020',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning'
});

writeFileSync(path.join(out, 'app.css'), readFileSync(path.join(here, 'site.css'), 'utf8'));

// Self hosted font (no calls to Google) and the photo.
mkdirSync(path.join(out, 'fonts'), { recursive: true });
mkdirSync(path.join(out, 'img'), { recursive: true });
const fontDir = path.join(here, '..', 'node_modules', '@fontsource-variable', 'inter', 'files');
for (const f of ['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2']) copyFileSync(path.join(fontDir, f), path.join(out, 'fonts', f));
copyFileSync(path.join(here, 'assets', 'labs-session.jpg'), path.join(out, 'img', 'labs-session.jpg'));
copyFileSync(path.join(here, 'assets', 'ndure-logo.png'), path.join(out, 'img', 'ndure-logo.png'));
writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>NDURE Labs · Lactate testing for cyclists in Copenhagen</title>
<meta name="description" content="A lactate test for cyclists in our lab in Kongens Lyngby. Learn exactly how hard to train, and check in every few weeks. From 375 kr a session.">
<meta name="theme-color" content="#FFFFFF">
<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"><noscript><p style="font-family:sans-serif;padding:24px">NDURE Labs needs JavaScript to book. You can also email contact@ndure.dk.</p></noscript></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`
);
// Security headers for the pages (the Worker sets its own for /api). Cloudflare reads this file.
writeFileSync(
  path.join(out, '_headers'),
  `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
/img/*
  Cache-Control: public, max-age=86400
`
);
console.log('Pages built into public/');
