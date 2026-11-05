const expectedHeaders = ['Handle', 'Division', 'Elapsed seconds', 'Completed at'];
export const divisions = ['Human-powered', 'Motorized'];
const sheetId = '1xPmAk6gjMmRQCYz4c2rI5vJfCpGC3lut24GzumdWsQA';
const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' });
const clockFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

export function parseCsv(input) {
  const text = String(input).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && quoted && text[i + 1] === '"') { field += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\r' || c === '\n') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('Incomplete CSV');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function readStandings(rows) {
  const [header = [], ...data] = rows;
  if (expectedHeaders.some((name, i) => String(header[i] || '').trim() !== name)) throw new Error('Standings columns unavailable');
  const runs = [];
  for (const row of data) {
    const [handle,division,duration,completed] = row.slice(0,4).map(value => String(value ?? '').trim());
    if (!handle || handle.length > 64 || !divisions.includes(division)) continue;
    if (!/^\d+(?:\.\d{1,3})?$/.test(duration)) continue;
    const seconds=Number(duration);
    if (seconds <= 0 || !Number.isSafeInteger(Math.round(seconds*1000))) continue;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(completed) || !Number.isFinite(Date.parse(completed))) continue;
    runs.push({handle,division,seconds,completed});
  }
  return runs;
}

export function ranked(runs, division) {
  const ordered = runs.filter(run => !division || run.division === division)
    .sort((a,b) => a.seconds-b.seconds || Date.parse(a.completed)-Date.parse(b.completed) || a.handle.localeCompare(b.handle,'en'));
  const seen=new Set();
  return ordered.filter(run => {
    const key=run.division+'\0'+run.handle.normalize('NFKC').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function overallFastest(runs) { return ranked(runs)[0] ?? null; }
export function pacificStamp(iso) {
  const date=new Date(iso);
  return {date:dateFormat.format(date), time:clockFormat.format(date)};
}
export function formatTime(seconds) {
  const millis=Math.round(seconds*1000);
  const fraction=String(millis%1000).padStart(3,'0');
  return Math.floor(millis/60000)+':'+String(Math.floor(millis/1000)%60).padStart(2,'0')+'.'+(millis%10 ? fraction : fraction.slice(0,2));
}

// Equivalent speed over the course's 1.05-mile crow-flies distance.
export function straightLineMph(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const mph = 1.05 * 3600 / seconds;
  return Number.isFinite(mph) ? mph : null;
}
export function formatSpeed(seconds) {
  const mph = straightLineMph(seconds);
  return mph === null ? '—' : mph.toFixed(1) + ' mph';
}

export function readFormUrl(rows) {
  const raw=rows.find(row=>String(row[0]).trim()==='FormURL')?.[1];
  if (!raw) return null;
  try {
    const url=new URL(String(raw).trim());
    if (url.protocol!=='https:' || url.username || url.password || url.port) return null;
    if (url.hostname==='docs.google.com' && /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[\w-]+\/viewform\/?$/.test(url.pathname)) return url.origin+url.pathname;
    if (url.hostname==='forms.gle' && /^\/[A-Za-z0-9]+\/?$/.test(url.pathname)) return url.origin+url.pathname;
  } catch {}
  return null;
}

export function formEmbedUrl(url) {
  const safe=readFormUrl([['FormURL',url]]);
  return safe && new URL(safe).hostname==='docs.google.com' ? safe+'?embedded=true' : null;
}

export async function loadSheet(tab) {
  const columns = tab==='Standings'?'A,B,C,D':tab==='Config'?'A,B':null;
  if (!columns) throw new Error('Unknown public tab');
  const query=new URLSearchParams({sheet:tab,headers:'1',tqx:'out:csv',tq:'select '+columns});
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch('https://docs.google.com/spreadsheets/d/'+sheetId+'/gviz/tq?'+query,{
      credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer',signal:controller.signal});
    if (!response.ok || /text\/html/i.test(response.headers.get('content-type')||'')) throw new Error('Public sheet unavailable');
    const body=await response.text();
    if (/^\s*</.test(body)) throw new Error('Unexpected sheet response');
    return parseCsv(body);
  } finally { clearTimeout(timeout); }
}
