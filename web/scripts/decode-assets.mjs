import fs from 'node:fs';
const pairs=[['public/monfluxo-logo-fixed.webp.b64','public/monfluxo-logo-fixed.webp'],['public/monfluxo-background-fixed.webp.b64','public/monfluxo-background-fixed.webp']];
for(const [src,dst] of pairs){const b64=fs.readFileSync(src,'utf8').trim();fs.writeFileSync(dst,Buffer.from(b64,'base64'));console.log('decoded',dst)}
