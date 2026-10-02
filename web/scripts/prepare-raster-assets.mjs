import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
await mkdir(publicDir, { recursive: true });

async function decodeText(sourceName, targetName, expectedBytes) {
  const source = path.join(publicDir, sourceName);
  const target = path.join(publicDir, targetName);
  const b64 = (await readFile(source, 'utf8')).trim();
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.subarray(0,4).toString('ascii') !== 'RIFF' || bytes.subarray(8,12).toString('ascii') !== 'WEBP') {
    throw new Error(`Invalid WebP generated from ${sourceName}`);
  }
  if (bytes.length !== expectedBytes) {
    throw new Error(`Unexpected ${targetName} size: ${bytes.length}, expected ${expectedBytes}`);
  }
  await writeFile(target, bytes);
  console.log(`Prepared ${targetName}: ${bytes.length} bytes`);
}

await decodeText('monfluxo-logo-premium.b64.txt', 'monfluxo-logo-premium.webp', 7192);
await decodeText('monfluxo-background-valid.webp.b64.txt', 'monfluxo-background.webp', 7302);

const pagePath = path.join(root, 'app', 'page.js');
let page = await readFile(pagePath, 'utf8');
page = page.replace(/^function BrandMark.*$/m, 'function BrandMark({compact=false}){return <div className={`brand-mark ${compact?"brand-mark-compact":""}`} aria-label="Monfluxo"><img src="/monfluxo-logo-premium.webp?v=user-webp-final-20261002" alt="MONFLUXO"/></div>}');
page = page.replace(/^function FlowBackground.*$/m, 'function FlowBackground(){return <img className="monfluxo-bg-image" src="/monfluxo-background.webp?v=user-webp-final-20261002" alt="" aria-hidden="true"/>}');
await writeFile(pagePath, page);

console.log('Prepared user-selected MONFLUXO WebP logo/background and wired them directly into the DOM.');
