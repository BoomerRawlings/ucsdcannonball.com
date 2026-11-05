import { cp, mkdir, copyFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await mkdir(output, {recursive: true});
for (const file of ['index.html', 'cannonball.css', 'app.mjs', 'standings.mjs', '.nojekyll']) {
  await copyFile(new URL(file, root), new URL(file, output));
}
await cp(new URL('assets/', root), new URL('assets/', output), {recursive: true});
console.log('Packaged Cannonball public files in dist/.');
