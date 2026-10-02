import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
await mkdir(publicDir, { recursive: true });

async function decodeText(sourceName, targetName) {
  const source = path.join(publicDir, sourceName);
  const target = path.join(publicDir, targetName);
  const b64 = (await readFile(source, 'utf8')).trim();
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.subarray(0,4).toString('ascii') !== 'RIFF' || bytes.subarray(8,12).toString('ascii') !== 'WEBP') {
    throw new Error(`Invalid WebP generated from ${sourceName}`);
  }
  await writeFile(target, bytes);
  console.log(`Prepared ${targetName}: ${bytes.length} bytes`);
}

await decodeText('monfluxo-logo-premium.b64.txt', 'monfluxo-logo-premium.webp');
await decodeText('monfluxo-background-valid.webp.b64.txt', 'monfluxo-background.webp');

const pagePath = path.join(root, 'app', 'page.js');
let page = await readFile(pagePath, 'utf8');
page = page.replace(/^function BrandMark.*$/m, 'function BrandMark({compact=false}){return <div className={`brand-mark ${compact?"brand-mark-compact":""}`} aria-label="Monfluxo"><img src="/monfluxo-logo-premium.webp?v=valid-raster" alt="MONFLUXO"/></div>}');
page = page.replace(/^function FlowBackground.*$/m, 'function FlowBackground(){return <img className="monfluxo-bg-image" src="/monfluxo-background.webp?v=valid-raster" alt="" aria-hidden="true"/>}');
await writeFile(pagePath, page);

console.log('Validated raster assets prepared and wired directly into the DOM.');
