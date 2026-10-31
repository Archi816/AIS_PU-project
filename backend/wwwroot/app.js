/* LEMS single-page frontend (vanilla JS). Talks to the C# backend under /api (cookie session). */
const $app = document.getElementById('app');
let user = null, timers = [], eqState = { q: '', category: '', status: '', sort: 'name', page: 1 };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtT = d => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const label = s => String(s).replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
const badge = s => `<span class="badge b-${String(s).toLowerCase()}">${label(s)}</span>`;
const isAdmin = () => user?.role === 'ADMIN';
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localIso = d => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3500);
}

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'LEMS' } : { 'X-Requested-With': 'LEMS' }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { }
  if (res.status === 401 && path !== '/auth/login') { user = null; showAuth('login'); throw { handled: true }; }
  if (!res.ok) throw { status: res.status, message: data?.error || 'Request failed', fields: data?.fields || {} };
  return data;
}

function clearTimers() { timers.forEach(clearInterval); timers = []; }

/* ---------- modal ---------- */
function modal(html, onMount) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  document.body.append(ov); onMount?.(ov.firstChild, close);
  ov.querySelector('input:not([disabled]),textarea,select')?.focus();
  return ov;
}
function confirmBox(title, text, okLabel, danger) {
  return new Promise(resolve => modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p>
    <div class="foot"><button class="btn" data-n>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-y>${esc(okLabel)}</button></div>`,
    (m, close) => { m.querySelector('[data-n]').onclick = () => { close(); resolve(false); }; m.querySelector('[data-y]').onclick = () => { close(); resolve(true); }; }));
}
const fieldErr = (f, k) => f?.[k] ? `<div class="err">${esc(f[k])}</div>` : '';

/* ---------- auth screens ---------- */
function showAuth(mode, errors = {}, msg = '', vals = {}) {
  clearTimers();
  const reg = mode === 'register';
  $app.innerHTML = `<div class="auth"><section class="hero"><div class="mark">L</div>
      <h1>Laboratory Equipment<br>Management System</h1>
      <p>Reserve laboratory equipment, follow every decision and report faults - all in one place.</p>
      <ul><li>Book equipment in one-hour slots</li><li>Get notified about approvals and changes</li><li>Report problems with AI-assisted triage for technicians</li></ul></section>
    <section class="formwrap"><div class="card">
    <h2>${reg ? 'Create student account' : 'Log in'}</h2>
    <label>Email</label><input id="email" type="email" value="${esc(vals.email)}" placeholder="${reg ? 'name.surname@student.tuke.sk' : 'you@example.com'}">${fieldErr(errors, 'email')}
    <label>Password</label><input id="pw" type="password">${fieldErr(errors, 'password')}
    ${reg ? `<label>Confirm password</label><input id="pw2" type="password">${fieldErr(errors, 'confirmPassword')}` : ''}
    ${msg ? `<div class="alert">${esc(msg)}</div>` : ''}
    <button class="btn primary" id="go" style="width:100%;margin-top:18px">${reg ? 'Create Account' : 'Log In'}</button>
    <div class="alt">${reg ? 'Have an account? <a id="sw">Log in</a>' : 'New student? <a id="sw">Create an account</a>'}</div>
  </div></div></section></div>`;
  document.getElementById('email')?.focus();
  const val = id => document.getElementById(id)?.value ?? '';
  const submit = async () => {
    const email = val('email');
    try {
      user = await api(reg ? '/auth/register' : '/auth/login', 'POST', reg ? { email, password: val('pw'), confirmPassword: val('pw2') } : { email, password: val('pw') });
      location.hash = '#/dashboard'; route();
    } catch (e) { if (!e.handled) showAuth(mode, e.fields, e.message, { email }); }
  };
  document.getElementById('go').onclick = submit;
  $app.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => e.key === 'Enter' && submit()));
  document.getElementById('sw').onclick = () => showAuth(reg ? 'login' : 'register');
}

/* ---------- shell ---------- */
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  dashboard: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  equipment: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M3 13h18"/>'),
  bookings: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  repairs: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>'),
  bell: svg('<path d="M6 9a6 6 0 0112 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 004 0"/>')
};
const NAV = () => [['dashboard', 'Dashboard'], ['equipment', 'Equipment'], ['bookings', 'Bookings'], ['repairs', 'Repair Requests']];

function shell(page) {
  const ini = (user.name[0] + user.surname[0]).toUpperCase();
  $app.innerHTML = `<div class="shell">
    <header class="top">
      <button class="burger" id="burger" aria-label="Open menu">☰</button>
      <a class="brand" href="#/dashboard"><span class="mark">L</span><span><b>LEMS</b><small>Laboratory Equipment Management</small></span></a>
      <div class="grow"></div>
      <div class="rel"><button class="bell" id="bell" aria-label="Notifications">${ICON.bell}<span class="badge-n" id="nbadge" hidden>0</span></button><div class="drop notes" id="notes" hidden></div></div>
      <div class="rel"><button class="acct" id="acct" aria-label="Account menu"><span class="avatar">${esc(ini)}</span><span class="who"><b>${esc(user.name)} ${esc(user.surname)}</b><span class="role">${isAdmin() ? 'Administrator' : 'Student'}</span></span></button>
        <div class="drop" id="menu" hidden><div class="it"><small>Signed in as</small><br><b>${esc(user.email)}</b><br><small>${isAdmin() ? 'Administrator' : 'Student'}</small></div>
        <div class="it"><button class="btn" id="logout" style="width:100%">Log out</button></div></div></div>
    </header>
    <div class="body">
      <aside class="side" id="side"><nav class="nav">${NAV().map(([k, t]) => `<a href="#/${k}" class="${k === page ? 'active' : ''}">${ICON[k]}<span>${t}</span></a>`).join('')}</nav>
        <div class="side-foot">LEMS prototype<br>Unofficial draft</div></aside>
      <main class="content" id="view" tabindex="-1"></main>
    </div></div>`;
  const notes = document.getElementById('notes'), menu = document.getElementById('menu'), side = document.getElementById('side');
  document.getElementById('burger').onclick = e => { e.stopPropagation(); side.classList.toggle('open'); };
  side.onclick = () => side.classList.remove('open');
  document.getElementById('bell').onclick = async e => { e.stopPropagation(); menu.hidden = true; notes.hidden = !notes.hidden; if (!notes.hidden) { await loadNotes(true); } };
  document.getElementById('acct').onclick = e => { e.stopPropagation(); notes.hidden = true; menu.hidden = !menu.hidden; };
  document.onclick = () => { notes.hidden = true; menu.hidden = true; side.classList.remove('open'); };
  notes.onclick = e => e.stopPropagation();
  document.getElementById('logout').onclick = async () => { await api('/auth/logout', 'POST'); user = null; showAuth('login'); };
  loadNotes(false); timers.push(setInterval(() => loadNotes(false), 15000));
}

async function loadNotes(markRead) {
  try {
    const d = await api('/notifications');
    const b = document.getElementById('nbadge'); if (!b) return;
    b.hidden = d.unread === 0; b.textContent = d.unread;
    document.getElementById('notes').innerHTML = d.items.length
      ? d.items.map(n => `<div class="it note ${n.isRead ? '' : 'unread'}">${esc(n.message)}<small>${fmt(n.createdAt)}</small></div>`).join('')
      : '<div class="it empty">No notifications</div>';
    if (markRead && d.unread) { await api('/notifications/read-all', 'POST'); b.hidden = true; }
  } catch { }
}

/* ---------- router ---------- */
async function route() {
  if (!user) { try { user = await api('/auth/me'); } catch { if (!$app.querySelector('.auth')) showAuth('login'); return; } }
  const page = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  const pages = { dashboard, equipment, bookings, repairs };
  clearTimers(); shell(pages[page] ? page : 'dashboard');
  const view = document.getElementById('view');
  view.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  await (pages[page] || dashboard)(view);
}
window.addEventListener('hashchange', route);

/* ---------- dashboard ---------- */
async function dashboard(view) {
  const draw = async () => {
    let d, mine = [];
    try { d = await api('/dashboard'); if (!isAdmin()) mine = await api('/bookings'); } catch { return; }
    const stat = (n, l, cls, href) => `<${href ? `a href="${href}"` : 'div'} class="card stat ${cls || ''}"><div class="n">${n}</div><div class="l">${l}</div></${href ? 'a' : 'div'}>`;
    const now = Date.now();
    const upcoming = mine.filter(b => ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(b.status) && new Date(b.end) > now).sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 4);
    const todo = (n, text, href) => `<a class="todo" href="${href}"><span>${text}</span><span class="num ${n ? '' : 'zero'}">${n}</span></a>`;
    const side = isAdmin()
      ? `<div class="card"><h2>Needs your attention</h2>${todo(d.admin.pendingBookings, 'Booking requests waiting for a decision', '#/bookings')}${todo(d.admin.repairsOpen, 'Open repair requests', '#/repairs')}${todo(d.equipment.maintenance, 'Equipment under maintenance', '#/equipment')}</div>`
      : `<div class="card"><h2>Your upcoming bookings</h2>${upcoming.length ? upcoming.map(b => `<a class="todo" href="#/bookings"><span><b>${esc(b.equipmentTitle)}</b><br><small>${fmt(b.start)}</small></span>${badge(b.status)}</a>`).join('') : '<div class="empty" style="padding:22px 0"><b>Nothing booked</b>Reserve equipment on the Equipment page.</div>'}</div>`;
    view.innerHTML = `<h1>Dashboard</h1><p class="sub">Overview of laboratory equipment and recent activity.</p>
      <div class="grid g4">${stat(d.equipment.available, 'Available equipment', 'ok', '#/equipment')}${stat(d.equipment.reserved, 'Reserved right now', 'warn', '#/equipment')}${stat(d.equipment.maintenance, 'Under maintenance', 'bad', '#/equipment')}${stat(d.equipment.total, 'Total equipment', '', '#/equipment')}</div>
      ${d.admin ? `<div class="grid g4" style="margin-top:18px">${stat(d.admin.repairsOpen, 'Open repair requests', 'warn', '#/repairs')}${stat(d.admin.repairsClosed, 'Closed repair requests', 'ok', '#/repairs')}${stat(d.admin.students, 'Students', 'gold')}${stat(d.admin.admins, 'Administrators', 'gold')}</div>` : ''}
      <div class="grid g2" style="margin-top:22px">
        <div class="card feed"><h2>Activity feed</h2>${d.feed.length ? d.feed.map(e => `<div class="ev">${esc(e.message)}<small>${fmt(e.createdAt)}</small></div>`).join('') : '<div class="empty"><b>No activity yet</b>Changes to equipment and reservations appear here.</div>'}</div>
        ${side}</div>`;
  };
  await draw(); timers.push(setInterval(draw, 10000));
}

/* ---------- equipment ---------- */
async function equipment(view) {
  const draw = async () => {
    const p = new URLSearchParams({ q: eqState.q, category: eqState.category, status: eqState.status, sort: eqState.sort, page: eqState.page, pageSize: 9 });
    const d = await api('/equipment?' + p);
    const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
    const tab = (k, t, n) => `<button class="tab ${eqState.status === k ? 'active' : ''}" data-tab="${k}">${t}<span>${n}</span></button>`;
    view.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:start"><div><h1>Equipment</h1><p class="sub">Browse laboratory equipment${isAdmin() ? ' and manage the inventory' : ', book it and report problems'}.</p></div>
      ${isAdmin() ? '<button class="btn primary" id="add">+ Add Equipment</button>' : ''}</div>
      <div class="toolbar"><input id="q" placeholder="Search by name or inventory number" value="${esc(eqState.q)}">
        <select id="stat"><option value="">All statuses</option>${[['AVAILABLE', 'Available'], ['RESERVED', 'Reserved'], ['MAINTENANCE', 'Maintenance']].map(([v, t]) => `<option value="${v}" ${eqState.status === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <select id="cat"><option value="">All categories</option>${d.categories.map(c => `<option ${c === eqState.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="sort">${[['name', 'Sort: Name'], ['inventory', 'Sort: Inventory no.'], ['status', 'Sort: Status'], ['newest', 'Sort: Newest']].map(([v, t]) => `<option value="${v}" ${eqState.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="tabs">${tab('', 'All Equipment', d.counts.all)}${tab('AVAILABLE', 'Available', d.counts.available)}${tab('RESERVED', 'Reserved', d.counts.reserved)}${tab('MAINTENANCE', 'Maintenance', d.counts.maintenance)}</div>
      ${d.items.length ? `<div class="grid g3">${d.items.map(card).join('')}</div>` : '<div class="card empty"><b>No equipment found</b>Try another search or filter.</div>'}
      <div class="pager"><span>Showing ${d.items.length} of ${d.total} items</span><div>
        <button class="btn sm" id="prev" ${eqState.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span style="padding:4px 8px">Page ${d.page} / ${pages}</span>
        <button class="btn sm" id="next" ${eqState.page >= pages ? 'disabled' : ''}>Next ›</button></div></div>`;
    let t; const q = document.getElementById('q');
    q.oninput = () => { clearTimeout(t); t = setTimeout(async () => { eqState.q = q.value; eqState.page = 1; await draw(); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); };
    document.getElementById('cat').onchange = e => { eqState.category = e.target.value; eqState.page = 1; draw(); };
    document.getElementById('stat').onchange = e => { eqState.status = e.target.value; eqState.page = 1; draw(); };
    document.getElementById('sort').onchange = e => { eqState.sort = e.target.value; draw(); };
    view.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { eqState.status = b.dataset.tab; eqState.page = 1; draw(); });
    document.getElementById('prev').onclick = () => { eqState.page--; draw(); };
    document.getElementById('next').onclick = () => { eqState.page++; draw(); };
    document.getElementById('add')?.addEventListener('click', () => equipmentForm(null, draw));
    const byId = Object.fromEntries(d.items.map(e => [e.id, e]));
    view.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const e = byId[b.dataset.id];
      ({ book: () => bookModal(e, draw), report: () => reportModal(e), edit: () => equipmentForm(e, draw), del: () => deleteFlow(e, draw) })[b.dataset.act]();
    });
  };
  await draw();
  timers.push(setInterval(() => { if (!document.querySelector('.ov') && document.activeElement?.id !== 'q') draw().catch(() => { }); }, 15000));
}

const thumb = e => e.hasImage
  ? `<img class="photo" src="/api/equipment/${e.id}/image?v=${e.imageVersion}" alt="Photo of ${esc(e.title)}" loading="lazy">`
  : (typeof equipmentArt === 'function' ? equipmentArt(e) : '');

/* Photos: shrink in the browser (max 900 px, JPEG) before upload, so files stay small and uniform. */
async function shrinkImage(file, max = 900) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This file is not a valid image')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Could not process the image')), 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}
async function uploadPhoto(id, file) {
  const blob = await shrinkImage(file);
  const res = await fetch(`/api/equipment/${id}/image`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'X-Requested-With': 'LEMS' }, body: blob });
  if (!res.ok) { let m = 'Photo upload failed'; try { m = (await res.json()).error || m; } catch { } throw { message: m, fields: {} }; }
}

function card(e) {
  const maint = e.status === 'MAINTENANCE';
  const acts = isAdmin()
    ? `<button class="btn" data-act="edit" data-id="${e.id}">Edit</button><button class="btn danger" data-act="del" data-id="${e.id}">Remove</button>`
    : `<button class="btn primary" data-act="book" data-id="${e.id}" ${maint ? 'disabled title="Equipment is under maintenance"' : ''}>Book</button><button class="btn" data-act="report" data-id="${e.id}">Report Issue</button>`;
  return `<div class="card eq st-${e.status}"><div class="thumb">${thumb(e)}</div><h3>${esc(e.title)}</h3>
    <div class="meta">Inv. No.: ${esc(e.inventoryNumber)}</div><div class="meta">📍 ${esc(e.location)} · ${esc(e.category)}</div>
    <div class="row">${badge(e.status)}</div><div class="acts">${acts}</div></div>`;
}

async function bookModal(e, refresh) {
  let sel = null; const today = new Date();
  modal(`<h2>Book ${esc(e.title)}</h2><p class="sub" style="margin-bottom:0">${esc(e.inventoryNumber)} · ${esc(e.location)}${e.status === 'RESERVED' ? ' · currently in use, pick a free slot for another time' : ''}</p>
    <label>Date</label><input type="date" id="bd" value="${ymd(today)}" min="${ymd(today)}">
    <label>Available one-hour slots</label><div class="slots" id="slots"></div><div id="e-start"></div>
    <label>Purpose</label><textarea id="bdesc" rows="3" maxlength="500" placeholder="What will you use the equipment for?"></textarea><div id="e-desc"></div><div id="e-gen"></div>
    <div class="foot"><button class="btn" id="cx">Cancel</button><button class="btn primary" id="ok">Submit request</button></div>`, (m, close) => {
    const loadSlots = async () => {
      sel = null;
      const dateEl = m.querySelector('#bd');
      let d = await api(`/equipment/${e.id}/slots?date=${dateEl.value}`);
      // every slot of today already started -> continue with tomorrow
      if (d.slots.length && d.slots.every(s => s.state === 'past')) {
        const t = new Date(dateEl.value + 'T00:00:00'); t.setDate(t.getDate() + 1); dateEl.value = ymd(t);
        d = await api(`/equipment/${e.id}/slots?date=${dateEl.value}`);
      }
      const note = d.slots.some(s => s.state === 'maintenance') ? 'This equipment is under maintenance and cannot be booked.'
        : d.slots.some(s => s.state === 'free') ? '' : 'No free slots on this date - choose another day.';
      m.querySelector('#e-start').innerHTML = note ? `<div class="err">${note}</div>` : '';
      m.querySelector('#slots').innerHTML = d.slots.map(s => {
        const free = s.state === 'free';
        return `<button class="slot" data-s="${s.start}" ${free ? '' : 'disabled'} title="${s.state}">${fmtT(s.start)}–${fmtT(s.end)}${s.state === 'mine' ? '<br><small>yours</small>' : s.state === 'taken' ? '<br><small>taken</small>' : ''}</button>`;
      }).join('');
      m.querySelectorAll('.slot:not(:disabled)').forEach(b => b.onclick = () => { m.querySelectorAll('.slot').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); sel = b.dataset.s; });
    };
    m.querySelector('#bd').onchange = loadSlots; loadSlots();
    m.querySelector('#cx').onclick = close;
    m.querySelector('#ok').onclick = async () => {
      m.querySelectorAll('.err').forEach(x => x.remove());
      try {
        await api('/bookings', 'POST', { equipmentId: e.id, start: sel, description: m.querySelector('#bdesc').value });
        close(); toast('Booking request sent - waiting for administrator'); refresh();
      } catch (er) {
        if (er.handled) return;
        m.querySelector('#e-start').innerHTML = fieldErr(er.fields, 'start'); m.querySelector('#e-desc').innerHTML = fieldErr(er.fields, 'description');
        if (!Object.keys(er.fields).length) m.querySelector('#e-gen').innerHTML = `<div class="alert">${esc(er.message)}</div>`;
        if (er.status === 409) loadSlots();
      }
    };
  });
}

function reportModal(e) {
  modal(`<h2>Report a problem</h2><p class="sub" style="margin-bottom:0">${esc(e.title)} (${esc(e.inventoryNumber)})</p>
    <label>Title</label><input id="rt" maxlength="50" placeholder="Short summary"><div id="e-title"></div>
    <label>Description (please write in English - the AI assistant works in English)</label><textarea id="rd" rows="5" maxlength="500" placeholder="Describe what is wrong"></textarea><div id="e-desc"></div>
    <div class="foot"><button class="btn" id="cx">Cancel</button><button class="btn primary" id="ok">Submit report</button></div>`, (m, close) => {
    m.querySelector('#cx').onclick = close;
    m.querySelector('#ok').onclick = async () => {
      try {
        await api('/repairs', 'POST', { equipmentId: e.id, title: m.querySelector('#rt').value, description: m.querySelector('#rd').value });
        close(); toast('Problem report submitted');
      } catch (er) {
        if (er.handled) return;
        m.querySelector('#e-title').innerHTML = fieldErr(er.fields, 'title'); m.querySelector('#e-desc').innerHTML = fieldErr(er.fields, 'description');
      }
    };
  });
}

function equipmentForm(e, refresh) {
  const v = e || { inventoryNumber: '', title: '', description: '', location: '', category: '', status: 'AVAILABLE' };
  const f = (id, lbl, val, max) => `<label>${lbl}</label><input id="f-${id}" maxlength="${max}" value="${esc(val)}"><div id="e-${id}"></div>`;
  modal(`<h2>${e ? 'Edit equipment' : 'Add equipment'}</h2>
    ${f('inventoryNumber', 'Inventory number', v.inventoryNumber, 10)}${f('title', 'Title', v.title, 25)}${f('category', 'Category', v.category, 30)}${f('location', 'Location', v.location, 20)}
    <label>Description</label><textarea id="f-description" rows="3" maxlength="250">${esc(v.description)}</textarea><div id="e-description"></div>
    ${e ? `<label>Status</label>${v.status === 'RESERVED'
      ? '<input value="Reserved (in use right now - managed automatically)" disabled>'
      : `<select id="f-status"><option value="AVAILABLE" ${v.status === 'AVAILABLE' ? 'selected' : ''}>Available</option><option value="MAINTENANCE" ${v.status === 'MAINTENANCE' ? 'selected' : ''}>Maintenance (cancels pending & confirmed bookings)</option></select>`}` : ''}
    <label>Photo (optional - PNG, JPEG or WebP)</label>
    <div class="photo-row"><div class="photo-prev" id="prev">${thumb(v)}</div>
      <div><input type="file" id="f-photo" accept="image/png,image/jpeg,image/webp">
      ${e?.hasImage ? '<button type="button" class="btn sm danger" id="rm-photo" style="margin-top:8px">Remove photo</button>' : ''}<div id="e-photo"></div></div></div>
    <div id="e-gen"></div><div class="foot"><button class="btn" id="cx">Cancel</button><button class="btn primary" id="ok">Save</button></div>`, (m, close) => {
    let removePhoto = false;
    m.querySelector('#cx').onclick = close;
    m.querySelector('#f-photo').onchange = ev => {
      const f = ev.target.files[0]; if (!f) return;
      removePhoto = false; m.querySelector('#prev').innerHTML = `<img class="photo" alt="" src="${URL.createObjectURL(f)}">`;
    };
    const rm = m.querySelector('#rm-photo');
    if (rm) rm.onclick = () => { removePhoto = true; m.querySelector('#f-photo').value = ''; m.querySelector('#prev').innerHTML = equipmentArt(v); rm.remove(); };
    m.querySelector('#ok').onclick = async () => {
      const g = id => m.querySelector('#f-' + id)?.value;
      const body = { inventoryNumber: g('inventoryNumber'), title: g('title'), category: g('category'), location: g('location'), description: g('description'), status: g('status') ?? v.status };
      if (e && body.status === 'MAINTENANCE' && v.status !== 'MAINTENANCE' && !(await confirmBox('Place under maintenance?', 'All pending and confirmed bookings of this equipment will be canceled and students notified.', 'Continue', true))) return;
      try {
        const saved = await api(e ? `/equipment/${e.id}` : '/equipment', e ? 'PUT' : 'POST', body);
        const file = m.querySelector('#f-photo').files[0];
        let photoError = '';
        try {
          if (file) await uploadPhoto(saved.id, file);
          else if (removePhoto && e) await api(`/equipment/${e.id}/image`, 'DELETE');
        } catch (pe) { photoError = pe.message || 'Photo could not be saved'; }
        close(); toast(photoError ? `Saved, but the photo failed: ${photoError}` : (e ? 'Equipment updated' : 'Equipment created'), !!photoError); refresh();
      } catch (er) {
        if (er.handled) return;   // form stays open with its data (BR-EQ-C-05)
        ['inventoryNumber', 'title', 'category', 'location', 'description'].forEach(k => m.querySelector('#e-' + k).innerHTML = fieldErr(er.fields, k));
        m.querySelector('#e-gen').innerHTML = Object.keys(er.fields).length ? '' : `<div class="alert">${esc(er.message)}</div>`;
      }
    };
  });
}

async function deleteFlow(e, refresh) {
  if (!(await confirmBox('Delete equipment?', `Delete "${e.title}" (${e.inventoryNumber})?`, 'Yes, delete', true))) return;
  if (!(await confirmBox('Are you absolutely sure?', `This permanently removes "${e.title}" together with its bookings and repair requests.`, 'Delete permanently', true))) return;
  try { const r = await api(`/equipment/${e.id}`, 'DELETE'); toast(r?.warning || 'Equipment deleted'); } catch (er) { if (!er.handled) toast(er.message, true); }
  refresh();
}

/* ---------- bookings ---------- */
async function bookings(view) {
  let filter = '';
  const draw = async () => {
    const list = await api('/bookings' + (filter ? `?status=${filter}` : ''));
    const statuses = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'FINISHED', 'REJECTED', 'CANCELED'];
    view.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:start"><div><h1>Bookings</h1><p class="sub">${isAdmin() ? 'Review and manage booking requests.' : 'Track and cancel your bookings. Create new ones from the Equipment page.'}</p></div>
      <select id="flt" style="width:180px"><option value="">All statuses</option>${statuses.map(s => `<option value="${s}" ${filter === s ? 'selected' : ''}>${label(s)}</option>`).join('')}</select></div>
      <div class="card tbl">${list.length ? `<table><thead><tr><th>Equipment</th>${isAdmin() ? '<th>Student</th>' : ''}<th>Time</th><th>Purpose</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(b => `<tr><td><b>${esc(b.equipmentTitle)}</b><br><small>${esc(b.inventoryNumber)} · ${esc(b.location)}</small></td>
        ${isAdmin() ? `<td>${esc(b.studentName)}<br><small>${esc(b.studentEmail)}</small></td>` : ''}
        <td>${fmt(b.start)}–${fmtT(b.end)}</td><td>${esc(b.description)}</td><td>${badge(b.status)}</td>
        <td><div class="acts-cell">${b.canDecide ? `<button class="btn sm primary" data-a="approve" data-id="${b.id}">Approve</button><button class="btn sm danger" data-a="reject" data-id="${b.id}">Reject</button>` : ''}
        ${b.canCancel ? `<button class="btn sm" data-a="cancel" data-id="${b.id}">Cancel</button>` : ''}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty"><b>No bookings</b>Nothing matches this filter.</div>'}</div>`;
    document.getElementById('flt').onchange = e => { filter = e.target.value; draw(); };
    view.querySelectorAll('[data-a]').forEach(btn => btn.onclick = async () => {
      const a = btn.dataset.a;
      if (a === 'cancel' && !(await confirmBox('Cancel booking?', 'The time slot will be released.', 'Cancel booking', true))) return;
      try { await api(`/bookings/${btn.dataset.id}/${a}`, 'POST'); toast({ approve: 'Booking confirmed', reject: 'Booking rejected', cancel: 'Booking canceled' }[a]); }
      catch (er) { if (!er.handled) toast(er.message, true); }
      draw();
    });
  };
  await draw(); timers.push(setInterval(() => { if (!document.querySelector('.ov')) draw().catch(() => { }); }, 15000));
}

/* ---------- repair requests ---------- */
const STAGE = { AWAITING_REVIEW: 'Awaiting review', IN_REPAIR: 'In repair', RESOLVED: 'Resolved', NO_REPAIR_REQUIRED: 'No repair required' };
async function repairs(view) {
  const draw = async () => {
    const list = await api('/repairs');
    const AI_HELP = {
      EQUIPMENT_NOT_FOUND: 'This equipment ID is not in the AI service catalog, so no documentation could be used. Ask the AI service owner to add it, or fix the inventory number.',
      UNAUTHORIZED: 'The backend key does not match the AI service key (AiService:ServiceKey vs LEMS_SERVICE_API_KEY).',
      SERVICE_NOT_CONFIGURED: 'The service key is not configured (backend AiService:ServiceKey or AI service LEMS_SERVICE_API_KEY).',
      MODEL_UNAVAILABLE: 'The language model did not answer (quota, timeout or invalid reply). Try again later.',
      CATALOG_UNAVAILABLE: 'The AI service cannot reach its database. Check its console.',
      RETRIEVAL_UNAVAILABLE: 'The AI service search model is not prepared. Check its console.',
      NOT_READY: 'The AI service is not ready. Check its console and /ready.',
      VALIDATION_ERROR: 'The AI service rejected the input.',
      AI_UNREACHABLE: 'The AI service is not running or the address (AiService:BaseUrl) is wrong.',
      AI_TIMEOUT: 'The AI service took too long to answer.'
    };
    const ul = (title, a) => a?.length ? `<div style="margin-top:6px"><b>${title}</b></div><ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    const aiBox = r => {
      if (!isAdmin()) return '';
      const again = `<div style="margin-top:6px"><button class="btn sm" data-a="analyze" data-id="${r.id}">Run AI analysis again</button></div>`;
      if (!r.ai) return `<div class="ai pending">AI analysis is being generated (can take up to a minute)...${again}</div>`;
      if (!r.ai.ok) return `<div class="ai pending"><b>AI analysis unavailable</b> (${esc(r.ai.code)})<div>${esc(AI_HELP[r.ai.code] || r.ai.message || '')}</div>${again}</div>`;
      const p = r.ai.report || {};
      const src = (p.documentation_sources || []).map(x => {
        const label = esc(x.title || x.section || x.url);
        const link = /^https?:\/\//i.test(x.url || '') ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
        return `<li>${x.source_id ? `[${esc(x.source_id)}] ` : ''}${link}${x.page ? ` (p. ${esc(x.page)})` : ''}</li>`;
      }).join('');
      return `<div class="ai"><b>AI preliminary report</b> <small>(requires technician review)</small>
        ${ul('Symptoms', p.symptoms)}${ul('Possible causes', p.possible_causes)}${ul('Recommended checks', p.recommended_checks)}${ul('Missing information', p.missing_information)}
        ${src ? `<div style="margin-top:6px"><b>Documentation sources</b></div><ul>${src}</ul>` : '<div style="margin-top:6px"><small>No documentation sources were cited - the report is based on general knowledge.</small></div>'}${again}</div>`;
    };
    const actions = r => {
      if (!isAdmin() || r.status === 'CLOSED') return '';
      return r.confirmed
        ? `<button class="btn primary sm" data-a="complete" data-w="true" data-id="${r.id}">Repair checked - equipment works</button><button class="btn sm" data-a="complete" data-w="false" data-id="${r.id}">Checked - still not working</button>`
        : `<button class="btn primary sm" data-a="confirm" data-id="${r.id}">Confirm problem</button><button class="btn sm" data-a="dismiss" data-id="${r.id}">Not confirmed - close</button>`;
    };
    view.innerHTML = `<h1>Repair Requests</h1><p class="sub">${isAdmin() ? 'Review reported problems and track repairs.' : 'Problems you reported. Use "Report Issue" on the Equipment page to create one.'}</p>
      ${list.length ? list.map(r => `<div class="card rep"><div class="head"><div><b>${esc(r.title)}</b><div class="sub" style="margin:0">${esc(r.equipmentTitle)} (${esc(r.inventoryNumber)}) · ${esc(r.location)}${isAdmin() ? ` · by ${esc(r.reporter)}` : ''} · ${fmt(r.createdAt)}</div></div>
        <div>${badge(r.stage)}</div></div>
        <p>${esc(r.description)}</p>${aiBox(r)}<div class="acts">${actions(r)}</div></div>`).join('') : '<div class="card empty"><b>No repair requests</b>Reported problems appear here.</div>'}`;
    view.querySelectorAll('[data-a]').forEach(btn => btn.onclick = async () => {
      const a = btn.dataset.a;
      if (a === 'confirm' && !(await confirmBox('Confirm problem?', 'Equipment goes to MAINTENANCE and all pending/confirmed bookings are canceled.', 'Confirm', true))) return;
      try {
        const res = await api(`/repairs/${btn.dataset.id}/${a}`, 'POST', a === 'complete' ? { working: btn.dataset.w === 'true' } : undefined);
        toast(a === 'analyze' ? 'AI analysis started - this can take up to a minute' : a === 'complete' && res.repeated ? 'Repair cycle continues' : 'Request updated');
      } catch (er) { if (!er.handled) toast(er.message, true); }
      draw();
    });
  };
  await draw(); timers.push(setInterval(() => { if (!document.querySelector('.ov')) draw().catch(() => { }); }, 15000));
}

route();
