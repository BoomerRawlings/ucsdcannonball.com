import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'parse5';
import { formatTime, loadSheet, overallFastest, pacificStamp, parseCsv, ranked, readFormUrl, readStandings } from '../standings.mjs';

const standingsHeader = ['Handle', 'Division', 'Elapsed seconds', 'Completed at'];
const runRows = [
  ['@coast', 'Motorized', '303.08', '2026-07-02T06:15:00Z'],
  ['@glider', 'Human-powered', '89.17', '2026-01-03T07:05:00Z'],
  ['@relay', 'Motorized', '96.31', '2026-07-01T21:05:00Z'],
  ['@glider', 'Human-powered', '112.4', '2026-01-05T01:00:00Z'],
  ['@glider', 'Motorized', '121', '2026-01-06T06:00:00Z'],
];

const attribute = (node, name) => node.attrs?.find(item => item.name === name)?.value;

function visibleNodes(node) {
  if (['head', 'script', 'style', 'template', 'noscript'].includes(node.tagName)
      || attribute(node, 'hidden') !== undefined || attribute(node, 'aria-hidden') === 'true') return [];
  return [node, ...(node.childNodes || []).flatMap(visibleNodes)];
}

test('fresh visitors see the safety agreement before any leaderboard rows', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const visible = visibleNodes(parse(html));
  const copy = visible.map(node => node.value || '').join(' ').replace(/\s+/g, ' ');
  assert.match(copy, /not affiliated|unaffiliated|independent/i);
  assert.match(copy, /be safe/i);
  assert.match(copy, /obey (?:all |the )?laws/i);
  assert.ok(visible.some(node => attribute(node, 'id') === 'enter'), 'visitors must be able to accept the agreement');
  assert.ok(!visible.some(node => attribute(node, 'id') === 'app'), 'the timing board must be gated');
  assert.ok(!visible.some(node => node.tagName === 'tr'), 'standings must be gated in the delivered HTML');
});

test('Google CSV fields preserve quoted handles and escaped double quotes', () => {
  assert.deepEqual(parseCsv('Handle,Division\r\n"@seaside, ""north""",Motorized'), [
    ['Handle', 'Division'], ['@seaside, "north"', 'Motorized'],
  ]);
});

test('the fastest run determines the opening division and each division ranks personal bests', () => {
  const runs = readStandings([standingsHeader, ...runRows]);
  const fastest = overallFastest(runs);
  assert.equal(fastest.handle, '@glider');
  assert.equal(fastest.seconds, 89.17);
  assert.equal(fastest.division, 'Human-powered');
  assert.deepEqual(ranked(runs, 'Motorized').map(run => run.handle), ['@relay', '@glider', '@coast']);
  assert.deepEqual(ranked(runs, 'Human-powered').map(run => run.seconds), [89.17]);
  const fasterMotorized = readStandings([standingsHeader, ['@relay', 'Motorized', '88.92', runRows[0][3]]]);
  assert.equal(overallFastest([...runs, ...fasterMotorized]).division, 'Motorized');
});

test('ties favor the earlier completion, including timestamps with different UTC offsets', () => {
  const rows = [
    ['@later', 'Motorized', '91', '2026-07-01T08:05:00-07:00'],
    ['@first', 'Motorized', '91.00', '2026-07-01T15:02:00Z'],
  ];
  for (const input of [rows, rows.toReversed()]) {
    const fastest = overallFastest(readStandings([standingsHeader, ...input]));
    assert.equal(fastest.handle, '@first');
  }
});

test('Pacific completion dates cross UTC midnight and adjust for daylight saving time', () => {
  const winter = pacificStamp('2026-01-03T07:05:00Z');
  const summer = pacificStamp('2026-07-02T06:15:00Z');
  assert.match(winter.date, /Jan(?:uary)?\s+0?2,?\s+2026/i);
  assert.match(winter.time, /11:05\s*PM/i);
  assert.match(summer.date, /Jul(?:y)?\s+0?1,?\s+2026/i);
  assert.match(summer.time, /11:15\s*PM/i);
  assert.equal(formatTime(89.17), '1:29.17');
  assert.equal(formatTime(256.043), '4:16.043');
  assert.equal(formatTime(256.43), '4:16.43');
  assert.equal(readStandings([standingsHeader, ['runner', 'Human-powered', '256.043', '2026-11-04T15:15:00Z']])[0].seconds, 256.043);
});

test('zero and malformed times or unknown divisions cannot establish a record', () => {
  const date = runRows[0][3];
  const bogus = [
    ['@empty', 'Human-powered', '', date], ['@zero', 'Motorized', '0', date],
    ['@backwards', 'Motorized', '-9', date], ['@infinite', 'Motorized', 'Infinity', date],
    ['@lost', 'Unclassified', '13', date], ['@undated', 'Human-powered', '13', 'bad date'],
  ];
  assert.deepEqual(readStandings([standingsHeader, ...bogus]), []);
  assert.deepEqual(readStandings([standingsHeader]), []);
  assert.equal(overallFastest([]), null);
});

