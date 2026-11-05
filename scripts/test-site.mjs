import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'parse5';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const nodes = [];
function walk(node) {
  nodes.push(node);
  node.childNodes?.forEach(walk);
}
walk(parse(html));
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;

async function assertLocalFile(reference, from) {
  if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(reference)) return;
  const target = reference.startsWith('/')
    ? new URL(reference.slice(1) || 'index.html', root)
    : new URL(reference, from);
  target.search = '';
  target.hash = '';
  assert.ok(target.href.startsWith(root.href), `Asset must stay inside the site: ${reference}`);
  assert.ok((await stat(target)).isFile(), `Missing local asset: ${reference}`);
}

test('standalone identity and home link use the new root domain with no reverse personal link', async () => {
  assert.equal(attr(nodes.find(node => node.tagName === 'link' && attr(node, 'rel') === 'canonical'), 'href'),
    'https://ucsdcannonball.com/');
  assert.equal(attr(nodes.find(node => attr(node, 'aria-label') === 'Cannonball home'), 'href'), '/');
  for (const file of ['index.html', 'app.mjs', 'standings.mjs', 'cannonball.css']) {
    const content = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(content, /boomerrawlings\.com|(?:href|src)=["']\/cannonball\//i);
  }
});

test('HTML, responsive images, fonts, styles, and module imports resolve at the new site root', async () => {
  const ids = new Set(nodes.map(node => attr(node, 'id')).filter(Boolean));
  for (const node of nodes) {
    for (const key of ['href', 'src']) {
      const value = attr(node, key);
      if (!value) continue;
      if (value.startsWith('#')) assert.ok(ids.has(value.slice(1)), `Missing anchor: ${value}`);
      await assertLocalFile(value, new URL('index.html', root));
    }
    for (const source of (attr(node, 'srcset') || '').split(',').filter(Boolean)) {
      await assertLocalFile(source.trim().split(/\s+/)[0], new URL('index.html', root));
    }
  }
  const css = await readFile(new URL('cannonball.css', root), 'utf8');
  for (const match of css.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)) {
    await assertLocalFile(match[1], new URL('cannonball.css', root));
  }
  for (const file of ['app.mjs', 'standings.mjs']) {
    const code = await readFile(new URL(file, root), 'utf8');
    for (const match of code.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      await assertLocalFile(match[1], new URL(file, root));
    }
  }
});

test('leaderboard explains the straight-line average beside the existing elapsed column', () => {
  const text = node => (node.value || '') + (node.childNodes || []).map(text).join('');
  const table = nodes.find(node => node.tagName === 'table');
  const note = nodes.find(node => attr(node, 'id') === 'speed-note');
  assert.ok(note, 'the speed calculation must have a visible explanation');
  assert.ok((attr(table, 'aria-describedby') || '').split(/\s+/).includes('speed-note'));
  assert.equal(attr(note, 'hidden'), undefined);
  assert.match(text(note), /1\.05.mile/i);
  assert.match(text(note), /crow.flies/i);
  assert.match(text(note), /not (?:the )?actual route distance/i);
  const headers = nodes.filter(node => node.tagName === 'th' && attr(node, 'scope') === 'col');
  assert.equal(headers.length, 4);
  assert.match(text(headers[2]), /Elapsed[\s\S]*Straight-line avg\./i);
  const recordSpeed = nodes.find(node => attr(node, 'id') === 'record-speed');
  assert.ok(recordSpeed);
  assert.notEqual(attr(recordSpeed, 'hidden'), undefined, 'no speed appears before a verified record loads');
});
