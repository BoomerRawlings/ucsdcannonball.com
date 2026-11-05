import {divisions, ranked, overallFastest, readStandings, loadSheet, formatTime, formatSpeed, pacificStamp, readFormUrl, formEmbedUrl} from './standings.mjs';

const $=id=>document.getElementById(id);
const tabs=[...document.querySelectorAll('[data-division]')];
const views=['leaderboard','submit','about'];
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
const wipe=$('wipe');
let active='', accepted=false, selected=divisions[0], picked=false;
let rows=[], lastSuccess=false, feed='idle', readingForm=false, formReady=false;
let pending=null, animating=false;
function say(id, value) { const e=$(id); if(e)e.textContent=value; }
function hidden(el, value) { if(el)el.hidden=value; }
function route(){const hash=location.hash.slice(1);return views.includes(hash)?hash:'leaderboard';}

async function slide(change,reverse=false) {
  pending={change,reverse};
  if (animating) return;
  animating=true;
  try {
    while(pending) {
      const direction=pending.reverse?-1:1;
      if (!wipe || reduced.matches || !wipe.animate) { const n=pending;pending=null;n.change();continue; }
      let cover,exit;
      try {
        cover=wipe.animate([{transform:'translateX('+(-104*direction)+'%)'},{transform:'translateX(0)'}],
          {duration:190,easing:'cubic-bezier(.65,0,.2,1)',fill:'forwards'});
        await cover.finished;
        const n=pending;pending=null;n.change();
        exit=wipe.animate([{transform:'translateX(0)'},{transform:'translateX('+(104*direction)+'%)'}],
          {duration:240,easing:'cubic-bezier(.4,0,.12,1)',fill:'forwards'});
        await exit.finished;
      } catch { if(pending){const n=pending;pending=null;n.change();} }
      finally {cover?.cancel();exit?.cancel();}
    }
  } finally {animating=false;}
}
function setView(name,focus=true) {
  for (const v of views) hidden($(v),v!==name);
  for (const a of document.querySelectorAll('nav a[href^="#"]')) {
    if(a.hash==='#'+name)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  }
  active=name;
  if(name==='submit'&&!formReady)void getForm();
  if(name==='leaderboard'&&feed==='idle')void getRuns();
  if(focus) {
    const heading=$(name)?.querySelector('h1,h2');
    if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
    window.scrollTo({top:0,behavior:'instant'});
  }
}
function visit(name,push) {
  if(!accepted||!views.includes(name))return;
  if(push&&route()!==name)history.pushState(null,'','#'+name);
  if(name!==active||animating)void slide(()=>setView(name),views.indexOf(name)<views.indexOf(active));
}
document.addEventListener('click',event=>{
  if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const a=event.target.closest('a[href^="#"]');if(!a||!views.includes(a.hash.slice(1))||!accepted)return;
  event.preventDefault();visit(a.hash.slice(1),true);
});
window.addEventListener('popstate',()=>visit(route(),false));
window.addEventListener('hashchange',()=>visit(route(),false));

$('enter').addEventListener('click',()=>{
  if(accepted)return;
  accepted=true;
  void slide(()=>{
    hidden($('gate'),true);hidden($('app'),false);
    setView(route());
    if(feed==='idle')void getRuns();
  });
});

function selectDivision(value) {
  if(!divisions.includes(value))return;
  picked=true;
  if(value===selected&&!animating){renderBoard();return;}
  const reverse=divisions.indexOf(value)<divisions.indexOf(selected);
  void slide(()=>{selected=value;renderBoard();},reverse);
}
for(const [index,tab] of tabs.entries()){
  tab.addEventListener('click',()=>selectDivision(tab.dataset.division));
  tab.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;
    tabs[next].focus();selectDivision(tabs[next].dataset.division);
  });
}

