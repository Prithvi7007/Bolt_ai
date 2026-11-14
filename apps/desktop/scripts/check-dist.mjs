// Build contract: Vite emits relative, local assets and preserves the CSP.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (!html.includes('Content-Security-Policy') || !html.includes("object-src 'none'")) {
  throw new Error('Renderer Content Security Policy is missing');
}
if (html.includes('src="/src/main.tsx"')) {
  throw new Error('Vite HTML was not compiled');
}
const assets = join(dist, 'assets');
const emitted = readdirSync(assets).filter(name => statSync(join(assets, name)).isFile());
const scripts = emitted.filter(name => name.endsWith('.js'));
const styles = emitted.filter(name => name.endsWith('.css'));
if (!scripts.length || !styles.length) throw new Error('Missing compiled JS or CSS asset');
for (const name of [...scripts, ...styles]) {
  if (!html.includes('./assets/' + name)) {
    throw new Error('Compiled asset is not referenced using a relative path: ' + name);
  }
}
console.log('BOLT desktop renderer verified: CSP, relative compiled JS and CSS.');
