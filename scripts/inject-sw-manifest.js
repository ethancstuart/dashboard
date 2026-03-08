/**
 * Post-build script: reads Vite's manifest and injects asset list into the built SW.
 * Run after `vite build` to enable precaching of hashed assets.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const distDir = resolve('dist');
const swPath = resolve(distDir, 'sw.js');

if (!existsSync(swPath)) {
  console.log('No sw.js in dist/, skipping SW manifest injection');
  process.exit(0);
}

// Read Vite manifest to get hashed asset paths
const assets = ['/'];
const manifestPath = resolve(distDir, '.vite/manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  for (const entry of Object.values(manifest)) {
    const e = /** @type {{ file?: string, css?: string[] }} */ (entry);
    if (e.file) assets.push('/' + e.file);
    if (e.css) assets.push(...e.css.map(c => '/' + c));
  }
}

// Also include index.html
if (!assets.includes('/index.html')) {
  assets.push('/index.html');
}

// Inject into SW — replace the empty array with the asset list
let swContent = readFileSync(swPath, 'utf-8');
swContent = swContent.replace(
  /const PRECACHE_ASSETS = \[\];\s*\/\/\s*__PRECACHE_INJECT__/,
  `const PRECACHE_ASSETS = ${JSON.stringify([...new Set(assets)])}; // __PRECACHE_INJECT__`
);

writeFileSync(swPath, swContent);
console.log(`Injected ${assets.length} assets into sw.js for precaching`);
