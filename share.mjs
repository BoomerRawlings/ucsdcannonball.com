export const invite = Object.freeze({
  title: 'UCSD Cannonball',
  text: 'Think you can beat the clock? Try the UCSD Cannonball campus time trial.',
  url: 'https://ucsdcannonball.com/',
});

export const inviteLinks = Object.freeze({
  whatsapp: 'https://wa.me/?text=' + encodeURIComponent(invite.text + ' ' + invite.url),
  x: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(invite.text) + '&url=' + encodeURIComponent(invite.url),
  email: 'mailto:?subject=' + encodeURIComponent(invite.title) + '&body=' + encodeURIComponent(invite.text + '\n' + invite.url),
});

export function initInvite(doc, nav) {
  const get = id => doc.getElementById(id);
  const trigger = get('invite-open'), dialog = get('invite-dialog');
  if (!trigger || !dialog || typeof dialog.showModal !== 'function') return;
  const native = get('invite-native'), copy = get('invite-copy');
  const link = get('invite-url'), status = get('invite-status');
  let session = 0, action = 0, nativePending = null, copyPending = null;
  link.value = invite.url;
  for (const [name, href] of Object.entries(inviteLinks)) get('invite-' + name).href = href;
  let canShare = typeof nav.share === 'function';
  if (canShare && typeof nav.canShare === 'function') {
    try { canShare = nav.canShare(invite); } catch { canShare = false; }
  }
  native.hidden = !canShare;
  trigger.hidden = false;
  const busy = () => {
    native.disabled = Boolean(nativePending);
    copy.disabled = Boolean(copyPending);
    native.textContent = nativePending ? 'Opening share options…' : 'Share to an app';
    copy.textContent = copyPending ? 'Copying link…' : 'Copy link';
  };
  const current = operation => dialog.open && session === operation.session && action === operation.action;
  const finish = (operation, message, selectLink = false) => {
    if ((operation.kind === 'native' ? nativePending : copyPending) !== operation) return;
    if (operation.kind === 'native') nativePending = null;
    else copyPending = null;
    busy();
    if (!current(operation)) return;
    status.textContent = message;
    if (selectLink) { link.focus(); link.select(); }
  };

  trigger.addEventListener('click', () => {
    if (dialog.open) return;
    session++;
    status.textContent = '';
    busy();
    dialog.showModal();
    (canShare && !nativePending ? native : !copyPending ? copy : get('invite-close')).focus();
  });
  get('invite-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    session++;
    trigger.focus({preventScroll: true});
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });

  native.addEventListener('click', async () => {
    if (nativePending || !dialog.open || !canShare) return;
    const operation = nativePending = {session, action: ++action, kind: 'native'};
    busy();
    status.textContent = 'Opening share options…';
    try {
      await nav.share(invite);
      finish(operation, 'Share options opened. You choose where to send it.');
    } catch (error) {
      finish(operation, error?.name === 'AbortError'
        ? 'Sharing canceled. You can try another option.'
        : 'Sharing is unavailable here. Copy the link or choose an app below.');
    }
  });
  copy.addEventListener('click', async () => {
    if (copyPending || !dialog.open) return;
    const operation = copyPending = {session, action: ++action, kind: 'copy'};
    busy();
    status.textContent = 'Copying link…';
    try {
      if (typeof nav.clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable');
      await nav.clipboard.writeText(invite.url);
      finish(operation, 'Link copied. Paste it into a text or any app.');
    } catch {
      finish(operation, 'Copy is unavailable here. The link is selected; copy it and paste it into your message.', true);
    }
  });
}

if (typeof document !== 'undefined') initInvite(document, navigator);
