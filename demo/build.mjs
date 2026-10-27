// Builds the clickable demo into one HTML file: npm run demo
// React is loaded from cdnjs; everything else (app code, fake backend, CSS) is inlined.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(root, 'demo', 'dist', 'ndure-labs-demo.html');

const globals = {
  name: 'react-globals',
  setup(b) {
    b.onResolve({ filter: /^react(-dom\/client)?$/ }, (a) => ({ path: a.path, namespace: 'g' }));
    b.onLoad({ filter: /.*/, namespace: 'g' }, (a) => ({
      contents: a.path === 'react' ? 'module.exports = window.React' : 'module.exports = window.ReactDOM',
      loader: 'js'
    }));
    // Server code never runs in the demo; type only imports of it are erased anyway.
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'empty' }));
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
  }
};

const res = await build({
  entryPoints: [path.join(root, 'demo', 'main.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  minify: true,
  target: 'es2020',
  // Classic JSX against the React 18 global; the app's tsconfig asks for React 19's automatic runtime.
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  tsconfigRaw: { compilerOptions: { jsx: 'react' } },
  alias: { '@': path.join(root, 'src') },
  define: { 'process.env': '{}' },
  plugins: [globals],
  logLevel: 'warning'
});

const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(path.join(root, 'src', 'app', 'globals.css'), 'utf8') + '\n' + readFileSync(path.join(root, 'demo', 'demo.css'), 'utf8');

const html = `<title>NDURE Labs Booking Demo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600&family=Martian+Mono:wght@400;500&display=swap">
<style>
:root { color-scheme: light; }
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
console.log(`Demo written to ${out} (${(html.length / 1024).toFixed(0)} KB)`);
