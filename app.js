/* First Foods Tracker — vanilla JS, no dependencies.
 * Data: foods.json (read-only catalog) + log.json on the `data` branch (shared event log).
 * Every change is an event; phones merge by event id, so concurrent saves never lose entries. */
'use strict';

const CFG = { owner: 'ngreensphan1', repo: 'first-foods', branch: 'data', path: 'log.json' };
const API = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}`;
const VERSION = '1.0.0';

/* ---------- storage ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
let device = Object.assign({ name: '', token: '', nudgeDays: 14, onboarded: false, homeTipDismissed: false }, LS.get('ff:device', {}));
let remote = LS.get('ff:remote', { events: [], sha: null });   // last copy seen on GitHub
let queue = LS.get('ff:queue', []);                             // events not yet on GitHub
const saveDevice = () => LS.set('ff:device', device);
const saveLog = () => { LS.set('ff:remote', remote); LS.set('ff:queue', queue); };

/* ---------- small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ymd();
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(s, withYear) {
  if (!s) return '';
  const d = parseYmd(s);
  const y = withYear || d.getFullYear() !== new Date().getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${y ? ', ' + d.getFullYear() : ''}`;
}
function fmtStamp(iso) {
  const d = new Date(iso);
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${fmtDate(ymd(d))}, ${h}:${pad2(d.getMinutes())} ${ap}`;
}
function ago(dateStr) {
  const n = daysBetween(dateStr, today());
  return n <= 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`;
}
function b64enc(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
function b64dec(b64) { const bin = atob(String(b64).replace(/\s/g, '')); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

/* ---------- icons (inline SVG, from the design spec) ---------- */
const I = {
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  caution: (s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 23 21.5H1z" fill="#F0B33C" stroke="#1B1A17" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v5.5" stroke="#1B1A17" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="18" r="1.4" fill="#1B1A17"/></svg>`,
  stop: (s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" fill="#B42318"/><rect x="6.5" y="10.5" width="11" height="3" rx="1" fill="#FFFFFF"/></svg>`,
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  ext: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  cal: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  chevDown: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  chevUp: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  introduced: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="var(--accent-soft)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  notyet: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/></svg>',
  reaction: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#FFFFFF"/><path d="M12 6.5v7" stroke="#B42318" stroke-width="2.8" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.6" fill="#B42318"/></svg>',
  miniOn: '<svg width="20" height="20" viewBox="0 0 24 24" role="img" aria-label="tried"><rect x="2" y="2" width="20" height="20" rx="6" fill="var(--accent)"/><path d="m7 12.5 3.2 3.2L17 8.8" fill="none" stroke="var(--on-accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  miniOff: '<svg width="20" height="20" viewBox="0 0 24 24" role="img" aria-label="not tried"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="var(--control)" stroke-width="2"/></svg>',
  tabFoods: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6.5 5 8l2.5-3M3.5 12.5 5 14l2.5-3M3.5 18.5 5 20l2.5-3M11 6.5h9.5M11 12.5h9.5M11 18.5h9.5"/></svg>',
  tabMeal: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5h18a9 9 0 0 1-18 0Z"/><path d="M12 3.5v5M8.5 5v3.5M15.5 5v3.5"/></svg>',
  tabAllergens: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="5.5" r="2"/><circle cx="12" cy="5.5" r="2"/><circle cx="18.5" cy="5.5" r="2"/><circle cx="5.5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18.5" cy="12" r="2"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="12" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/></svg>',
  tabSettings: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
};
const FACE = {
  rejected: '<path d="M8 17c1.5-2.5 6.5-2.5 8 0"/>',
  disliked: '<path d="M8.5 16.2c1.6-1.2 5.4-1.2 7 0"/>',
  neutral: '<path d="M8.5 15.5h7"/>',
  liked: '<path d="M8.5 14.5c1.6 1.4 5.4 1.4 7 0"/>',
  loved: '<path d="M7.8 13.5c1.4 3 7 3 8.4 0z" fill="currentColor"/>',
};
const LIKES = [['rejected', 'Rejected'], ['disliked', 'Disliked'], ['neutral', 'Neutral'], ['liked', 'Liked'], ['loved', 'Loved']];
const LIKE_LABEL = Object.fromEntries(LIKES);
const face = (k, s = 18, w = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/>${FACE[k]}</svg>`;

/* ---------- catalog ---------- */
let CAT = null; const FOOD = new Map(); let ALLERGEN = {};
async function loadCatalog() {
  const res = await fetch('foods.json');
  CAT = await res.json();
  CAT.foods.sort((a, b) => a.name.localeCompare(b.name));
  CAT.foods.forEach((f) => FOOD.set(f.id, f));
  ALLERGEN = Object.fromEntries(CAT.allergens.map((a) => [a.id, a]));
}
const notesFor = (f) => (f.safety || []).map((k) => ({ key: k, ...CAT.safetyNotes[k] }));
const hasWait12 = (f) => notesFor(f).some((n) => n.tier === 'wait12');
const hasCaution = (f) => notesFor(f).some((n) => n.tier === 'caution');
function firstBirthday() {
  const b = S.child.birthdate; if (!b) return null;
  const d = parseYmd(b); return ymd(new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()));
}
function isLocked(f) {
  if (!hasWait12(f)) return false;
  const fb = firstBirthday();
  return !fb || today() < fb;
}
const unlockText = () => (firstBirthday() ? `Unlocks ${fmtDate(firstBirthday(), true)}` : 'Set her birthdate in Settings');
const allergenLabel = (id) => (id === 'other' ? 'Other' : ALLERGEN[id]?.label.replace('Crustacean shellfish', 'Shellfish'));
const ssUrl = (f) => `https://solidstarts.com/foods/${f.id}/`;
const ssSearch = (f) => `https://www.google.com/search?q=${encodeURIComponent('site:solidstarts.com/foods ' + f.name.replace(/\(.*?\)/g, ''))}`;

/* ---------- event log → state ---------- */
let S = { foods: {}, child: { name: '', birthdate: '' } };
function allEvents() {
  const m = new Map();
  for (const e of remote.events) m.set(e.id, e);
  for (const e of queue) m.set(e.id, e);
  return [...m.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}
function derive() {
  const evs = allEvents();
  const undone = new Set(evs.filter((e) => e.type === 'undo').map((e) => e.ref));
  const foods = {}; const child = { name: '', birthdate: '' };
  const get = (id) => foods[id] || (foods[id] = { offers: [], tried: false, catchup: false, firstOverride: null, liking: null, likingHist: [], reaction: 'none', note: '', events: [] });
  for (const e of evs) {
    if (e.type === 'undo' || undone.has(e.id)) continue;
    if (e.type === 'child') { Object.assign(child, e.value); continue; }
    if (!e.food) continue;
    const s = get(e.food); s.events.push(e);
    if (e.type === 'offered') { s.offers.push(e); s.tried = true; }
    else if (e.type === 'tried') { s.tried = true; s.catchup = true; }
    else if (e.type === 'firstTried') { s.firstOverride = e.value; s.tried = true; }
    else if (e.type === 'liking') { s.liking = e.value; s.likingHist.push(e); }
    else if (e.type === 'reaction') s.reaction = e.value;
    else if (e.type === 'note') s.note = e.value;
  }
  for (const s of Object.values(foods)) {
    const dates = s.offers.map((o) => o.date).sort();
    s.first = s.firstOverride || dates[0] || null;
    s.last = dates[dates.length - 1] || null;
    s.lastOffer = s.offers.reduce((a, o) => (!a || o.date > a.date || (o.date === a.date && o.at > a.at) ? o : a), null);
  }
  S = { foods, child };
}
const fs = (id) => S.foods[id] || { offers: [], tried: false, liking: null, likingHist: [], reaction: 'none', note: '', events: [], first: null, last: null };

function addEvents(list) {
  const by = device.name || 'Phone';
  const made = list.map((e) => ({ id: uid(), at: new Date().toISOString(), by, ...e }));
  queue.push(...made); saveLog(); derive(); scheduleSync();
  return made;
}
const undoEvents = (made) => addEvents(made.map((e) => ({ type: 'undo', ref: e.id })));
function offerEvent(foodId, date = today()) { return { type: 'offered', food: foodId, date }; }

/* ---------- GitHub sync ---------- */
const sync = { status: 'idle', at: null, error: null, running: false, again: false, timer: null };
function ghHeaders(json) {
  const h = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${device.token.trim()}`, 'X-GitHub-Api-Version': '2022-11-28' };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
async function ghError(res) {
  let msg = `GitHub error ${res.status}`;
  try { const j = await res.json(); if (j.message) msg += `: ${j.message}`; } catch { /* no body */ }
  if (res.status === 401) msg = 'The token was rejected (401). Check it in Settings.';
  if (res.status === 403) msg = 'The token can’t write to the repo (403). It needs Contents: Read and write.';
  const e = new Error(msg); e.status = res.status; return e;
}
async function pull() {
  const res = await fetch(`${API}/contents/${CFG.path}?ref=${CFG.branch}&t=${Date.now()}`, { headers: ghHeaders(), cache: 'no-store' });
  if (res.status === 404) {
    // 404 means either "no log yet" or "token can't see the repo/branch" — check which.
    const r2 = await fetch(`${API}/branches/${CFG.branch}?t=${Date.now()}`, { headers: ghHeaders(), cache: 'no-store' });
    if (r2.ok) return { events: [], sha: null };
    throw new Error(r2.status === 404 ? 'Can’t find the repo or its “data” branch with this token.' : (await ghError(r2)).message);
  }
  if (!res.ok) throw await ghError(res);
  const j = await res.json();
  let data = {};
  try { data = JSON.parse(b64dec(j.content) || '{}'); } catch { throw new Error('log.json on GitHub isn’t valid JSON.'); }
  return { events: Array.isArray(data.events) ? data.events : [], sha: j.sha };
}
function serialize(events) {
  // One event per line keeps the file readable and the GitHub history easy to diff.
  return `{\n "version": 1,\n "updated": "${new Date().toISOString()}",\n "events": [\n  ${events.map((e) => JSON.stringify(e)).join(',\n  ')}\n ]\n}\n`;
}
function setSync(status, error = null) {
  sync.status = status; sync.error = error;
  if (status === 'synced') sync.at = Date.now();
  document.querySelectorAll('[data-syncdot]').forEach((el) => { el.outerHTML = syncDot(); });
  const lbl = $('#sync-label'); if (lbl) lbl.textContent = syncLabel();
  const er = $('#sync-err'); if (er) er.textContent = sync.error || '';
  if (ui.overlay === 'sync') renderOverlay();
}
async function runSync() {
  if (!device.token) { setSync('nosetup'); return; }
  if (sync.running) { sync.again = true; return; }
  sync.running = true; setSync('syncing');
  try {
    let done = false;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      const rem = await pull();
      const have = new Set(rem.events.map((e) => e.id));
      const toSend = queue.filter((e) => !have.has(e.id));
      if (!toSend.length) {
        remote = { events: rem.events, sha: rem.sha };
        const sentIds = have; queue = queue.filter((e) => !sentIds.has(e.id));
        saveLog(); done = true; break;
      }
      const events = rem.events.concat(toSend);
      const body = { message: `log: ${toSend.length} entr${toSend.length === 1 ? 'y' : 'ies'} from ${device.name || 'a phone'}`, content: b64enc(serialize(events)), branch: CFG.branch };
      if (rem.sha) body.sha = rem.sha;
      const res = await fetch(`${API}/contents/${CFG.path}`, { method: 'PUT', headers: ghHeaders(true), body: JSON.stringify(body), cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        remote = { events, sha: j.content.sha };
        const sent = new Set(toSend.map((e) => e.id));
        queue = queue.filter((e) => !sent.has(e.id));
        saveLog();
        if (!queue.length) done = true;
        continue;
      }
      if (res.status === 409 || res.status === 422) { await sleep(300 + attempt * 500 + Math.random() * 300); continue; } // other phone saved first: re-read, merge, retry
      throw await ghError(res);
    }
    if (!done) throw new Error('Couldn’t save after several tries. Will retry shortly.');
    setSync('synced');
  } catch (err) {
    const offline = navigator.onLine === false || err instanceof TypeError;
    setSync(offline ? 'offline' : 'error', offline ? null : err.message);
  } finally {
    sync.running = false; derive(); refresh();
    if (sync.again) { sync.again = false; runSync(); }
  }
}
function scheduleSync(ms = 1200) { clearTimeout(sync.timer); sync.timer = setTimeout(runSync, ms); }
setInterval(() => { if (document.visibilityState === 'visible') runSync(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') runSync(); });
window.addEventListener('online', () => runSync());

function syncLabel() {
  const n = queue.length;
  switch (sync.status) {
    case 'syncing': return 'Syncing…';
    case 'offline': return `Offline${n ? ` · ${n} unsent` : ''}`;
    case 'error': return `Sync error${n ? ` · ${n} unsent` : ''}`;
    case 'nosetup': return `Not connected to GitHub${n ? ` · ${n} saved on this phone` : ''}`;
    case 'synced': { const m = Math.round((Date.now() - sync.at) / 60000); return m < 1 ? 'Synced just now' : `Synced ${m} min ago`; }
    default: return n ? `${n} unsent` : 'Not synced yet';
  }
}
function syncDot() {
  const n = queue.length; const st = sync.status === 'synced' && n ? 'syncing' : sync.status;
  return `<button class="dotbtn${n && st !== 'synced' ? ' wide' : ''}" data-syncdot data-act="sync-sheet" aria-label="Sync status: ${esc(syncLabel())}"><span class="dot ${st}"></span>${n && (st === 'offline' || st === 'error' || st === 'nosetup') ? `<span class="n">${n}</span>` : ''}</button>`;
}

/* ---------- UI state ---------- */
const ui = { tab: 'foods', q: '', filter: 'all', strip: null, expanded: new Set(), overlay: null, food: null, histAll: false,
  meal: { date: today(), sel: [], q: '' }, catchSel: new Set(), catchQ: '', first: 0, pendingMeal: null, testMsg: '' };
const app = () => $('#app');

/* ---------- toast ---------- */
let toastTimer = null; let toastUndo = null;
function toast(text, made) {
  toastUndo = made || null;
  $('#toast').innerHTML = `<div class="toast" role="status"><span>${esc(text)}</span>${made ? '<button data-act="toast-undo">Undo</button>' : ''}</div>`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').innerHTML = ''; toastUndo = null; }, 5000);
}

/* ---------- shared pieces ---------- */
function markers(f, s) {
  const out = [];
  if (isLocked(f)) out.push(`<span class="mk stop">${I.stop()}Not until 12 mo</span><span>${esc(unlockText())}</span>`);
  if (hasCaution(f)) out.push(`<span class="mk">${I.caution()}Caution</span>`);
  (f.allergens || []).forEach((a) => out.push(`<span class="tag">Allergen · ${esc(allergenLabel(a))}</span>`));
  return out.join(' ');
}
function triedText(s) {
  if (!s.tried) return '';
  if (s.first === today()) return '<span class="today">Tried today</span>';
  return s.first ? `Tried ${fmtDate(s.first)}` : 'Tried';
}
function foodRow(f) {
  const s = fs(f.id); const locked = isLocked(f) && !s.tried; const open = ui.strip === f.id;
  const box = s.tried ? `<span class="box on">${I.check}</span>` : locked ? '<span class="box dash"></span>' : '<span class="box"></span>';
  const label = s.tried ? `${f.name}: tried. Tap to undo` : locked ? `${f.name}: not until 12 months` : `${f.name}: not tried. Mark tried`;
  const meta = [triedText(s), markers(f, s)].filter(Boolean).join(' ');
  const like = s.tried ? `<button class="lbtn" data-act="strip" data-id="${f.id}" aria-label="Liking: ${s.liking ? LIKE_LABEL[s.liking] : 'not set'}. Change"><span class="lchip${s.liking ? '' : ' empty'}">${s.liking ? face(s.liking) + LIKE_LABEL[s.liking] : 'Rate'}</span></button>` : '';
  const strip = open ? `<div class="strip-wrap"><p class="strip-q">How did she like it?</p><div class="strip" role="radiogroup" aria-label="Liking for ${esc(f.name)}">${LIKES.map(([k, l]) => `<button role="radio" aria-checked="${s.liking === k}" data-act="like" data-id="${f.id}" data-v="${k}">${face(k, 20)}${l}</button>`).join('')}</div></div>` : '';
  return `<li class="row${locked ? ' locked' : ''}${open ? ' strip-open' : ''}"><div class="row-main">
    <button class="cb" data-act="toggle" data-id="${f.id}" aria-pressed="${s.tried}" aria-label="${esc(label)}">${box}</button>
    <button class="rtext" data-act="open" data-id="${f.id}"><span class="rname">${esc(f.name)}</span>${meta ? `<span class="meta">${meta}</span>` : ''}</button>
    ${like}</div>${strip}</li>`;
}
function tabbar() {
  const t = (id, icon, label) => `<button data-act="tab" data-tab="${id}"${ui.tab === id ? ' aria-current="page"' : ''}>${icon}${label}</button>`;
  return `<nav class="tabbar" aria-label="Main">${t('foods', I.tabFoods, 'Foods')}${t('meal', I.tabMeal, 'Log meal')}${t('allergens', I.tabAllergens, 'Allergens')}${t('settings', I.tabSettings, 'Settings')}</nav>`;
}

/* ---------- Foods tab ---------- */
function matches(f, q) {
  if (!q) return true; q = q.toLowerCase();
  return f.name.toLowerCase().includes(q) || (f.aliases || []).some((a) => a.toLowerCase().includes(q));
}
function filtered() {
  return CAT.foods.filter((f) => {
    if (!matches(f, ui.q)) return false;
    const s = fs(f.id);
    switch (ui.filter) {
      case 'nottried': return !s.tried;
      case 'allergens': return (f.allergens || []).length > 0;
      case 'caution': return hasCaution(f) || hasWait12(f);
      case 'tryagain': return s.liking === 'rejected' || s.liking === 'disliked';
      case 'reactions': return s.reaction === 'mild' || s.reaction === 'severe';
      default: return true;
    }
  });
}
function foodsSummary() {
  const tried = CAT.foods.filter((f) => fs(f.id).tried).length;
  const weekAgo = ymd(new Date(Date.now() - 6 * 864e5));
  const newWeek = CAT.foods.filter((f) => { const s = fs(f.id); return s.first && s.first >= weekAgo; }).length;
  return `<strong>${tried}</strong> of ${CAT.foods.length} tried${newWeek ? ` · ${newWeek} new this week` : ''}`;
}
function foodsList() {
  const list = filtered();
  if (!list.length) {
    if (ui.q) return `<div class="empty-state"><h2>No match for “${esc(ui.q)}”</h2><p>Try another name, like “yogurt” instead of “yoghurt”. Not in the list? Use the closest food and add a note.</p><button class="btn secondary" data-act="clear-search">Clear search</button></div>`;
    if (ui.filter === 'tryagain') return '<div class="empty-state"><h2>Nothing to try again</h2><p>Foods rated Rejected or Disliked show up here so you remember to offer them again. It can take many tries before a baby accepts a food.</p></div>';
    if (ui.filter === 'reactions') return '<div class="empty-state"><h2>No reactions logged</h2></div>';
    return '<div class="empty-state"><h2>Nothing here yet</h2></div>';
  }
  if (ui.filter === 'all' && !ui.q && !CAT.foods.some((f) => fs(f.id).tried)) {
    // first time with nothing tried: point to catch-up
    return `<div class="banner"><span><b>Nothing tried yet.</b> If she’s already eaten some foods, mark them all at once.</span><button data-act="catchup">Catch up</button></div>` + groupsHtml(list);
  }
  return groupsHtml(list);
}
function groupsHtml(list) {
  return CAT.categories.map((c) => {
    const items = list.filter((f) => f.category === c.id); if (!items.length) return '';
    const all = CAT.foods.filter((f) => f.category === c.id);
    const tried = all.filter((f) => fs(f.id).tried).length;
    return `<h2 class="sec">${esc(c.label)} <span>${tried} of ${all.length}</span></h2><ul class="group">${items.map(foodRow).join('')}</ul>`;
  }).join('');
}
function renderFoods() {
  const chip = (id, label) => `<button class="chip" data-act="filter" data-f="${id}" aria-pressed="${ui.filter === id}">${label}</button>`;
  const homeTip = !isStandalone() && !device.homeTipDismissed && /iPhone|iPad/.test(navigator.userAgent)
    ? '<div class="banner"><span><b>Add to Home Screen</b> so it opens like an app and keeps its data. Tap Share, then “Add to Home Screen”.</span><button data-act="dismiss-home">OK</button></div>' : '';
  app().innerHTML = `<div class="screen">
    <header class="top rule"><div class="top-row"><h1>Foods</h1>${syncDot()}</div>
      <p class="sub" id="summary">${foodsSummary()}</p>
      <label class="search">${I.search}<input type="search" id="q" aria-label="Search foods" placeholder="Search ${CAT.foods.length} foods" value="${esc(ui.q)}" autocomplete="off" autocorrect="off"></label>
      <div class="chips">${chip('all', 'All')}${chip('nottried', 'Not tried yet')}${chip('allergens', 'Allergens')}${chip('caution', 'Caution')}${chip('tryagain', 'Try again')}${chip('reactions', 'Reactions')}</div>
    </header>${homeTip}<main id="list">${foodsList()}</main></div>${tabbar()}`;
  $('#q').addEventListener('input', (e) => { ui.q = e.target.value; ui.strip = null; $('#list').innerHTML = foodsList(); });
}

/* ---------- Food detail sheet ---------- */
function historyLine(e, s) {
  const first = s.offers[0] && s.offers[0].id === e.id;
  switch (e.type) {
    case 'offered': return (first ? 'First tried' : 'Offered') + (e.date !== ymd(new Date(e.at)) ? ` (for ${fmtDate(e.date)})` : '');
    case 'tried': return 'Marked tried (catch-up)';
    case 'firstTried': return `First-tried date → ${fmtDate(e.value, true)}`;
    case 'liking': return `Liking → ${LIKE_LABEL[e.value] || e.value}`;
    case 'reaction': return `Reaction → ${e.value[0].toUpperCase() + e.value.slice(1)}`;
    case 'note': return 'Note updated';
    default: return e.type;
  }
}
function panelHtml(n) {
  const src = CAT.sources[n.source];
  const stop = n.tier === 'wait12';
  return `<section class="panel ${stop ? 'stop' : 'caution'}" aria-label="Safety"><h3>${stop ? I.stop(22) : I.caution(22)}${stop ? 'Not until 12 months' : 'Caution'}</h3>
    <dl>${stop ? `<div><dt>Unlocks</dt><dd>${esc(firstBirthday() ? fmtDate(firstBirthday(), true) + ', her 1st birthday' : 'Set her birthdate in Settings')}</dd></div>` : ''}
    <div><dt>Why</dt><dd>${esc(n.reason)}</dd></div><div><dt>How to lower the risk</dt><dd>${esc(n.tip)}</dd></div></dl>
    ${src ? `<a class="link" href="${src.url}" target="_blank" rel="noopener">Source: ${esc(src.title)}${I.ext}</a>` : ''}
    ${stop ? '' : '<p class="fine">Safety lists may not include every food.</p>'}</section>`;
}
function renderDetail() {
  const f = FOOD.get(ui.food); if (!f) return '';
  const s = fs(f.id); const cat = CAT.categories.find((c) => c.id === f.category)?.label || '';
  const notes = notesFor(f);
  const badges = [];
  if (isLocked(f)) badges.push(`<span class="pill stop">${I.stop()}Not until 12 mo</span>`);
  if (hasCaution(f)) badges.push(`<span class="pill caution">${I.caution(18)}Caution</span>`);
  (f.allergens || []).forEach((a) => badges.push(`<span class="tag" style="height:32px;padding:0 10px;font-size:15px">Allergen · ${esc(allergenLabel(a))}</span>`));
  const hist = s.events.slice().reverse();
  const shown = ui.histAll ? hist : hist.slice(0, 5);
  const prevLike = s.likingHist.length > 1 ? s.likingHist[s.likingHist.length - 2] : null;
  const lo = s.lastOffer;
  return `<div class="scrim" data-act="close-bg"><section class="sheet" role="dialog" aria-label="${esc(f.name)}" aria-modal="true">
    <span class="grab" aria-hidden="true"></span>
    <div class="sheet-h"><div><h2>${esc(f.name)}</h2><span class="cat">${esc(cat)}</span></div><button class="x" data-act="close" aria-label="Close">${I.close}</button></div>
    ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
    <div class="box-group">
      <div class="box-row"><div style="display:flex;align-items:center;gap:10px">${s.tried ? `<span class="box on">${I.check}</span>` : '<span class="box"></span>'}
        <span style="display:flex;flex-direction:column"><span class="lbl">First tried</span><span class="val">${s.tried ? (s.first ? fmtDate(s.first, true) : 'Date not logged') : 'Not tried yet'}</span></span></div>
        ${s.tried ? `<label class="link" style="position:relative">Edit date<input type="date" data-act="first-date" data-id="${f.id}" value="${s.first || ''}" max="${today()}" style="position:absolute;inset:0;opacity:0" aria-label="Edit first-tried date"></label>`
          : `<button class="link" data-act="toggle" data-id="${f.id}">Mark tried today</button>`}</div>
      <div class="box-row" style="min-height:72px"><span style="display:flex;flex-direction:column"><span class="lbl">Times offered</span><span class="big">${s.offers.length}×</span>
        ${lo ? `<span class="lbl">Last ${fmtDate(lo.date)} · ${esc(lo.by)}</span>` : ''}</span>
        <button class="plus" data-act="plus1" data-id="${f.id}" aria-label="Add one offer today">${I.plus}1 today</button></div>
    </div>
    ${s.tried ? `<div class="blk"><h3>How does she like it?</h3><div class="likes" role="radiogroup" aria-label="Liking">${LIKES.map(([k, l]) => `<button role="radio" aria-checked="${s.liking === k}" data-act="like" data-id="${f.id}" data-v="${k}">${face(k, 26, 1.7)}${l}</button>`).join('')}</div>
      ${prevLike ? `<p class="note">Was ${LIKE_LABEL[prevLike.value]} on ${fmtDate(ymd(new Date(prevLike.at)))}. Earlier ratings stay in History.</p>` : ''}</div>
    <div class="blk"><h3>Reaction</h3><div class="seg" role="radiogroup" aria-label="Reaction">${[['none', 'None'], ['mild', 'Mild'], ['severe', 'Severe']].map(([k, l]) => `<button role="radio" class="${k !== 'none' ? 'sev' : ''}" aria-checked="${s.reaction === k}" data-act="reaction" data-id="${f.id}" data-v="${k}">${l}</button>`).join('')}</div>
      ${s.reaction !== 'none' ? '<p class="note"><b>Talk to your pediatrician.</b> Call 911 for trouble breathing, swelling of the face or tongue, or repeated vomiting.</p>' : ''}</div>` : ''}
    <label class="blk"><h3>Notes</h3><textarea rows="3" data-act="note" data-id="${f.id}" placeholder="How you served it, how much she ate…">${esc(s.note)}</textarea></label>
    ${notes.map(panelHtml).join('')}
    <div class="serve"><a class="btn secondary" href="${ssUrl(f)}" target="_blank" rel="noopener">How to serve${I.ext}</a>
      <span class="fine">External link · opens Solid Starts · <a href="${ssSearch(f)}" target="_blank" rel="noopener">page not found? Search</a></span></div>
    ${hist.length ? `<div class="blk"><h3>History</h3><ol class="hist">${shown.map((e) => `<li><span>${esc(historyLine(e, s))} · <span class="when">${fmtStamp(e.at)}</span></span><span class="by">${esc(e.by)}</span></li>`).join('')}</ol>
      ${hist.length > 5 && !ui.histAll ? `<button class="link" data-act="hist-all">Show all ${hist.length} entries</button>` : ''}</div>` : ''}
  </section></div>`;
}

/* ---------- Not-until-12-months warning ---------- */
function renderWarn() {
  const f = FOOD.get(ui.food); const n = notesFor(f).find((x) => x.tier === 'wait12'); const src = CAT.sources[n.source];
  return `<div class="warn" role="alertdialog" aria-labelledby="ny-title"><div class="warn-in">
    <div style="display:flex;flex-direction:column;gap:14px"><svg width="64" height="64" viewBox="0 0 24 24" role="img" aria-label="Stop"><path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" fill="#B42318"/><rect x="6" y="10.4" width="12" height="3.2" rx="1" fill="#FFFFFF"/></svg>
      <span class="kicker">Not until 12 months</span><h1 id="ny-title">${esc(f.name)}</h1></div>
    <div class="unlock">${I.cal}<span>${firstBirthday() ? `<strong>Unlocks ${fmtDate(firstBirthday(), true)}</strong>, her 1st birthday` : '<strong>Set her birthdate</strong> in Settings to see the unlock date'}</span></div>
    <div class="blk"><h3>Why</h3><p style="margin:0">${esc(n.reason)}</p><p style="margin:0;color:var(--ink-2)">${esc(n.tip)}</p>
      ${src ? `<a class="link" href="${src.url}" target="_blank" rel="noopener">Source: ${esc(src.title)}${I.ext}</a>` : ''}</div>
    <div class="actions"><p>If she already had it, you can still log it. Questions go to your pediatrician.</p>
      <button class="btn dark" data-act="warn-back">Go back</button><button class="btn override" data-act="warn-log">Log it anyway</button></div>
  </div></div>`;
}

/* ---------- Sync sheet ---------- */
function renderSyncSheet() {
  const n = queue.length;
  return `<div class="scrim" data-act="close-bg"><section class="sheet" role="dialog" aria-label="Sync status" aria-modal="true"><span class="grab"></span>
    <div class="sheet-h"><div><h2>Sync</h2><span class="cat">${esc(syncLabel())}</span></div><button class="x" data-act="close" aria-label="Close">${I.close}</button></div>
    ${sync.error ? `<p class="err">${esc(sync.error)}</p>` : ''}
    ${sync.status === 'nosetup' ? '<p style="margin:0">Add the GitHub token in Settings so both phones share one log. Until then, entries are saved on this phone.</p>' : ''}
    ${sync.status === 'offline' ? `<p style="margin:0">No connection. ${n} entr${n === 1 ? 'y is' : 'ies are'} saved on this phone and will sync automatically.</p>` : ''}
    <button class="btn primary" data-act="sync-now"${device.token ? '' : ' disabled'}>Sync now</button>
    ${!device.token ? '<button class="btn secondary" data-act="goto-settings">Open Settings</button>' : ''}
  </section></div>`;
}

/* ---------- Confirm sheet (no browser dialogs) ---------- */
function renderConfirm() {
  const c = ui.confirm;
  return `<div class="scrim" data-act="close-bg"><section class="sheet" role="alertdialog" aria-label="${esc(c.title)}" aria-modal="true"><span class="grab"></span>
    <div class="sheet-h"><h2 style="font-size:22px;line-height:28px">${esc(c.title)}</h2></div><p style="margin:0;color:var(--ink-2)">${esc(c.body)}</p>
    <button class="btn override" data-act="confirm-yes">${esc(c.yes)}</button><button class="btn secondary" data-act="close">Cancel</button></section></div>`;
}

/* ---------- Allergens tab ---------- */
function allergenInfo(a) {
  const members = CAT.foods.filter((f) => (f.allergens || []).includes(a.id));
  const triedM = members.filter((f) => fs(f.id).tried);
  const offers = members.flatMap((f) => fs(f.id).offers);
  const last = offers.map((o) => o.date).sort().pop() || null;
  const reaction = members.some((f) => ['mild', 'severe'].includes(fs(f.id).reaction));
  return { members, triedM, offers: offers.length, last, reaction, introduced: triedM.length > 0 };
}
function renderAllergens() {
  const list = CAT.allergens.filter((a) => a.id !== 'other');
  const infos = list.map((a) => [a, allergenInfo(a)]);
  const intro = infos.filter(([, i]) => i.introduced).length;
  const nd = Number(device.nudgeDays) || 14;
  const noun = { fish: 'fish', shellfish: 'shellfish', tree_nut: 'tree nuts' };
  const cards = infos.map(([a, i]) => {
    const badge = i.reaction ? `<span class="badge react">${I.reaction}Reaction noted</span>`
      : i.introduced ? `<span class="badge intro">${I.introduced}Introduced</span>` : `<span class="badge notyet">${I.notyet}Not yet</span>`;
    const line = i.offers ? `Offered ${i.offers}×${i.last && daysBetween(i.last, today()) <= nd ? ` · last ${ago(i.last)}` : ''}` : i.introduced ? 'Tried · no offers logged yet' : '';
    const nudge = !i.reaction && i.introduced && (!i.last || daysBetween(i.last, today()) > nd)
      ? `<p class="nudge">${I.clock}${i.last ? `Last offered ${ago(i.last)}` : 'No offer dates logged yet'}</p>` : '';
    const exp = ui.expanded.has(a.id);
    const word = noun[a.id] || `foods with ${a.label.toLowerCase()}`;
    return `<li class="card${i.reaction ? ' react' : ''}"><div class="card-h"><h2>${esc(a.label)}</h2>${badge}</div>
      ${line ? `<p>${line}</p>` : ''}${nudge}${i.reaction ? '<p><b style="color:var(--ink)">Talk to your pediatrician.</b> Reminders are off for this allergen.</p>' : ''}
      <button class="expand" data-act="expand" data-id="${a.id}" aria-expanded="${exp}">${i.triedM.length} of ${i.members.length} ${word} tried${exp ? I.chevUp : I.chevDown}</button>
      ${exp ? `<ul class="members">${i.members.map((f) => { const t = fs(f.id).tried; return `<li><button class="${t ? 'on' : ''}" data-act="open" data-id="${f.id}">${t ? I.miniOn : I.miniOff}${esc(f.name)}</button></li>`; }).join('')}</ul>` : ''}</li>`;
  }).join('');
  app().innerHTML = `<div class="screen"><header class="top"><div class="top-row"><h1>Allergens</h1>${syncDot()}</div>
    <p class="sub" style="margin:0"><strong>${intro}</strong> of ${list.length} introduced · reminder after ${nd} days</p></header>
    <ul class="cards">${cards}</ul>
    <p class="disclaimer"><b>For tracking only.</b> Ask your pediatrician before introducing allergens, especially if your baby has severe eczema or a known food allergy. <b>Call 911</b> for trouble breathing, swelling of the face or tongue, or repeated vomiting.</p>
  </div>${tabbar()}`;
}

/* ---------- Log meal tab ---------- */
function renderMeal() {
  const m = ui.meal;
  document.body.classList.toggle('has-savebar', m.sel.length > 0);
  const recentIds = [...new Set(allEvents().filter((e) => e.type === 'offered' && daysBetween(e.date, today()) <= 14).reverse().map((e) => e.food))].slice(0, 12);
  const pickList = (m.q ? CAT.foods.filter((f) => matches(f, m.q)).slice(0, 40) : recentIds.map((id) => FOOD.get(id)).filter(Boolean));
  const row = (f) => {
    const on = m.sel.includes(f.id); const s = fs(f.id);
    return `<li class="row${isLocked(f) && !s.tried ? ' locked' : ''}"><button class="pick" data-act="meal-pick" data-id="${f.id}" aria-pressed="${on}">
      <span class="cb" style="pointer-events:none">${on ? `<span class="box on">${I.check}</span>` : '<span class="box"></span>'}</span>
      <span class="rtext" style="pointer-events:none"><span class="rname">${esc(f.name)}</span><span class="meta">${s.tried ? `Offered ${s.offers.length}×` : '<span class="today">New food</span>'} ${markers(f, s)}</span></span></button></li>`;
  };
  app().innerHTML = `<div class="screen"><header class="top rule"><div class="top-row"><h1>Log meal</h1>${syncDot()}</div>
    <label class="field"><span>Date</span><input type="date" id="meal-date" value="${m.date}" max="${today()}"></label>
    <label class="search">${I.search}<input type="search" id="mq" placeholder="Add a food" value="${esc(m.q)}" autocomplete="off" autocorrect="off" aria-label="Search foods to add"></label>
    ${m.sel.length ? `<div class="sel">${m.sel.map((id) => `<button data-act="meal-pick" data-id="${id}" aria-label="Remove ${esc(FOOD.get(id).name)}">${esc(FOOD.get(id).name)}${I.close}</button>`).join('')}</div>` : ''}
    </header><main id="meal-list">${mealList(pickList, row, recentIds)}</main>
    ${m.sel.length ? `<div class="savebar"><button class="btn primary" data-act="meal-save">Log ${m.sel.length} food${m.sel.length === 1 ? '' : 's'} for ${m.date === today() ? 'today' : fmtDate(m.date)}</button></div>` : ''}
  </div>${tabbar()}`;
  $('#mq').addEventListener('input', (e) => {
    ui.meal.q = e.target.value;
    const list = ui.meal.q ? CAT.foods.filter((f) => matches(f, ui.meal.q)).slice(0, 40) : recentIds.map((id) => FOOD.get(id)).filter(Boolean);
    $('#meal-list').innerHTML = mealList(list, row, recentIds);
  });
  $('#meal-date').addEventListener('change', (e) => { ui.meal.date = e.target.value || today(); renderMeal(); });
}
function mealList(list, row, recentIds) {
  if (!list.length) return ui.meal.q ? `<div class="empty-state"><h2>No match for “${esc(ui.meal.q)}”</h2></div>`
    : '<div class="empty-state"><h2>Search to add foods</h2><p>Foods offered in the last 2 weeks will show here for one-tap logging.</p></div>';
  return `<h2 class="sec">${ui.meal.q ? 'Results' : 'Recent'}</h2><ul class="group">${list.map(row).join('')}</ul>`;
}

/* ---------- Settings tab ---------- */
function renderSettings() {
  const fb = firstBirthday();
  app().innerHTML = `<div class="screen"><header class="top"><div class="top-row"><h1>Settings</h1>${syncDot()}</div></header><div class="pad">
    <section class="form-group"><h2>This phone</h2>
      <label class="field"><span>Your name</span><input id="s-name" value="${esc(device.name)}" placeholder="Mom, Dad…" autocomplete="off"><span class="hint">Shown next to everything logged from this phone.</span></label>
      <label class="field"><span>GitHub token</span><input id="s-token" type="password" value="${esc(device.token)}" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false"><span class="hint">Stored only on this phone. Lets it read and save the shared log in ${CFG.owner}/${CFG.repo}.</span></label>
      <button class="btn secondary" data-act="save-phone">Save and test connection</button>
      ${ui.testMsg ? `<p class="${ui.testMsg.startsWith('✓') ? 'ok' : 'err'}" style="margin:0">${esc(ui.testMsg)}</p>` : ''}
    </section>
    <section class="form-group"><h2>Sync</h2><div class="status-line">${syncDot()}<span id="sync-label">${esc(syncLabel())}</span></div><p class="err" id="sync-err" style="margin:0">${esc(sync.error || '')}</p>
      <button class="btn secondary" data-act="sync-now"${device.token ? '' : ' disabled'}>Sync now</button></section>
    <section class="form-group"><h2>Baby</h2>
      <label class="field"><span>Name</span><input id="s-baby" value="${esc(S.child.name)}" autocomplete="off"></label>
      <label class="field"><span>Birthdate</span><input id="s-bday" type="date" value="${esc(S.child.birthdate)}" max="${today()}"><span class="hint">${fb ? `“Not until 12 months” foods unlock ${fmtDate(fb, true)}.` : 'Sets when “Not until 12 months” foods unlock.'} Shared with both phones.</span></label>
      <button class="btn secondary" data-act="save-baby">Save baby details</button></section>
    <section class="form-group"><h2>Allergen reminder</h2>
      <label class="field"><span>Remind after this many days without an offer</span><input id="s-nudge" type="number" inputmode="numeric" min="1" max="90" value="${esc(device.nudgeDays)}"></label>
      <button class="btn secondary" data-act="save-nudge">Save</button></section>
    <section class="form-group"><h2>Data</h2>
      <button class="btn secondary" data-act="catchup">Catch up: mark foods she’s already had</button>
      <button class="btn secondary" data-act="export">Export a copy of the log</button>
      <p class="note">Every save is also kept in the repo’s history on GitHub (data branch).</p></section>
    <p class="note" style="padding:0 4px">For tracking only; not medical advice. Food prep guidance links to Solid Starts; safety notes cite CDC, FDA and other public-health sources. Version ${VERSION}.</p>
  </div></div>${tabbar()}`;
}

/* ---------- First run & catch-up ---------- */
function renderFirst() {
  const step = ui.first;
  if (step === 0) {
    app().innerHTML = `<div class="first"><span class="steps">Step 1 of 4 · This phone</span><h1>Who’s using this phone?</h1>
      <p>Your name is saved with everything you log, so you can see who logged what.</p>
      <label class="field"><span>Your name</span><input id="f-name" value="${esc(device.name)}" placeholder="Mom, Dad…" autocomplete="off"></label>
      <label class="field"><span>GitHub token</span><input id="f-token" type="password" value="${esc(device.token)}" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false"><span class="hint">Paste the token from the Passwords app. It stays on this phone. You can skip this and add it later in Settings.</span></label>
      ${ui.testMsg ? `<p class="${ui.testMsg.startsWith('✓') ? 'ok' : 'err'}" style="margin:0">${esc(ui.testMsg)}</p>` : ''}
      <div class="actions"><button class="btn primary" data-act="first-next0">Continue</button></div></div>`;
  } else if (step === 1) {
    app().innerHTML = `<div class="first"><span class="steps">Step 2 of 4 · Baby</span><h1>About your baby</h1>
      <p>Her birthdate sets when the “Not until 12 months” foods unlock. If your partner already set this up, it will fill in after syncing.</p>
      <label class="field"><span>Name</span><input id="f-baby" value="${esc(S.child.name)}" autocomplete="off"></label>
      <label class="field"><span>Birthdate</span><input id="f-bday" type="date" value="${esc(S.child.birthdate)}" max="${today()}"></label>
      <div class="actions"><button class="btn primary" data-act="first-next1">Continue</button><button class="btn secondary" data-act="first-back">Back</button></div></div>`;
  } else if (step === 2) {
    renderCatchup(true);
  } else {
    app().innerHTML = `<div class="first"><span class="steps">Step 4 of 4 · iPhone</span><h1>Add to Home Screen</h1>
      <p>It opens like an app, works offline, and keeps its data on this phone.</p>
      <ol class="howto"><li>Tap the <b>Share</b> button in Safari (the square with an arrow).</li><li>Scroll and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>, then open First Foods from your Home Screen.</li></ol>
      <div class="actions"><button class="btn primary" data-act="first-done">${isStandalone() ? 'Done' : 'I’ll do that now'}</button></div></div>`;
  }
}
function renderCatchup(inFirstRun) {
  const q = ui.catchQ;
  const list = CAT.foods.filter((f) => !fs(f.id).tried && !isLocked(f) && matches(f, q));
  const n = ui.catchSel.size;
  app().innerHTML = `<div class="screen" style="padding-bottom:120px"><header class="top rule">
    ${inFirstRun ? '<span class="steps" style="font-size:14px;font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.5px">Step 3 of 4 · Catch up</span>' : ''}
    <div class="top-row"><h1 style="font-size:30px;line-height:36px">What has she already had?</h1></div>
    <p class="sub" style="margin:0">Tick everything she’s eaten so far. No dates needed. You can do this later from Settings.</p>
    <label class="search">${I.search}<input type="search" id="cq" placeholder="Search foods" value="${esc(q)}" autocomplete="off" aria-label="Search foods"></label></header>
    <main id="catch-list">${catchList(list)}</main>
    <div class="savebar" style="bottom:0;padding-bottom:calc(var(--safe-bottom) + 12px);display:flex;flex-direction:column;gap:8px">
      <button class="btn primary" data-act="catch-save" ${n ? '' : 'disabled'}>Mark ${n} food${n === 1 ? '' : 's'} as tried</button>
      <button class="btn secondary" data-act="catch-skip">${inFirstRun ? 'Skip for now' : 'Cancel'}</button></div></div>`;
  $('#cq').addEventListener('input', (e) => { ui.catchQ = e.target.value; $('#catch-list').innerHTML = catchList(CAT.foods.filter((f) => !fs(f.id).tried && !isLocked(f) && matches(f, ui.catchQ))); });
}
function catchList(list) {
  return CAT.categories.map((c) => {
    const items = list.filter((f) => f.category === c.id); if (!items.length) return '';
    return `<h2 class="sec">${esc(c.label)}</h2><ul class="group">${items.map((f) => {
      const on = ui.catchSel.has(f.id);
      return `<li class="row"><button class="pick" data-act="catch-pick" data-id="${f.id}" aria-pressed="${on}"><span class="cb" style="pointer-events:none">${on ? `<span class="box on">${I.check}</span>` : '<span class="box"></span>'}</span><span class="rname" style="pointer-events:none">${esc(f.name)}</span></button></li>`;
    }).join('')}</ul>`;
  }).join('');
}

/* ---------- render orchestration ---------- */
function renderTab() {
  // keep the undo toast clear of bottom action bars
  document.body.classList.toggle('has-savebar', device.onboarded && ui.tab === 'meal' && ui.meal.sel.length > 0);
  document.body.classList.toggle('has-catchbar', ui.tab === 'catchup' || (!device.onboarded && ui.first === 2));
  if (!device.onboarded) return renderFirst();
  if (ui.tab === 'catchup') return renderCatchup(false);
  ({ foods: renderFoods, meal: renderMeal, allergens: renderAllergens, settings: renderSettings })[ui.tab]();
}
function renderOverlay() {
  const o = $('#overlay');
  const html = ui.overlay === 'food' ? renderDetail() : ui.overlay === 'warn' ? renderWarn() : ui.overlay === 'sync' ? renderSyncSheet() : ui.overlay === 'confirm' ? renderConfirm() : '';
  const sheet = $('.sheet', o); const top = sheet ? sheet.scrollTop : 0;
  o.innerHTML = html;
  const ns = $('.sheet', o); if (ns) ns.scrollTop = top;
  document.body.classList.toggle('locked', !!html);
}
function refresh() {
  // Re-render without losing scroll, focus, or half-typed form fields.
  const active = document.activeElement;
  const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  const formScreen = !device.onboarded || ui.tab === 'settings'; // never redraw forms under the user
  if (!typing && !formScreen) { const y = scrollY; renderTab(); scrollTo(0, y); }
  else if (ui.tab === 'foods' && $('#list')) { $('#list').innerHTML = foodsList(); const s = $('#summary'); if (s) s.innerHTML = foodsSummary(); }
  if (ui.overlay && !(typing && active.closest('#overlay'))) renderOverlay();
}
function openOverlay(name) { ui.overlay = name; renderOverlay(); }
function closeOverlay() { ui.overlay = null; ui.histAll = false; renderOverlay(); refresh(); }

/* ---------- actions ---------- */
function markTried(id, date = today()) {
  const made = addEvents([offerEvent(id, date)]);
  ui.strip = id;
  toast(`${FOOD.get(id).name} marked tried · ${date === today() ? 'Today' : fmtDate(date)}`, made);
  refresh();
}
function toggleFood(id) {
  const f = FOOD.get(id); const s = fs(id);
  if (!s.tried) {
    if (isLocked(f)) { ui.food = id; ui.warnFrom = 'toggle'; openOverlay('warn'); return; }
    markTried(id); return;
  }
  // Untick: undo every "tried" kind of entry for this food, after confirming.
  const evs = s.events.filter((e) => ['offered', 'tried', 'firstTried'].includes(e.type));
  ui.confirm = { title: `Unmark ${f.name}?`, body: `This removes ${evs.length === 1 ? 'its tried entry' : `all ${evs.length} tried/offered entries`}. Liking and notes stay.`, yes: 'Unmark tried',
    run: () => { const made = undoEvents(evs); toast(`${f.name} unmarked`, made); } };
  openOverlay('confirm');
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act; const id = el.dataset.id;
  if (act === 'close-bg' && ev.target !== el) return; // clicks inside the sheet
  switch (act) {
    case 'tab': ui.tab = el.dataset.tab; ui.strip = null; scrollTo(0, 0); renderTab(); break;
    case 'filter': ui.filter = el.dataset.f; ui.strip = null; renderFoods(); break;
    case 'clear-search': ui.q = ''; renderFoods(); break;
    case 'toggle': toggleFood(id); break;
    case 'open': ui.food = id; ui.histAll = false; openOverlay('food'); break;
    case 'strip': ui.strip = ui.strip === id ? null : id; refresh(); break;
    case 'like': {
      const v = el.dataset.v; if (fs(id).liking === v) { ui.strip = null; refresh(); break; }
      addEvents([{ type: 'liking', food: id, value: v }]); if (ui.overlay !== 'food') ui.strip = null; refresh(); break;
    }
    case 'reaction': if (fs(id).reaction !== el.dataset.v) { addEvents([{ type: 'reaction', food: id, value: el.dataset.v }]); refresh(); } break;
    case 'plus1': {
      const f = FOOD.get(id);
      if (isLocked(f) && !fs(id).tried) { ui.food = id; ui.warnFrom = 'plus'; openOverlay('warn'); break; }
      const made = addEvents([offerEvent(id)]); toast(`${f.name} · +1 offer today`, made); refresh(); break;
    }
    case 'hist-all': ui.histAll = true; renderOverlay(); break;
    case 'close': closeOverlay(); break;
    case 'close-bg': closeOverlay(); break;
    case 'warn-back': if (ui.warnFrom === 'meal') { ui.pendingMeal = null; } closeOverlay(); break;
    case 'warn-log': {
      const fid = ui.food;
      if (ui.warnFrom === 'meal') { ui.meal.sel.push(fid); ui.overlay = null; renderOverlay(); renderMeal(); break; }
      ui.overlay = null; renderOverlay(); markTried(fid); break;
    }
    case 'confirm-yes': { const c = ui.confirm; ui.overlay = null; renderOverlay(); c.run(); refresh(); break; }
    case 'toast-undo': if (toastUndo) { undoEvents(toastUndo); toastUndo = null; $('#toast').innerHTML = ''; ui.strip = null; refresh(); } break;
    case 'expand': ui.expanded.has(id) ? ui.expanded.delete(id) : ui.expanded.add(id); renderAllergens(); break;
    case 'sync-sheet': openOverlay('sync'); break;
    case 'sync-now': runSync(); break;
    case 'goto-settings': ui.overlay = null; renderOverlay(); ui.tab = 'settings'; renderTab(); break;
    case 'dismiss-home': device.homeTipDismissed = true; saveDevice(); renderFoods(); break;
    case 'meal-pick': {
      const f = FOOD.get(id); const sel = ui.meal.sel;
      if (sel.includes(id)) { sel.splice(sel.indexOf(id), 1); renderMeal(); break; }
      if (isLocked(f) && !fs(id).tried) { ui.food = id; ui.warnFrom = 'meal'; openOverlay('warn'); break; }
      sel.push(id); renderMeal(); break;
    }
    case 'meal-save': {
      const m = ui.meal; const made = addEvents(m.sel.map((fid) => offerEvent(fid, m.date)));
      toast(`Logged ${m.sel.length} food${m.sel.length === 1 ? '' : 's'} · ${m.date === today() ? 'Today' : fmtDate(m.date)}`, made);
      ui.meal = { date: today(), sel: [], q: '' }; renderMeal(); break;
    }
    case 'save-phone': savePhone($('#s-name').value, $('#s-token').value); break;
    case 'save-baby': saveBaby($('#s-baby').value, $('#s-bday').value); toast('Baby details saved'); renderSettings(); break;
    case 'save-nudge': { const n = Math.max(1, Math.min(90, parseInt($('#s-nudge').value, 10) || 14)); device.nudgeDays = n; saveDevice(); toast(`Reminder set to ${n} days`); renderSettings(); break; }
    case 'export': exportLog(); break;
    case 'catchup': ui.catchSel = new Set(); ui.catchQ = ''; ui.tab = 'catchup'; scrollTo(0, 0); renderTab(); break;
    case 'catch-pick': {
      ui.catchSel.has(id) ? ui.catchSel.delete(id) : ui.catchSel.add(id);
      el.setAttribute('aria-pressed', ui.catchSel.has(id));
      el.querySelector('.cb').innerHTML = ui.catchSel.has(id) ? `<span class="box on">${I.check}</span>` : '<span class="box"></span>';
      const b = $('[data-act="catch-save"]'); const n = ui.catchSel.size; b.disabled = !n; b.textContent = `Mark ${n} food${n === 1 ? '' : 's'} as tried`; break;
    }
    case 'catch-save': {
      const ids = [...ui.catchSel]; addEvents(ids.map((fid) => ({ type: 'tried', food: fid })));
      toast(`${ids.length} food${ids.length === 1 ? '' : 's'} marked tried`); ui.catchSel = new Set();
      if (!device.onboarded) { ui.first = 3; renderFirst(); } else { ui.tab = 'foods'; renderTab(); }
      scrollTo(0, 0); break;
    }
    case 'catch-skip': if (!device.onboarded) { ui.first = 3; renderFirst(); } else { ui.tab = 'settings'; renderTab(); } scrollTo(0, 0); break;
    case 'first-next0': {
      device.name = $('#f-name').value.trim(); device.token = $('#f-token').value.trim(); saveDevice();
      if (!device.name) { ui.testMsg = 'Add your name so entries show who logged them.'; renderFirst(); break; }
      ui.testMsg = ''; ui.first = 1;
      if (device.token) runSync(); renderFirst(); break;
    }
    case 'first-next1': saveBaby($('#f-baby').value, $('#f-bday').value); ui.first = 2; scrollTo(0, 0); renderFirst(); break;
    case 'first-back': ui.first = Math.max(0, ui.first - 1); renderFirst(); break;
    case 'first-done': device.onboarded = true; saveDevice(); ui.tab = 'foods'; renderTab(); break;
    default: break;
  }
});
// Notes save when the field loses focus; first-tried date saves on change.
document.addEventListener('change', (ev) => {
  const el = ev.target; const act = el.dataset && el.dataset.act;
  if (act === 'note') { const v = el.value.trim(); if (v !== fs(el.dataset.id).note) { addEvents([{ type: 'note', food: el.dataset.id, value: v }]); toast('Note saved'); } }
  if (act === 'first-date' && el.value) { addEvents([{ type: 'firstTried', food: el.dataset.id, value: el.value }]); renderOverlay(); }
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ui.overlay) closeOverlay(); });

function saveBaby(name, bday) {
  name = name.trim(); bday = bday || '';
  if (name !== S.child.name || bday !== S.child.birthdate) addEvents([{ type: 'child', value: { name, birthdate: bday } }]);
}
async function savePhone(name, token) {
  device.name = name.trim(); device.token = token.trim(); saveDevice();
  if (!device.token) { ui.testMsg = 'Saved. No token: entries stay on this phone.'; renderSettings(); return; }
  ui.testMsg = 'Testing…'; renderSettings();
  try {
    await pull(); ui.testMsg = '✓ Connected to GitHub. Syncing now.'; runSync();
  } catch (e) { ui.testMsg = e instanceof TypeError ? 'No connection. Try again when online.' : e.message; }
  renderSettings();
}
async function exportLog() {
  const json = serialize(allEvents());
  const file = new File([json], `first-foods-log-${today()}.json`, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'First Foods log' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- start ---------- */
(async function start() {
  try { await loadCatalog(); } catch (e) {
    app().innerHTML = '<div class="empty-state"><h2>Couldn’t load the food list</h2><p>Check your connection and reopen the app.</p></div>'; return;
  }
  derive();
  if (!device.token) sync.status = 'nosetup';
  renderTab();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  runSync();
})();