test('every website run contains only approved public result fields', () => {
  const [run] = readStandings([[...standingsHeader, 'Notes', 'Proof URL'], [...runRows[0], 'private notes', 'https://example.com/private']]);
  assert.deepEqual(run, {handle: '@coast', division: 'Motorized', seconds: 303.08, completed: runRows[0][3]});
  assert.throws(() => readStandings([['Timestamp', 'Handle', 'Notes', 'Proof URL']]));
});

test('the browser fetches specific public columns without credentials and refuses a private tab', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(standingsHeader.join(',')));
  assert.deepEqual(await loadSheet('Standings'), [standingsHeader]);
  await loadSheet('Config');
  await assert.rejects(loadSheet('Form Responses 1'));
  assert.equal(fetch.mock.callCount(), 2);
  for (const [i, tab, columns] of [[0, 'Standings', 'A,B,C,D'], [1, 'Config', 'A,B']]) {
    const [target, options] = fetch.mock.calls[i].arguments;
    const url = new URL(target);
    assert.equal(url.origin, 'https://docs.google.com');
    assert.equal(url.searchParams.get('sheet'), tab);
    assert.equal(url.searchParams.get('tq'), 'select ' + columns);
    assert.equal(options.credentials, 'omit');
  }
});

test('a Google access failure or login page cannot masquerade as an empty board', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('denied', {status: 403}));
  await assert.rejects(loadSheet('Standings'));
  fetch.mock.mockImplementation(async () => new Response('<!doctype html><title>Sign in</title>', {headers: {'Content-Type': 'text/html'}}));
  await assert.rejects(loadSheet('Standings'));
});

test('submission handoff uses a responder URL from the designated config row', () => {
  const form = 'https://docs.google.com/forms/d/e/1FAIpQLSampleVerifiedFormId/viewform';
  const config = url => [['Key', 'Value'], ['FormURL', url]];
  assert.equal(readFormUrl(config(form)), form);
  for (const url of ['', 'javascript:alert(1)', 'https://docs.google.com.evil.example/forms/d/e/foo/viewform',
    'https://docs.google.com/forms/d/a-real-form/edit']) {
    assert.ok(!readFormUrl(config(url)), url);
  }
  assert.ok(!readFormUrl([['Key', 'Value'], ['OtherKey', form]]));
});

test('acceptance loads the record, division buttons switch it, and only Submit requests the form', async t => {
  class Element extends EventTarget {
    attrs = new Map();
    children = [];
    classList = {toggle() {}};
    dataset = {};
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attrs.set(name, value); }
    removeAttribute(name) { this.attrs.delete(name); }
    querySelector() { return null; }
  }
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const byId = new Map(), tabs = [];
  function mount(node) {
    const element = new Element(), id = attribute(node, 'id'), division = attribute(node, 'data-division');
    element.hidden = attribute(node, 'hidden') !== undefined;
    if (id) byId.set(id, element);
    if (division) { element.dataset.division = division; tabs.push(element); }
    node.childNodes?.forEach(mount);
  }
  mount(parse(html));
  const get = id => byId.get(id);
  const window = Object.assign(new EventTarget(), {matchMedia: () => ({matches: true}), scrollTo() {}});
  const document = Object.assign(new EventTarget(), {
    getElementById: get, createElement: () => new Element(),
    querySelectorAll: selector => selector === '[data-division]' ? tabs : [],
  });
  Object.assign(globalThis, {window, document, location: {hash: ''}});
  t.after(() => { delete globalThis.window; delete globalThis.document; delete globalThis.location; });

  const requests = [], form = 'https://docs.google.com/forms/d/e/example/viewform';
  t.mock.method(globalThis, 'fetch', async target => {
    const tab = new URL(target).searchParams.get('sheet');
    requests.push(tab);
    const table = tab === 'Config' ? [['Key', 'Value'], ['FormURL', form]] : [standingsHeader, ...runRows];
    return new Response(table.map(row => row.join(',')).join('\r\n'));
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await import('../app.mjs');
  assert.deepEqual(requests, []);
  assert.equal(get('app').hidden, true);
  get('enter').dispatchEvent(new Event('click'));
  await settle();
  assert.deepEqual(requests, ['Standings']);
  assert.equal(get('gate').hidden, true);
  assert.equal(get('leaderboard').hidden, false);
  assert.equal(get('record-handle').textContent, '@glider');
  assert.equal(get('record-time').textContent, '1:29.17');
  assert.match(get('record-clock').textContent, /11:05\s*PM/i);

  tabs.find(tab => tab.dataset.division === 'Motorized').dispatchEvent(new Event('click'));
  assert.equal(get('record-handle').textContent, '@relay');
  assert.deepEqual(get('standings-body').children.map(row => row.children[1].textContent), ['@relay', '@glider', '@coast']);
  assert.deepEqual(requests, ['Standings']);

  location.hash = '#submit';
  window.dispatchEvent(new Event('hashchange'));
  await settle();
  assert.deepEqual(requests, ['Standings', 'Config']);
  assert.equal(get('submit').hidden, false);
  assert.equal(get('form-link').hidden, false);
  assert.equal(get('form-link').href, form);
});
