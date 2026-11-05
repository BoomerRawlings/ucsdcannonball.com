import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';
import {invite, inviteLinks, initInvite} from '../share.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
function mount(nav = {}) {
  const doc = {activeElement: null};
  class Element extends EventTarget {
    hidden = true;
    disabled = false;
    open = false;
    textContent = '';
    value = '';
    showCount = 0;
    selectCount = 0;
    focus() { if (!this.disabled) doc.activeElement = this; }
    select() { this.selectCount++; }
    showModal() { this.open = true; this.showCount++; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
    getBoundingClientRect() { return {left: 100, right: 400, top: 100, bottom: 500}; }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const ids = ['open','dialog','native','copy','url','status','close','whatsapp','x','email'];
  const elements = Object.fromEntries(ids.map(id => [id,new Element()]));
  doc.getElementById = id => elements[id.replace(/^invite-/, '')];
  initInvite(doc,nav);
  return {doc, ...elements};
}

test('invite destinations contain only the canonical public URL and neutral copy', () => {
  assert.equal(invite.url,'https://ucsdcannonball.com/');
  assert.equal(invite.title,'UCSD Cannonball');
  assert.equal(invite.text,'Think you can beat the clock? Try the UCSD Cannonball campus time trial.');
  const whatsapp = new URL(inviteLinks.whatsapp), x = new URL(inviteLinks.x), email = new URL(inviteLinks.email);
  assert.equal(whatsapp.origin + whatsapp.pathname,'https://wa.me/');
  assert.equal(whatsapp.searchParams.get('text'),invite.text + ' ' + invite.url);
  assert.equal(x.origin + x.pathname,'https://twitter.com/intent/tweet');
  assert.equal(x.searchParams.get('text'),invite.text);
  assert.equal(x.searchParams.get('url'),invite.url);
  assert.equal(email.protocol,'mailto:');
  assert.equal(email.pathname,'', 'email opens a draft without a recipient');
  assert.equal(email.searchParams.get('subject'),invite.title);
  assert.equal(email.searchParams.get('body'),invite.text + '\n' + invite.url);
});

test('the shared footer opens a labeled native dialog with a manual copy fallback', async () => {
  const nodes = [];
  const visit = node => { nodes.push(node); node.childNodes?.forEach(visit); };
  visit(parse(await readFile(new URL('../index.html',import.meta.url),'utf8')));
  const attr = (node,name) => node.attrs?.find(item => item.name === name)?.value;
  const find = id => nodes.find(node => attr(node,'id') === id);
  const dialog = find('invite-dialog'), trigger = find('invite-open'), input = find('invite-url');
  assert.equal(dialog.tagName,'dialog');
  assert.equal(attr(dialog,'aria-labelledby'),'invite-title');
  assert.equal(attr(dialog,'aria-describedby'),'invite-description');
  assert.equal(trigger.parentNode.tagName,'footer');
  assert.equal(attr(trigger,'aria-controls'),'invite-dialog');
  assert.equal(attr(trigger,'aria-haspopup'),'dialog');
  assert.equal(attr(find('invite-close'),'type'),'button');
  assert.ok(nodes.some(node => node.tagName === 'label' && attr(node,'for') === 'invite-url'));
  assert.notEqual(attr(input,'readonly'),undefined);
  assert.equal(attr(input,'value'),invite.url);
  assert.equal(attr(find('invite-status'),'role'),'status');
  for (const id of ['invite-whatsapp','invite-x']) {
    assert.match(attr(find(id),'rel'),/noopener/);
    assert.match(attr(find(id),'rel'),/noreferrer/);
  }
});

test('supported native sharing uses the canonical payload once per pending action', async () => {
  const pending = deferred(), calls = [];
  const ui = mount({share: data => { calls.push(data); return pending.promise; }, canShare: () => true});
  assert.equal(ui.open.hidden,false);
  assert.equal(ui.native.hidden,false);
  assert.equal(ui.url.value,invite.url);
  ui.open.click(); ui.open.click();
  assert.equal(ui.dialog.showCount,1);
  assert.equal(ui.doc.activeElement,ui.native);
  ui.native.click(); ui.native.click();
  assert.deepEqual(calls,[invite]);
  assert.equal(ui.native.disabled,true);
  assert.equal(ui.copy.disabled,false);
  assert.match(ui.native.textContent,/Opening share options/);
  pending.resolve(); await settle();
  assert.equal(ui.native.disabled,false);
  assert.equal(ui.copy.disabled,false);
  assert.equal(ui.dialog.open,true);
  assert.match(ui.status.textContent,/choose where to send/);
});

test('unsupported or rejected canShare leaves copy and app options available', () => {
  for (const nav of [{}, {share() {},canShare: () => false}, {share() {},canShare() { throw new Error('unsupported'); }}]) {
    const ui = mount(nav);
    ui.open.click();
    assert.equal(ui.native.hidden,true);
    assert.equal(ui.copy.disabled,false);
    assert.equal(ui.doc.activeElement,ui.copy);
    for (const name of ['whatsapp','x','email']) assert.equal(ui[name].href,inviteLinks[name]);
  }
});

test('native cancellation stays calm and native failure offers working fallbacks', async () => {
  for (const name of ['AbortError','NotAllowedError','InvalidStateError']) {
    const ui = mount({share: async () => { throw Object.assign(new Error('not sent'),{name}); }});
    ui.open.click(); ui.native.click(); await settle();
    assert.equal(ui.dialog.open,true);
    assert.equal(ui.copy.disabled,false);
    assert.match(ui.status.textContent,name === 'AbortError' ? /Sharing canceled/ : /Copy the link or choose an app/);
  }
});

test('copy writes only the public URL and ignores duplicate taps while pending', async () => {
  const pending = deferred(), calls = [];
  const ui = mount({clipboard:{writeText: value => { calls.push(value); return pending.promise; }}});
  ui.open.click(); ui.copy.click(); ui.copy.click();
  assert.deepEqual(calls,[invite.url]);
  assert.equal(ui.copy.disabled,true);
  pending.resolve(); await settle();
  assert.equal(ui.copy.disabled,false);
  assert.equal(ui.url.selectCount,0);
  assert.match(ui.status.textContent,/Link copied/);
});

test('missing or denied clipboard selects the visible URL for manual copying', async () => {
  for (const nav of [{}, {clipboard:{writeText: async () => { throw new Error('denied'); }}}]) {
    const ui = mount(nav);
    ui.open.click(); ui.copy.click(); await settle();
    assert.equal(ui.url.value,invite.url);
    assert.equal(ui.url.selectCount,1);
    assert.equal(ui.doc.activeElement,ui.url);
    assert.match(ui.status.textContent,/link is selected/);
    assert.equal(ui.copy.disabled,false);
  }
});

test('closing and reopening does not let late clipboard failure steal focus or report stale results', async () => {
  const pending = deferred();
  const ui = mount({clipboard:{writeText: () => pending.promise}});
  ui.open.click(); ui.copy.click(); ui.close.click();
  assert.equal(ui.dialog.open,false);
  assert.equal(ui.doc.activeElement,ui.open);
  ui.open.click();
  assert.equal(ui.copy.disabled,true);
  ui.close.focus();
  pending.reject(new Error('late denial')); await settle();
  assert.equal(ui.dialog.open,true);
  assert.equal(ui.copy.disabled,false);
  assert.equal(ui.url.selectCount,0);
  assert.equal(ui.doc.activeElement,ui.close);
  assert.equal(ui.status.textContent,'');
});

test('late native completion cannot reopen a dismissed dialog', async () => {
  const pending = deferred();
  const ui = mount({share: () => pending.promise});
  ui.open.click(); ui.native.click(); ui.close.click();
  pending.resolve(); await settle();
  assert.equal(ui.dialog.open,false);
  assert.equal(ui.doc.activeElement,ui.open);
  ui.open.click();
  assert.equal(ui.status.textContent,'');
  assert.equal(ui.native.disabled,false);
});

test('backdrop dismissal returns focus and an old close event cannot steal a reopened dialog focus', () => {
  const ui = mount();
  ui.open.click();
  const inside = Object.assign(new Event('click'),{clientX:200,clientY:200});
  ui.dialog.dispatchEvent(inside);
  assert.equal(ui.dialog.open,true);
  const outside = Object.assign(new Event('click'),{clientX:50,clientY:50});
  ui.dialog.dispatchEvent(outside);
  assert.equal(ui.dialog.open,false);
  assert.equal(ui.doc.activeElement,ui.open);
  ui.open.click();
  ui.dialog.dispatchEvent(new Event('close'));
  assert.equal(ui.doc.activeElement,ui.copy);
});

test('a stalled native share leaves Copy usable across close and reopen', async () => {
  const nativePending = deferred(), copied = [];
  let shareCalls = 0;
  const ui = mount({share: () => { shareCalls++; return nativePending.promise; }, clipboard:{writeText: async text => copied.push(text)}});
  ui.open.click(); ui.native.click();
  assert.equal(ui.copy.disabled,false);
  ui.copy.click(); await settle();
  assert.deepEqual(copied,[invite.url]);
  assert.match(ui.status.textContent,/Link copied/);
  ui.close.click(); ui.open.click();
  assert.equal(ui.native.disabled,true);
  assert.match(ui.native.textContent,/Opening share options/);
  assert.equal(ui.copy.disabled,false);
  assert.equal(ui.doc.activeElement,ui.copy);
  ui.native.click(); ui.copy.click(); await settle();
  assert.equal(shareCalls,1);
  assert.deepEqual(copied,[invite.url,invite.url]);
  const status = ui.status.textContent;
  nativePending.reject(Object.assign(new Error('late cancel'),{name:'AbortError'})); await settle();
  assert.equal(ui.native.disabled,false);
  assert.equal(ui.native.textContent,'Share to an app');
  assert.equal(ui.status.textContent,status);
  assert.equal(ui.doc.activeElement,ui.copy);
});

test('late native success cannot overwrite newer copy feedback in the same dialog session', async () => {
  const pending = deferred();
  const ui = mount({share: () => pending.promise, clipboard:{writeText: async () => {}}});
  ui.open.click(); ui.native.click(); ui.copy.click(); await settle();
  const status = ui.status.textContent;
  assert.match(status,/Link copied/);
  pending.resolve(); await settle();
  assert.equal(ui.status.textContent,status);
  assert.equal(ui.native.disabled,false);
});

test('late copy failure cannot steal focus or feedback from a newer native share action', async () => {
  const copying = deferred(), sharing = deferred();
  const ui = mount({share: () => sharing.promise, clipboard:{writeText: () => copying.promise}});
  ui.open.click(); ui.copy.click(); ui.native.click();
  const status = ui.status.textContent;
  ui.close.focus();
  copying.reject(new Error('denied')); await settle();
  assert.equal(ui.copy.disabled,false);
  assert.equal(ui.native.disabled,true);
  assert.equal(ui.url.selectCount,0);
  assert.equal(ui.doc.activeElement,ui.close);
  assert.equal(ui.status.textContent,status);
  sharing.resolve(); await settle();
  assert.match(ui.status.textContent,/choose where to send/);
});