function verificationBadge(element, value) {
  element.replaceChildren();
  hidden(element,!value);
  element.className='verification'+(value==='Verified'?' is-verified':'');
  if(!value)return;
  if(value==='Verified'){
    const check=document.createElement('span');check.textContent='✓';check.setAttribute('aria-hidden','true');element.append(check);
  }
  const label=document.createElement('span');label.textContent=value;element.append(label);
}
function renderBoard(){
  const board=ranked(rows,selected);
  const leader=board[0];
  for(const tab of tabs){
    const on=tab.dataset.division===selected;
    tab.setAttribute('aria-pressed',String(on));tab.classList.toggle('is-active',on);
  }
  say('record-label',selected+' course record');
  say('record-time',leader?formatTime(leader.seconds):'—:—.——');
  say('record-handle',leader?leader.handle:feed==='error'?'Live times unavailable':feed==='loading'?'Checking the board…':'First record unclaimed');
  verificationBadge($('record-verification'),leader?.verification || '');
  const stamp=leader?pacificStamp(leader.completed):{date:'',time:''};
  if($('record-date')&&$('record-clock')){say('record-date',stamp.date);say('record-clock',stamp.time);}
  else say('record-completed',leader?stamp.date+' · '+stamp.time:'');
  hidden($('record-completed'),!leader);
  say('record-speed',leader?'Straight-line avg. '+formatSpeed(leader.seconds):'');
  hidden($('record-speed'),!leader);
  const body=$('standings-body');body.replaceChildren();
  let rank=0;
  for(const [i,run] of board.entries()){
    if(!i||run.seconds!==board[i-1].seconds)rank=i+1;
    const tr=document.createElement('tr'), stamp=pacificStamp(run.completed);
    for(const [j,content] of [String(rank).padStart(2,'0'),run.handle,formatTime(run.seconds),stamp.date+' · '+stamp.time].entries()){
      const cell=document.createElement(j===1?'th':'td');
      if(j===1)cell.scope='row';
      if(j===1){
        const handle=document.createElement('span');handle.textContent=content;cell.append(handle);
        if(run.verification){const badge=document.createElement('span');verificationBadge(badge,run.verification);cell.append(badge);}
      }else if(j===2){
        const elapsed=document.createElement('span'), speed=document.createElement('span');
        elapsed.textContent=content;speed.textContent=formatSpeed(run.seconds);speed.className='run-speed';
        cell.append(elapsed);cell.append(speed);
      }else cell.textContent=content;
      tr.append(cell);
    }
    body.append(tr);
  }
  const status=feed==='error'?(lastSuccess?'Showing the last loaded results. The live sheet is unavailable.':'The live results sheet is unavailable. Check back or retry.')
    :feed==='loading'?'Loading runs…':board.length?'':'No '+selected.toLowerCase()+' finishes yet.';
  say('standings-state',status);hidden($('standings-state'),!status);hidden($('retry'),feed!=='error');
  hidden($('public-sheet'),!lastSuccess);
  $('refresh-standings').disabled=feed==='loading';
  say('refresh-standings',feed==='loading'?'Refreshing…':'Refresh standings');
}
async function getRuns(preserveDivision=false){
  if(feed==='loading')return;
  feed='loading';renderBoard();
  try{
    const next=readStandings(await loadSheet('Standings'));
    rows=next;lastSuccess=true;
    const overall=overallFastest(next);if(overall&&!picked&&!preserveDivision)selected=overall.division;
    feed='ready';
  }catch{feed='error';}
  renderBoard();
}
$('retry')?.addEventListener('click',()=>getRuns(lastSuccess));
$('refresh-standings').addEventListener('click',()=>getRuns(true));
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&accepted&&lastSuccess)void getRuns(true);
});

async function getForm(){
  if(readingForm||formReady)return;
  readingForm=true;
  hidden($('embedded-entry'),true);
  const link=$('form-link');hidden(link,true);link.removeAttribute('href');link.setAttribute('aria-disabled','true');
  say('form-state','Checking entry availability…');
  try{
    const url=readFormUrl(await loadSheet('Config'));
    if(!url){say('form-state','Submissions have not opened yet.');return;}
    const embedUrl=formEmbedUrl(url), frame=$('form-embed');
    if(embedUrl&&frame){frame.src=embedUrl;hidden($('embedded-entry'),false);}
    link.href=url;link.removeAttribute('aria-disabled');hidden(link,false);formReady=true;say('form-state','No sign-in required.');
  }catch{say('form-state','The submission form is currently unavailable. Please check back.');}
  finally{readingForm=false;hidden($('form-retry'),formReady);}
}
$('form-retry')?.addEventListener('click',getForm);
