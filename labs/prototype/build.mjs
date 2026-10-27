// Builds the functional prototype into one HTML file: node labs/prototype/build.mjs [out.html]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, 'dist', 'ndure-labs-prototype.html');

const reactGlobals = {
  name: 'react-globals',
  setup(b) {
    b.onResolve({ filter: /^react(-dom\/client)?$/ }, (a) => ({ path: a.path, namespace: 'g' }));
    b.onLoad({ filter: /.*/, namespace: 'g' }, (a) => ({
      contents: a.path === 'react' ? 'module.exports = window.React' : 'module.exports = window.ReactDOM',
      loader: 'js'
    }));
  }
};

const res = await build({
  entryPoints: [path.join(here, 'app.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  minify: true,
  target: 'es2020',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  tsconfigRaw: { compilerOptions: { jsx: 'react' } },
  plugins: [reactGlobals],
  logLevel: 'warning'
});

const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(path.join(here, 'style.css'), 'utf8');
const html = `<title>NDURE Labs Booking Prototype</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js" crossorigin="anonymous"></script>
<script>
${js}
</script>
`;
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Prototype written to ${out} (${(html.length / 1024).toFixed(0)} KB)`);
