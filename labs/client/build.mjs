// Builds the pages into /public. Cloudflare runs this before each deploy (see wrangler.jsonc).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

const css = readFileSync(path.join(here, '..', 'prototype', 'style.css'), 'utf8') + readFileSync(path.join(here, 'extra.css'), 'utf8');
writeFileSync(path.join(out, 'app.css'), css);
writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>NDURE Labs</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
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
`
);
console.log('Pages built into public/');
