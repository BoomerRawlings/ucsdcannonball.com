import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'parse5';
import { formEmbedUrl, formatSpeed, formatTime, loadSheet, overallFastest, pacificStamp, parseCsv, ranked, readFormUrl, readStandings, straightLineMph } from '../standings.mjs';

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

test('straight-line speed uses the full elapsed precision and rounds only the displayed mph', () => {
  assert.equal(straightLineMph(378), 10);
  assert.equal(straightLineMph(3600), 1.05);
  assert.equal(straightLineMph(256.043), 14.763145252945794);
  assert.equal(formatSpeed(378), '10.0 mph');
  assert.equal(formatSpeed(89.17), '42.4 mph');
  assert.equal(formatSpeed(256.043), '14.8 mph');
});

test('missing, invalid, zero, or overflowing durations never display a speed', () => {
  for (const seconds of [undefined, null, '', '3600', 0, -1, NaN, Infinity, -Infinity, Number.MIN_VALUE]) {
    assert.equal(straightLineMph(seconds), null, String(seconds));
    assert.equal(formatSpeed(seconds), '\u2014', String(seconds));
  }
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

test('only trusted Google respondent URLs can become embeds, without inherited query parameters', () => {
  const form='https://docs.google.com/forms/d/e/example/viewform';
  assert.equal(formEmbedUrl(form), form+'?embedded=true');
  assert.equal(formEmbedUrl(form+'?usp=sharing&entry.123=private#fragment'), form+'?embedded=true');
  for(const url of [null, '', 'https://forms.gle/example', 'javascript:alert(1)',
    'https://docs.google.com.evil.example/forms/d/e/example/viewform',
    'https://user:password@docs.google.com/forms/d/e/example/viewform',
    'https://docs.google.com:444/forms/d/e/example/viewform',
    'http://docs.google.com/forms/d/e/example/viewform',
    'https://docs.google.com/forms/d/example/edit']) {
    assert.equal(formEmbedUrl(url), null, String(url));
  }
});

let appLoadCount = 0;
async function mountApp(t, respond) {
  class Element extends EventTarget {
    attrs = new Map();
    children = [];
    ownText = '';
    srcAssignments = 0;
    get src() { return this.getAttribute('src') || ''; }
    set src(value) { this.setAttribute('src', value); }
    classList = {toggle() {}};
    dataset = {};
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.ownText = String(value); this.children = []; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.ownText = ''; this.children = children; }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); if(name === 'src') this.srcAssignments++; }
    removeAttribute(name) { this.attrs.delete(name); }
    querySelector() { return null; }
  }
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const byId = new Map(), tabs = [];
  function mount(node) {
    const element = new Element(), id = attribute(node, 'id'), division = attribute(node, 'data-division');
    element.hidden = attribute(node, 'hidden') !== undefined;
    for(const {name, value} of node.attrs || []) element.attrs.set(name, value);
    if (node.value) element.textContent = node.value;
    if (id) byId.set(id, element);
    if (division) { element.dataset.division = division; tabs.push(element); }
    for (const child of node.childNodes || []) element.append(mount(child));
    return element;
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
  const requests = [];
  t.mock.method(globalThis, 'fetch', async target => {
    const tab = new URL(target).searchParams.get('sheet');
    requests.push(tab);
    return respond(tab);
  });
  await import('../app.mjs?test=' + ++appLoadCount);
  return {get, tabs, window, requests};
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const csvResponse = table => new Response(table.map(row => row.join(',')).join('\r\n'));

test('acceptance loads verified speeds, divisions preserve ranking, and only Submit requests the form', async t => {
  const form = 'https://docs.google.com/forms/d/e/example/viewform';
  const {get, tabs, window, requests} = await mountApp(t, tab => csvResponse(tab === 'Config'
    ? [['Key', 'Value'], ['FormURL', form]] : [standingsHeader, ...runRows]));
  assert.deepEqual(requests, []);
  assert.equal(get('app').hidden, true);
  assert.equal(get('form-embed').getAttribute('src'), null);
  assert.equal(get('embedded-entry').hidden, true);
  get('enter').dispatchEvent(new Event('click'));
  assert.match(get('standings-state').textContent, /^Loading verified runs/);
  assert.equal(get('record-speed').hidden, true);
  assert.deepEqual(get('standings-body').children, []);
  await settle();
  assert.deepEqual(requests, ['Standings']);
  assert.equal(get('gate').hidden, true);
  assert.equal(get('leaderboard').hidden, false);
  assert.equal(get('record-handle').textContent, '@glider');
  assert.equal(get('record-time').textContent, '1:29.17');
  assert.equal(get('record-speed').textContent, 'Straight-line avg. 42.4 mph');
  assert.equal(get('record-speed').hidden, false);
  assert.match(get('record-clock').textContent, /11:05\s*PM/i);
  const [humanRow] = get('standings-body').children;
  assert.equal(humanRow.children.length, 4, 'the existing four-column table remains intact');
  assert.deepEqual(humanRow.children[2].children.map(span => span.textContent), ['1:29.17', '42.4 mph']);
  assert.equal(humanRow.children[2].children[1].className, 'run-speed');

  tabs.find(tab => tab.dataset.division === 'Motorized').dispatchEvent(new Event('click'));
  assert.equal(get('record-handle').textContent, '@relay');
  assert.equal(get('record-speed').textContent, 'Straight-line avg. 39.2 mph');
  const rows = get('standings-body').children;
  assert.deepEqual(rows.map(row => row.children[1].textContent), ['@relay', '@glider', '@coast']);
  assert.deepEqual(rows.map(row => row.children[2].children[1].textContent), ['39.2 mph', '31.2 mph', '12.5 mph']);
  assert.deepEqual(requests, ['Standings']);
  assert.doesNotMatch(get('opening-post').textContent, /mph|straight.line/i, 'unverified opening time has no speed');

  assert.equal(get('form-embed').getAttribute('src'), null, 'the form stays unloaded before Submit');
  location.hash = '#submit';
  window.dispatchEvent(new Event('hashchange'));
  await settle();
  assert.deepEqual(requests, ['Standings', 'Config']);
  assert.equal(get('submit').hidden, false);
  assert.equal(get('form-link').hidden, false);
  assert.equal(get('form-link').href, form);
  const iframe=get('form-embed');
  assert.equal(iframe.src, form+'?embedded=true');
  assert.equal(iframe.srcAssignments, 1);
  assert.equal(get('embedded-entry').hidden, false);
  for(const view of ['about', 'submit']) {
    location.hash='#'+view;
    window.dispatchEvent(new Event('hashchange'));
    await settle();
  }
  assert.deepEqual(requests, ['Standings', 'Config']);
  assert.equal(get('form-embed'), iframe, 'navigation retains the same embedded form and its draft');
  assert.equal(iframe.srcAssignments, 1, 'navigation must not reload the iframe');
});

test('an empty approved board keeps the empty state and does not infer speed from the pending opening time', async t => {
  const {get} = await mountApp(t, () => csvResponse([standingsHeader]));
  get('enter').dispatchEvent(new Event('click'));
  await settle();
  assert.deepEqual(get('standings-body').children, []);
  assert.equal(get('record-speed').hidden, true);
  assert.equal(get('record-speed').textContent, '');
  assert.equal(get('record-handle').textContent, 'First record unclaimed');
  assert.match(get('standings-state').textContent, /No verified human-powered finishes yet/);
  assert.equal(get('retry').hidden, true);
  assert.equal(get('opening-post').hidden, false);
  assert.match(get('opening-post').textContent, /pending verification/i);
  assert.doesNotMatch(get('opening-post').textContent, /mph|straight.line/i);
});

test('load failure and retry retain their states and show speed only after approved valid results arrive', async t => {
  let respond;
  const {get, requests} = await mountApp(t, () => new Promise(resolve => { respond = resolve; }));
  get('enter').dispatchEvent(new Event('click'));
  respond(new Response('Unavailable', {status: 503}));
  await settle();
  assert.match(get('standings-state').textContent, /live results sheet is unavailable/i);
  assert.equal(get('record-handle').textContent, 'Live times unavailable');
  assert.equal(get('record-speed').hidden, true);
  assert.deepEqual(get('standings-body').children, []);
  assert.equal(get('retry').hidden, false);

  get('retry').dispatchEvent(new Event('click'));
  assert.deepEqual(requests, ['Standings', 'Standings']);
  assert.match(get('standings-state').textContent, /^Loading verified runs/);
  assert.equal(get('record-speed').hidden, true);
  respond(csvResponse([standingsHeader, ...runRows,
    ['@invalid', 'Human-powered', '0', runRows[0][3]],
    ['@missing', 'Motorized', '', runRows[0][3]],
  ]));
  await settle();
  assert.equal(get('record-speed').textContent, 'Straight-line avg. 42.4 mph');
  assert.equal(get('record-speed').hidden, false);
  assert.equal(get('retry').hidden, true);
  assert.equal(get('standings-state').hidden, true);
  assert.deepEqual(get('standings-body').children.map(row => row.children[1].textContent), ['@glider']);
});

test('a short Google Form URL keeps the external fallback without attempting an embed', async t => {
  const form='https://forms.gle/example';
  const {get}=await mountApp(t, tab => csvResponse(tab==='Config'
    ? [['Key','Value'],['FormURL',form]] : [standingsHeader]));
  location.hash='#submit';
  get('enter').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(get('form-link').href, form);
  assert.equal(get('form-link').hidden, false);
  assert.equal(get('form-embed').getAttribute('src'), null);
  assert.equal(get('form-embed').srcAssignments, 0);
  assert.equal(get('embedded-entry').hidden, true);
  assert.equal(get('form-retry').hidden, true);
  assert.equal(get('form-state').textContent, 'No sign-in required.');
});

test('missing, malicious, and failed form configuration keep the existing retryable states without loading an iframe', async t => {
  for(const [name, response, status] of [
    ['missing', () => csvResponse([['Key','Value']]), 'Submissions have not opened yet.'],
    ['unsafe', () => csvResponse([['Key','Value'],['FormURL','https://docs.google.com.evil.example/forms/d/e/example/viewform']]), 'Submissions have not opened yet.'],
    ['failed', () => new Response('Unavailable',{status:503}), 'The submission form is currently unavailable. Please check back.'],
  ]) await t.test(name, async t => {
    const {get}=await mountApp(t, tab => tab==='Config' ? response() : csvResponse([standingsHeader]));
    location.hash='#submit';
    get('enter').dispatchEvent(new Event('click'));
    await settle();
    assert.equal(get('form-state').textContent, status);
    assert.equal(get('form-link').hidden, true);
    assert.equal(get('form-link').getAttribute('href'), null);
    assert.equal(get('form-embed').getAttribute('src'), null);
    assert.equal(get('form-embed').srcAssignments, 0);
    assert.equal(get('embedded-entry').hidden, true);
    assert.equal(get('form-retry').hidden, false);
  });
});

test('delayed form configuration is deduplicated across navigation and never returns visitors to Submit', async t => {
  const form='https://docs.google.com/forms/d/e/example/viewform';
  let finishConfig;
  const {get, window, requests}=await mountApp(t, tab => tab==='Config'
    ? new Promise(resolve => { finishConfig=resolve; }) : csvResponse([standingsHeader]));
  const iframe=get('form-embed');
  location.hash='#submit';
  get('enter').dispatchEvent(new Event('click'));
  assert.match(get('form-state').textContent, /Checking entry availability/);
  assert.equal(get('form-link').hidden, true);
  assert.equal(iframe.srcAssignments, 0);
  for(const view of ['about', 'submit', 'about']) {
    location.hash='#'+view;
    window.dispatchEvent(new Event('hashchange'));
  }
  get('form-retry').dispatchEvent(new Event('click'));
  assert.deepEqual(requests, ['Config', 'Standings']);
  assert.equal(get('about').hidden, false);
  assert.equal(get('submit').hidden, true);
  finishConfig(csvResponse([['Key','Value'],['FormURL',form]]));
  await settle();
  assert.equal(location.hash, '#about');
  assert.equal(get('about').hidden, false, 'finishing the Config request must not change the active page');
  assert.equal(get('submit').hidden, true);
  assert.equal(iframe.src, form+'?embedded=true');
  assert.equal(iframe.srcAssignments, 1);
  location.hash='#submit';
  window.dispatchEvent(new Event('hashchange'));
  get('form-retry').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(get('submit').hidden, false);
  assert.equal(get('form-embed'), iframe);
  assert.equal(iframe.srcAssignments, 1, 'returning or an extra retry must preserve the iframe draft');
  assert.deepEqual(requests, ['Config', 'Standings']);
});

test('a failed Config request can retry successfully without duplicate reads or iframe resets', async t => {
  const form='https://docs.google.com/forms/d/e/example/viewform';
  let finishConfig;
  const {get, requests}=await mountApp(t, tab => tab==='Config'
    ? new Promise(resolve => { finishConfig=resolve; }) : csvResponse([standingsHeader]));
  location.hash='#submit';
  get('enter').dispatchEvent(new Event('click'));
  finishConfig(new Response('Unavailable',{status:503}));
  await settle();
  assert.equal(get('form-retry').hidden, false);
  assert.match(get('form-state').textContent, /currently unavailable/);
  assert.equal(get('form-link').hidden, true);
  assert.equal(get('form-embed').srcAssignments, 0);
  get('form-retry').dispatchEvent(new Event('click'));
  get('form-retry').dispatchEvent(new Event('click'));
  assert.deepEqual(requests, ['Config', 'Standings', 'Config']);
  assert.match(get('form-state').textContent, /Checking entry availability/);
  assert.equal(get('embedded-entry').hidden, true);
  finishConfig(csvResponse([['Key','Value'],['FormURL',form]]));
  await settle();
  assert.equal(get('form-link').hidden, false);
  assert.equal(get('form-link').href, form);
  assert.equal(get('embedded-entry').hidden, false);
  assert.equal(get('form-embed').srcAssignments, 1);
  assert.equal(get('form-retry').hidden, true);
  get('form-retry').dispatchEvent(new Event('click'));
  await settle();
  assert.deepEqual(requests, ['Config', 'Standings', 'Config']);
  assert.equal(get('form-embed').srcAssignments, 1);
});
