import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const assetsDir = path.join(root, 'assets');
await mkdir(publicDir, { recursive: true });

async function decode(name) {
  const source = path.join(assetsDir, `${name}.b64`);
  const target = path.join(publicDir, name);
  const b64 = (await readFile(source, 'utf8')).trim();
  await writeFile(target, Buffer.from(b64, 'base64'));
}

await decode('monfluxo-logo.webp');
await decode('monfluxo-background.webp');

// The repository historically rendered inline/external SVGs in these two helper components.
// Replace them in the build workspace so the production bundle contains raster assets only.
const pagePath = path.join(root, 'app', 'page.js');
let page = await readFile(pagePath, 'utf8');
page = page.replace(/^function BrandMark.*$/m, 'function BrandMark({compact=false}){return <div className={`brand-mark ${compact?"brand-mark-compact":""}`} aria-label="Monfluxo"><img src="/monfluxo-logo.webp" alt="MONFLUXO"/></div>}');
page = page.replace(/^function FlowBackground.*$/m, 'function FlowBackground(){return null}');
await writeFile(pagePath, page);

console.log('Prepared MONFLUXO raster logo/background and removed SVG visual helpers from production build.');
