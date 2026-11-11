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



/* ---------- small date helpers + view state ---------- */
const hh = h => pad(h);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const fmtDay = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + fmtT(d);
const BOOK_AHEAD_DAYS = 60;
let sched = { date: ymd(new Date()), all: false }, dashBk = 'all', invState = { q: '', category: '', status: '', page: 1 };

/* ---------- auth screens ---------- */
function showAuth(mode, errors = {}, msg = '', vals = {}) {
  clearTimers();
  const reg = mode === 'register';
  const prow = (name, cells) => `<div class="pr"><span>${name}</span>${[...cells].map(c => `<i class="${c === 'x' ? 't' : c === 'm' ? 'm' : ''}"></i>`).join('')}</div>`;
  $app.innerHTML = `<div class="auth"><section class="hero"><img class="hero-logo" src="wordmark.svg?v=5" alt="LEMS">
      <h1>Laboratory Equipment<br>Management System</h1>
      <p>Reserve laboratory equipment, follow every decision and report faults - all in one place.</p>
      <ul><li>Book equipment in one-hour slots</li><li>Get notified about approvals and changes</li><li>Report problems with AI-assisted triage for technicians</li></ul>
      <div class="preview" aria-hidden="true">${prow('Oscilloscope', '..xx....')}${prow('3D printer', 'xx..x...')}${prow('Centrifuge', 'mmmmmmmm')}</div></section>
    <section class="formwrap"><div class="card">
    <h2>${reg ? 'Create student account' : 'Welcome back'}</h2>
    <div class="lead">${reg ? 'Use your university e-mail address.' : 'Log in to book and manage laboratory equipment.'}</div>
    <label for="email">Email</label><input id="email" type="email" autocomplete="username" value="${esc(vals.email)}" placeholder="${reg ? 'name.surname@student.tuke.sk' : 'you@example.com'}">${fieldErr(errors, 'email')}
    <label for="pw">Password</label><input id="pw" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}">${fieldErr(errors, 'password')}
    ${reg ? `<label for="pw2">Confirm password</label><input id="pw2" type="password" autocomplete="new-password">${fieldErr(errors, 'confirmPassword')}` : ''}
    ${msg ? `<div class="alert">${esc(msg)}</div>` : ''}
    <button class="btn primary" id="go">${reg ? 'Create Account' : 'Log In'}</button>
    <div class="alt">${reg ? 'Have an account? <a id="sw">Log in</a>' : 'New student? <a id="sw">Create an account</a>'}</div>
  </div></section></div>`;
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
  dashboard: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  equipment: svg('<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  bookings: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  report: svg('<path d="M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  repairs: svg('<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>'),
  inventory: svg('<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8M10 12h4"/>'),
  students: svg('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>'),
  bell: svg('<path d="M6 9a6 6 0 0112 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 004 0"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  left: svg('<path d="M15 18l-6-6 6-6"/>'),
  right: svg('<path d="M9 18l6-6-6-6"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  pulse: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M8 14h2M14 14h2M8 17.5h2"/>'),
  notifications: svg('<path d="M6 9a6 6 0 0112 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 004 0"/>'),
  profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),
  reports: svg('<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V7M18 17v-8"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 2.5-3 4M12 17h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>')
};
const NAV = () => isAdmin()
  ? [['Main', [['dashboard', 'Dashboard'], ['equipment', 'Equipment'], ['calendar', 'Calendar'], ['bookings', 'Bookings']]],
     ['Admin', [['inventory', 'Inventory'], ['repairs', 'Repair Requests'], ['students', 'Students'], ['reports', 'Reports']]],
     ['Account', [['notifications', 'Notifications'], ['profile', 'Profile']]]]
  : [['Main', [['dashboard', 'Dashboard'], ['equipment', 'Equipment'], ['calendar', 'Calendar'], ['bookings', 'My Bookings'], ['repairs', 'Report Issue']]],
     ['Account', [['notifications', 'Notifications'], ['profile', 'Profile'], ['help', 'Rules & Help']]]];
const NAV_ICON = { repairs: () => isAdmin() ? ICON.repairs : ICON.report };

function shell(page) {
  const ini = (user.name[0] + user.surname[0]).toUpperCase();
  const role = isAdmin() ? 'Administrator' : 'Student';
  const link = ([k, t]) => `<a href="#/${k}" class="${k === page ? 'active' : ''}">${(NAV_ICON[k] ? NAV_ICON[k]() : ICON[k])}<span>${esc(t)}</span></a>`;
  $app.innerHTML = `<div class="shell">
    <aside class="side" id="side">
      <a class="brand" href="#/dashboard"><img class="logo" src="logo.svg?v=5" alt=""><b>LEMS<i>.</i></b></a>
      <nav class="nav">${NAV().map(([h, items]) => `<div class="nav-h">${h}</div>${items.map(link).join('')}`).join('')}</nav>
      <div class="side-user"><button class="acct" id="acct" aria-label="Account menu"><span class="avatar">${esc(ini)}</span><span class="who"><b>${esc(user.name)} ${esc(user.surname)}</b><span class="role">${role}</span></span></button>
        <div class="drop up" id="menu" hidden><div class="it"><small>Signed in as</small><br><b>${esc(user.email)}</b><br><small>${role}</small></div>
        <div class="it"><button class="btn" id="logout" style="width:100%">Log out</button></div></div></div>
    </aside>
    <div class="main">
      <header class="top">
        <button class="burger" id="burger" aria-label="Open menu">${ICON.menu}</button>
        <div class="search">${ICON.search}<input id="gs" type="search" placeholder="Search equipment…" aria-label="Search equipment"></div>
        <div class="grow"></div>
        <div class="rel"><button class="btn icon bell" id="bell" aria-label="Notifications">${ICON.bell}<span class="badge-n" id="nbadge" hidden>0</span></button><div class="drop notes" id="notes" hidden></div></div>
        <button class="btn primary" id="top-act">${ICON.plus}<span class="lbl">${isAdmin() ? 'Add Equipment' : 'New Booking'}</span></button>
      </header>
      <main class="content" id="view" tabindex="-1"></main>
    </div></div>`;
  const notes = document.getElementById('notes'), menu = document.getElementById('menu'), side = document.getElementById('side');
  document.getElementById('burger').onclick = e => { e.stopPropagation(); side.classList.toggle('open'); };
  side.onclick = e => { if (e.target.closest('a')) side.classList.remove('open'); };
  document.getElementById('bell').onclick = async e => { e.stopPropagation(); menu.hidden = true; notes.hidden = !notes.hidden; if (!notes.hidden) { await loadNotes(true); } };
  document.getElementById('acct').onclick = e => { e.stopPropagation(); notes.hidden = true; menu.hidden = !menu.hidden; };
  document.onclick = () => { notes.hidden = true; menu.hidden = true; side.classList.remove('open'); };
  notes.onclick = e => e.stopPropagation(); menu.onclick = e => e.stopPropagation();
  document.getElementById('logout').onclick = async () => { await api('/auth/logout', 'POST'); user = null; showAuth('login'); };
  document.getElementById('top-act').onclick = () => isAdmin() ? equipmentForm(null, route) : newBookingModal(route);
  document.getElementById('gs').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    eqState.q = e.target.value.trim(); eqState.page = 1; eqState.status = '';
    if (location.hash === '#/equipment') route(); else location.hash = '#/equipment';
  });
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
    document.getElementById('notes').insertAdjacentHTML('beforeend', '<div class="it"><a href="#/notifications">View all notifications</a></div>');
    if (markRead && d.unread) { await api('/notifications/read-all', 'POST'); b.hidden = true; }
  } catch { }
}



/* ---------- router ---------- */
const ADMIN_ONLY = ['inventory', 'students', 'reports'], STUDENT_ONLY = ['help'];
async function route() {
  if (!user) { try { user = await api('/auth/me'); } catch { if (!$app.querySelector('.auth')) showAuth('login'); return; } }
  const pages = { dashboard, equipment, calendar, bookings, repairs, inventory, students, reports, notifications, profile, help };
  let page = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  if (!pages[page] || (ADMIN_ONLY.includes(page) && !isAdmin()) || (STUDENT_ONLY.includes(page) && isAdmin())) page = 'dashboard';
  clearTimers(); shell(page);
  const view = document.getElementById('view');
  view.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  await pages[page](view);
}
window.addEventListener('hashchange', route);

const loadFailed = view => { if (view.querySelector('.skeleton')) view.innerHTML = '<div class="card empty"><b>Could not load data</b>Check your connection and try again.</div>'; };

/* ---------- dashboard ---------- */
async function dashboard(view) {
  const draw = async () => {
    let d, sc, bk = [], rp = [];
    try {
      [d, sc, bk] = await Promise.all([api('/dashboard'), api('/schedule?date=' + sched.date), api('/bookings')]);
      if (isAdmin()) rp = await api('/repairs');
    } catch (e) { if (!e.handled) loadFailed(view); return; }

    const rows = sc.equipment, hours = rows[0]?.slots.map(s => s.hour) ?? [];
    const eq = d.equipment, pct = eq.total ? Math.round(eq.available * 100 / eq.total) : 0;
    const bookedSlots = rows.reduce((n, r) => n + r.slots.filter(s => s.state === 'taken' || s.state === 'mine').length, 0);
    const today = ymd(new Date()), last = addDays(today, sc.maxDaysAhead ?? BOOK_AHEAD_DAYS);
    const stat = (title, n, sub, cls, ico) => `<div class="card stat ${cls}"><div class="top-row"><span class="l">${title}</span><span class="chip">${ico}</span></div><div class="n">${n}</div><div class="d ${cls}">${sub}</div></div>`;

    /* schedule: first 5 pieces of equipment, the rest behind a button */
    const shown = sched.all ? rows : rows.slice(0, 5);
    const cell = (r, s) => {
      const t = `${fmtT(s.start)}-${fmtT(s.end)}`;
      if (s.state === 'free') return !isAdmin()
        ? `<button type="button" class="cell free go" data-eq="${r.id}" data-start="${esc(s.start)}" title="${t} free - click to book">FREE</button>`
        : `<span class="cell free" title="${t} free">FREE</span>`;
      if (s.state === 'taken') return `<span class="cell taken" title="${t} booked">BOOKED</span>`;
      if (s.state === 'mine') return `<span class="cell mine" title="${t} your booking">YOURS</span>`;
      if (s.state === 'maintenance') return `<span class="cell maint" title="Under maintenance">-</span>`;
      return `<span class="cell past" title="${t} already started">-</span>`;
    };
    const schedule = rows.length ? `<div class="sched-scroll"><div class="sched">
        <div class="row head" style="--cols:${hours.length}"><span>Equipment</span>${hours.map(h => `<span>${hh(h)}</span>`).join('')}</div>
        ${shown.map(r => `<div class="row ${r.status === 'MAINTENANCE' ? 'maint' : ''}" style="--cols:${hours.length}">
          <div class="eqcell"><span class="ic">${ICON.equipment}</span><div style="min-width:0"><b>${esc(r.title)}${r.status === 'MAINTENANCE' ? '<span class="tagm">Maintenance</span>' : ''}</b><small>${esc(r.inventoryNumber)} · ${esc(r.location)}</small></div></div>
          ${r.slots.map(s => cell(r, s)).join('')}</div>`).join('')}
      </div></div>
      <div class="sched-foot"><span>Showing ${shown.length} of ${rows.length} equipment</span>${rows.length > 5 ? `<button class="btn sm" id="sched-all">${sched.all ? 'Show first 5' : `Show all ${rows.length}`}</button>` : ''}</div>`
      : '<div class="empty"><b>No equipment yet</b>Equipment added by an administrator appears here.</div>';

    /* tables */
    const tbl = (cols, body, empty) => body ? `<div class="tbl"><table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty"><b>${empty[0]}</b>${empty[1]}</div>`;
    const eqTd = (t, inv, extra) => `<td><span class="nm">${esc(t)}</span><small>${esc(inv)}${extra ? ' · ' + esc(extra) : ''}</small></td>`;
    const now = Date.now();
    let bookingsCard;
    if (isAdmin()) {
      const active = b => b.status === 'CONFIRMED' || b.status === 'IN_PROGRESS';
      const list = bk.filter(b => dashBk === 'all' || (dashBk === 'pending' ? b.status === 'PENDING' : active(b)))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
      bookingsCard = `<div class="card sect"><div class="card-h">${ICON.list}<div class="ttl"><h2>Recent Bookings</h2><small>Latest equipment reservations across the lab.</small></div>
        <div class="right"><div class="pills">${[['all', 'All'], ['active', 'Active'], ['pending', 'Pending']].map(([k, t]) => `<button class="pill ${dashBk === k ? 'active' : ''}" data-bk="${k}">${t}</button>`).join('')}</div><a class="btn sm" href="#/bookings">View all</a></div></div>
        ${tbl(['Equipment', 'Student', 'Date', 'Status'], list.map(b => `<tr>${eqTd(b.equipmentTitle, b.inventoryNumber)}<td>${esc(b.studentName)}</td><td>${fmtShort(b.start)}</td><td>${badge(b.status)}</td></tr>`).join(''), ['No bookings', 'Nothing matches this filter.'])}</div>`;
    } else {
      const up = bk.filter(b => ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(b.status) && new Date(b.end) > now).sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 5);
      bookingsCard = `<div class="card sect"><div class="card-h">${ICON.list}<div class="ttl"><h2>My upcoming bookings</h2><small>Your next reservations and their status.</small></div><div class="right"><a class="btn sm" href="#/bookings">View all</a></div></div>
        ${tbl(['Equipment', 'Date', 'Status'], up.map(b => `<tr>${eqTd(b.equipmentTitle, b.inventoryNumber, b.location)}<td>${fmtShort(b.start)}</td><td>${badge(b.status)}</td></tr>`).join(''), ['Nothing booked', 'Click a free slot in the schedule above to reserve equipment.'])}</div>`;
    }
    const repairsCard = isAdmin() ? `<div class="card sect"><div class="card-h">${ICON.repairs}<div class="ttl"><h2>Recent Repair Requests</h2><small>Problems reported by students.</small></div><div class="right"><a class="btn sm" href="#/repairs">View all</a></div></div>
        ${tbl(['Equipment', 'Student', 'Date', 'Status'], [...rp].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6).map(r => `<tr><td><span class="nm">${esc(r.equipmentTitle)}</span><small>${esc(r.title)}</small></td><td>${esc(r.reporter)}</td><td>${fmtShort(r.createdAt)}</td><td>${badge(r.stage)}</td></tr>`).join(''), ['No repair requests', 'Reported problems appear here.'])}</div>` : '';
    const feedCard = `<div class="card sect"><div class="card-h">${ICON.pulse}<div class="ttl"><h2>Activity feed</h2><small>Changes to equipment and reservations.</small></div></div>
        ${d.feed.length ? d.feed.slice(0, 8).map(e => `<div class="ev">${esc(e.message)}<small>${fmt(e.createdAt)}</small></div>`).join('') : '<div class="empty" style="border-top:1px solid var(--border)"><b>No activity yet</b>Changes to equipment and reservations appear here.</div>'}</div>`;

    view.innerHTML = `<div class="page-head"><div><h1>Equipment Availability</h1><p class="sub">${fmtDay(sc.date)} · ${hh(sc.openHour)}:00 – ${hh(sc.closeHour)}:00</p></div>
        <div class="datenav"><button class="btn icon" id="d-prev" aria-label="Previous day" ${sched.date <= today ? 'disabled' : ''}>${ICON.left}</button><button class="btn" id="d-today">${ICON.bookings}Today</button><button class="btn icon" id="d-next" aria-label="Next day" ${sched.date >= last ? 'disabled' : ''}>${ICON.right}</button></div></div>
      <div class="grid g4">
        ${stat('Total Equipment', eq.total, 'registered in the lab', '', ICON.equipment)}
        ${stat('Available Now', eq.available, `${pct}% of total`, 'ok', ICON.check)}
        ${stat('In Use Now', eq.reserved, `${bookedSlots} slot${bookedSlots === 1 ? '' : 's'} booked on this date`, 'warn', ICON.clock)}
        ${stat('Under Maintenance', eq.maintenance, d.admin ? `${d.admin.repairsOpen} open repair request${d.admin.repairsOpen === 1 ? '' : 's'}` : 'cannot be booked', 'bad', ICON.repairs)}
      </div>
      <div class="card sect"><div class="card-h">${ICON.bookings}<div class="ttl"><h2>Equipment Schedule</h2><small>${isAdmin() ? 'Hourly availability of all equipment.' : 'Click a free slot to reserve it.'}</small></div>
        <div class="right legend"><span><i class="l-free"></i>Free</span><span><i class="l-taken"></i>Unavailable</span>${isAdmin() ? '' : '<span><i class="l-mine"></i>Yours</span>'}<span><i class="l-maint"></i>Maintenance</span></div></div>${schedule}</div>
      ${bookingsCard}${repairsCard}${feedCard}`;

    const go = date => { sched.date = date; draw(); };
    document.getElementById('d-prev').onclick = () => go(addDays(sched.date, -1));
    document.getElementById('d-next').onclick = () => go(addDays(sched.date, 1));
    document.getElementById('d-today').onclick = () => go(today);
    document.getElementById('sched-all')?.addEventListener('click', () => { sched.all = !sched.all; draw(); });
    view.querySelectorAll('[data-bk]').forEach(b => b.onclick = () => { dashBk = b.dataset.bk; draw(); });
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    view.querySelectorAll('.cell.go').forEach(b => b.onclick = () => bookModal(byId[b.dataset.eq], draw, { start: b.dataset.start }));
  };
  await draw(); timers.push(setInterval(() => { if (!document.querySelector('.ov')) draw().catch(() => { }); }, 15000));
}



/* ---------- equipment ---------- */
const statusOptions = sel => [['AVAILABLE', 'Available'], ['RESERVED', 'Reserved'], ['MAINTENANCE', 'Maintenance']].map(([v, t]) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${t}</option>`).join('');

async function equipment(view) {
  const draw = async () => {
    const p = new URLSearchParams({ q: eqState.q, category: eqState.category, status: eqState.status, sort: eqState.sort, page: eqState.page, pageSize: 9 });
    let d; try { d = await api('/equipment?' + p); } catch (e) { if (!e.handled) loadFailed(view); return; }
    const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
    const tab = (k, t, n) => `<button class="tab ${eqState.status === k ? 'active' : ''}" data-tab="${k}">${t}<span>${n}</span></button>`;
    view.innerHTML = `<div class="page-head"><div><h1>Equipment</h1><p class="sub">Browse laboratory equipment${isAdmin() ? ' and manage the inventory' : ', book it and report problems'}.</p></div></div>
      <div class="toolbar"><div class="search">${ICON.search}<input id="q" placeholder="Search by name or inventory number" value="${esc(eqState.q)}"></div>
        <select id="stat"><option value="">All statuses</option>${statusOptions(eqState.status)}</select>
        <select id="cat"><option value="">All categories</option>${d.categories.map(c => `<option ${c === eqState.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="sort">${[['name', 'Sort: Name'], ['inventory', 'Sort: Inventory no.'], ['status', 'Sort: Status'], ['newest', 'Sort: Newest']].map(([v, t]) => `<option value="${v}" ${eqState.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="tabs">${tab('', 'All Equipment', d.counts.all)}${tab('AVAILABLE', 'Available', d.counts.available)}${tab('RESERVED', 'Reserved', d.counts.reserved)}${tab('MAINTENANCE', 'Maintenance', d.counts.maintenance)}</div>
      ${d.items.length ? `<div class="grid g3">${d.items.map(card).join('')}</div>` : '<div class="card empty"><b>No equipment found</b>Try another search or filter.</div>'}
      <div class="pager"><span>Showing ${d.items.length} of ${d.total} items</span><div>
        <button class="btn sm" id="prev" ${eqState.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${d.page} / ${pages}</span>
        <button class="btn sm" id="next" ${eqState.page >= pages ? 'disabled' : ''}>Next ›</button></div></div>`;
    let t; const q = document.getElementById('q');
    q.oninput = () => { clearTimeout(t); t = setTimeout(async () => { eqState.q = q.value; eqState.page = 1; await draw(); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); };
    document.getElementById('cat').onchange = e => { eqState.category = e.target.value; eqState.page = 1; draw(); };
    document.getElementById('stat').onchange = e => { eqState.status = e.target.value; eqState.page = 1; draw(); };
    document.getElementById('sort').onchange = e => { eqState.sort = e.target.value; draw(); };
    view.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { eqState.status = b.dataset.tab; eqState.page = 1; draw(); });
    document.getElementById('prev').onclick = () => { eqState.page--; draw(); };
    document.getElementById('next').onclick = () => { eqState.page++; draw(); };
    const byId = Object.fromEntries(d.items.map(e => [e.id, e]));
    view.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const e = byId[b.dataset.id];
      ({ info: () => infoModal(e, draw), book: () => bookModal(e, draw), report: () => reportModal(e), edit: () => equipmentForm(e, draw), del: () => deleteFlow(e, draw) })[b.dataset.act]();
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
    <div class="meta">Inv. No.: ${esc(e.inventoryNumber)}</div><div class="meta">${esc(e.location)} · ${esc(e.category)}</div>
    <div class="row">${badge(e.status)}<span class="grow"></span><button class="btn icon sm" data-act="info" data-id="${e.id}" aria-label="Details of ${esc(e.title)}" title="Details">${ICON.info}</button></div><div class="acts">${acts}</div></div>`;
}

/* opts.start: ISO start of a slot to pre-select (used by the dashboard schedule) */
async function bookModal(e, refresh, opts = {}) {
  let sel = null, pre = opts.start || null; const today = new Date();
  modal(`<h2>Book ${esc(e.title)}</h2><p class="sub" style="margin-bottom:0">${esc(e.inventoryNumber)} · ${esc(e.location)}${e.status === 'RESERVED' ? ' · currently in use, pick a free slot for another time' : ''}</p>
    <label>Date</label><input type="date" id="bd" value="${pre ? pre.slice(0, 10) : ymd(today)}" min="${ymd(today)}">
    <label>Available one-hour slots</label><div class="slots" id="slots"></div><div id="e-start"></div>
    <label>Purpose</label><textarea id="bdesc" rows="3" maxlength="500" placeholder="What will you use the equipment for?"></textarea><div id="e-desc"></div><div id="e-gen"></div>
    <div class="foot"><button class="btn" id="cx">Cancel</button><button class="btn primary" id="ok">Submit request</button></div>`, (m, close) => {
    const loadSlots = async () => {
      sel = null;
      const dateEl = m.querySelector('#bd');
      let d = await api(`/equipment/${e.id}/slots?date=${dateEl.value}`);
      // every slot of today already started -> continue with tomorrow
      if (!pre && d.slots.length && d.slots.every(s => s.state === 'past')) {
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
      if (pre) { m.querySelector(`.slot[data-s="${pre}"]:not(:disabled)`)?.click(); pre = null; }
    };
    m.querySelector('#bd').onchange = () => { pre = null; loadSlots(); }; loadSlots();
    m.querySelector('#cx').onclick = close;
    m.querySelector('#ok').onclick = async () => {
      m.querySelectorAll('.err').forEach(x => x.remove());
      try {
        await api('/bookings', 'POST', { equipmentId: e.id, start: sel, description: m.querySelector('#bdesc').value });
        close(); toast('Booking request sent - waiting for administrator'); refresh?.();
      } catch (er) {
        if (er.handled) return;
        m.querySelector('#e-start').innerHTML = fieldErr(er.fields, 'start'); m.querySelector('#e-desc').innerHTML = fieldErr(er.fields, 'description');
        if (!Object.keys(er.fields).length) m.querySelector('#e-gen').innerHTML = `<div class="alert">${esc(er.message)}</div>`;
        if (er.status === 409) loadSlots();
      }
    };
  });
}

/* top-bar "New Booking": pick the equipment first, then continue in the normal booking dialog */
async function newBookingModal(refresh) {
  let items;
  try { items = (await api('/equipment?pageSize=60&sort=name')).items; } catch { return; }
  const free = items.filter(i => i.status !== 'MAINTENANCE');
  if (!free.length) { toast('No equipment is available for booking right now', true); return; }
  modal(`<h2>New booking</h2><p class="sub">Choose the equipment you want to reserve.</p>
    <label for="nb">Equipment</label><select id="nb">${free.map(i => `<option value="${i.id}">${esc(i.title)} (${esc(i.inventoryNumber)})</option>`).join('')}</select>
    <div class="foot"><button class="btn" id="cx">Cancel</button><button class="btn primary" id="ok">Continue</button></div>`, (m, close) => {
    m.querySelector('#cx').onclick = close;
    m.querySelector('#ok').onclick = () => { const e = free.find(i => String(i.id) === m.querySelector('#nb').value); close(); if (e) bookModal(e, refresh); };
  });
}

/* e = equipment to report on, or null to let the student choose it in the dialog */
async function reportModal(e, refresh) {
  let items = [];
  if (!e) { try { items = (await api('/equipment?pageSize=60&sort=name')).items; } catch { return; } if (!items.length) { toast('There is no equipment to report on yet', true); return; } }
  modal(`<h2>Report a problem</h2>${e ? `<p class="sub" style="margin-bottom:0">${esc(e.title)} (${esc(e.inventoryNumber)})</p>`
      : `<label for="re">Equipment</label><select id="re">${items.map(i => `<option value="${i.id}">${esc(i.title)} (${esc(i.inventoryNumber)})</option>`).join('')}</select>`}
    <label>Title</label><input id="rt" maxlength="50" placeholder="Short summary"><div id="e-title"></div>
    <label>Description (please write in English - the AI assistant works in English)</label><textarea id="rd" rows="5" maxlength="500" placeholder="Describe what is wrong"></textarea><div id="e-desc"></div>
    <div class="foot"><button class="btn" id="cx">Cancel</button><button class="btn primary" id="ok">Submit report</button></div>`, (m, close) => {
    m.querySelector('#cx').onclick = close;
    m.querySelector('#ok').onclick = async () => {
      try {
        await api('/repairs', 'POST', { equipmentId: e ? e.id : Number(m.querySelector('#re').value), title: m.querySelector('#rt').value, description: m.querySelector('#rd').value });
        close(); toast('Problem report submitted'); refresh?.();
      } catch (er) {
        if (er.handled) return;
        m.querySelector('#e-title').innerHTML = fieldErr(er.fields, 'title'); m.querySelector('#e-desc').innerHTML = fieldErr(er.fields, 'description');
      }
    };
  });
}


function equipmentForm(e, refresh) {
  const v = e || { inventoryNumber: '', title: '', description: '', location: '', category: '', status: 'AVAILABLE', specifications: '', contactName: '', contactEmail: '' };
  const f = (id, lbl, val, max) => `<label>${lbl}</label><input id="f-${id}" maxlength="${max}" value="${esc(val)}"><div id="e-${id}"></div>`;
  modal(`<h2>${e ? 'Edit equipment' : 'Add equipment'}</h2>
    ${f('inventoryNumber', 'Inventory number', v.inventoryNumber, 10)}${f('title', 'Title', v.title, 25)}${f('category', 'Category', v.category, 30)}${f('location', 'Location', v.location, 20)}
    <label>Description</label><textarea id="f-description" rows="3" maxlength="250">${esc(v.description)}</textarea><div id="e-description"></div>
    <label>Specifications (optional)</label><textarea id="f-specifications" rows="4" maxlength="1000" placeholder="One per line, e.g. Power: 230 V">${esc(v.specifications)}</textarea><div id="e-specifications"></div>
    ${f('contactName', 'Responsible person (optional)', v.contactName, 50)}${f('contactEmail', 'Contact e-mail (optional)', v.contactEmail, 100)}
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
      const body = { inventoryNumber: g('inventoryNumber'), title: g('title'), category: g('category'), location: g('location'), description: g('description'), specifications: g('specifications'), contactName: g('contactName'), contactEmail: g('contactEmail'), status: g('status') ?? v.status };
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
        ['inventoryNumber', 'title', 'category', 'location', 'description', 'specifications', 'contactName', 'contactEmail'].forEach(k => m.querySelector('#e-' + k).innerHTML = fieldErr(er.fields, k));
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



/* ---------- inventory (admin): dense table with the same create / edit / delete flows ---------- */
async function inventory(view) {
  const draw = async () => {
    const p = new URLSearchParams({ q: invState.q, category: invState.category, status: invState.status, sort: 'inventory', page: invState.page, pageSize: 12 });
    let d; try { d = await api('/equipment?' + p); } catch (e) { if (!e.handled) loadFailed(view); return; }
    const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
    view.innerHTML = `<div class="page-head"><div><h1>Inventory</h1><p class="sub">All laboratory equipment with its inventory number, location and status.</p></div></div>
      <div class="toolbar"><div class="search">${ICON.search}<input id="q" placeholder="Search by name or inventory number" value="${esc(invState.q)}"></div>
        <select id="stat"><option value="">All statuses</option>${statusOptions(invState.status)}</select>
        <select id="cat"><option value="">All categories</option>${d.categories.map(c => `<option ${c === invState.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="card tbl">${d.items.length ? `<table><thead><tr><th>Equipment</th><th>Inventory no.</th><th>Category</th><th>Location</th><th>Status</th><th></th></tr></thead><tbody>
        ${d.items.map(e => `<tr><td><div class="cellflex"><div class="thumb-s">${thumb(e)}</div><span class="nm">${esc(e.title)}</span></div></td><td>${esc(e.inventoryNumber)}</td><td>${esc(e.category)}</td><td>${esc(e.location)}</td><td>${badge(e.status)}</td>
          <td><div class="acts-cell"><button class="btn sm" data-act="edit" data-id="${e.id}">Edit</button><button class="btn sm danger" data-act="del" data-id="${e.id}">Remove</button></div></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><b>No equipment found</b>Try another search or filter.</div>'}</div>
      <div class="pager"><span>Showing ${d.items.length} of ${d.total} items</span><div>
        <button class="btn sm" id="prev" ${invState.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${d.page} / ${pages}</span>
        <button class="btn sm" id="next" ${invState.page >= pages ? 'disabled' : ''}>Next ›</button></div></div>`;
    let t; const q = document.getElementById('q');
    q.oninput = () => { clearTimeout(t); t = setTimeout(async () => { invState.q = q.value; invState.page = 1; await draw(); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); };
    document.getElementById('cat').onchange = e => { invState.category = e.target.value; invState.page = 1; draw(); };
    document.getElementById('stat').onchange = e => { invState.status = e.target.value; invState.page = 1; draw(); };
    document.getElementById('prev').onclick = () => { invState.page--; draw(); };
    document.getElementById('next').onclick = () => { invState.page++; draw(); };
    const byId = Object.fromEntries(d.items.map(e => [e.id, e]));
    view.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const e = byId[b.dataset.id];
      ({ edit: () => equipmentForm(e, draw), del: () => deleteFlow(e, draw) })[b.dataset.act]();
    });
  };
  await draw();
  timers.push(setInterval(() => { if (!document.querySelector('.ov') && document.activeElement?.id !== 'q') draw().catch(() => { }); }, 15000));
}

/* ---------- students (admin) ---------- */
async function students(view) {
  let list;
  try { list = await api('/students'); } catch (e) { if (!e.handled) loadFailed(view); return; }
  view.innerHTML = `<div class="page-head"><div><h1>Students</h1><p class="sub">${list.length} registered student${list.length === 1 ? '' : 's'} and their activity.</p></div></div>
    <div class="toolbar"><div class="search">${ICON.search}<input id="sq" placeholder="Search by name or e-mail"></div></div><div class="card tbl people" id="stbl"></div>`;
  const render = () => {
    const f = document.getElementById('sq').value.trim().toLowerCase();
    const rows = list.filter(s => !f || `${s.name} ${s.surname} ${s.email}`.toLowerCase().includes(f));
    document.getElementById('stbl').innerHTML = rows.length
      ? `<table><thead><tr><th>Student</th><th>E-mail</th><th>Registered</th><th>Bookings</th><th>Active</th><th>Reports</th></tr></thead><tbody>
        ${rows.map(s => `<tr><td><div class="cellflex"><span class="avatar">${esc((s.name[0] || '') + (s.surname[0] || ''))}</span><span class="nm">${esc(s.name)} ${esc(s.surname)}</span></div></td><td>${esc(s.email)}</td>
          <td>${new Date(s.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td><td>${s.bookings}</td><td>${s.activeBookings ? `<span class="badge b-confirmed">${s.activeBookings} active</span>` : '0'}</td><td>${s.repairs}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty"><b>No students found</b>Try another search.</div>';
  };
  document.getElementById('sq').oninput = render; render();
}

/* approve / reject / cancel a booking (used by the bookings page and the calendar) */
async function bookingAction(a, id) {
  if (a === 'cancel' && !(await confirmBox('Cancel booking?', 'The time slot will be released.', 'Cancel booking', true))) return false;
  try { await api(`/bookings/${id}/${a}`, 'POST'); toast({ approve: 'Booking confirmed', reject: 'Booking rejected', cancel: 'Booking canceled' }[a]); }
  catch (er) { if (!er.handled) toast(er.message, true); }
  return true;
}

/* ---------- bookings ---------- */
async function bookings(view) {
  let filter = '';
  const draw = async () => {
    let list; try { list = await api('/bookings' + (filter ? `?status=${filter}` : '')); } catch (e) { if (!e.handled) loadFailed(view); return; }
    const statuses = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'FINISHED', 'REJECTED', 'CANCELED'];
    view.innerHTML = `<div class="page-head"><div><h1>${isAdmin() ? 'Bookings' : 'My Bookings'}</h1><p class="sub">${isAdmin() ? 'Review and manage booking requests.' : 'Track and cancel your bookings. Create new ones with New Booking or from the schedule.'}</p></div>
      <div class="tools"><select id="flt" style="width:180px"><option value="">All statuses</option>${statuses.map(s => `<option value="${s}" ${filter === s ? 'selected' : ''}>${label(s)}</option>`).join('')}</select></div></div>
      <div class="card tbl">${list.length ? `<table><thead><tr><th>Equipment</th>${isAdmin() ? '<th>Student</th>' : ''}<th>Time</th><th>Purpose</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(b => `<tr><td><span class="nm">${esc(b.equipmentTitle)}</span><small>${esc(b.inventoryNumber)} · ${esc(b.location)}</small></td>
        ${isAdmin() ? `<td>${esc(b.studentName)}<small>${esc(b.studentEmail)}</small></td>` : ''}
        <td>${fmt(b.start)}–${fmtT(b.end)}</td><td>${esc(b.description)}</td><td>${badge(b.status)}</td>
        <td><div class="acts-cell">${b.canDecide ? `<button class="btn sm primary" data-a="approve" data-id="${b.id}">Approve</button><button class="btn sm danger" data-a="reject" data-id="${b.id}">Reject</button>` : ''}
        ${b.canCancel ? `<button class="btn sm" data-a="cancel" data-id="${b.id}">Cancel</button>` : ''}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty"><b>No bookings</b>Nothing matches this filter.</div>'}</div>`;
    document.getElementById('flt').onchange = e => { filter = e.target.value; draw(); };
    view.querySelectorAll('[data-a]').forEach(btn => btn.onclick = async () => { await bookingAction(btn.dataset.a, btn.dataset.id); draw(); });
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
    view.innerHTML = `<div class="page-head"><div><h1>${isAdmin() ? 'Repair Requests' : 'Report Issue'}</h1><p class="sub">${isAdmin() ? 'Review reported problems and track repairs.' : 'Report a faulty piece of equipment and follow the problems you reported.'}</p></div>
      ${isAdmin() ? '' : `<div class="tools"><button class="btn primary" id="new-rep">${ICON.plus}New report</button></div>`}</div>
      ${list.length ? list.map(r => `<div class="card rep"><div class="head"><div><b>${esc(r.title)}</b><div class="sub" style="margin:0">${esc(r.equipmentTitle)} (${esc(r.inventoryNumber)}) · ${esc(r.location)}${isAdmin() ? ` · by ${esc(r.reporter)}` : ''} · ${fmt(r.createdAt)}</div></div>
        <div>${badge(r.stage)}</div></div>
        <p>${esc(r.description)}</p>${aiBox(r)}<div class="acts">${actions(r)}</div></div>`).join('') : '<div class="card empty"><b>No repair requests</b>Reported problems appear here.</div>'}`;
    document.getElementById('new-rep')?.addEventListener('click', () => reportModal(null, draw));
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



/* ---------- equipment details dialog (description, specifications, responsible person) ---------- */
function infoModal(e, refresh) {
  const mail = e.contactEmail
    ? `<a href="mailto:${esc(e.contactEmail)}?subject=${encodeURIComponent('Question about ' + e.inventoryNumber)}">${esc(e.contactName || e.contactEmail)}</a>${e.contactName ? `<small>${esc(e.contactEmail)}</small>` : ''}`
    : (e.contactName ? esc(e.contactName) : '<span class="muted">Not specified</span>');
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  modal(`<h2>${esc(e.title)}</h2><div class="kvhead">${badge(e.status)}<span class="sub" style="margin:0">Inventory No.: ${esc(e.inventoryNumber)}</span></div>
    <div class="thumb info-thumb">${thumb(e)}</div>
    <dl class="kv">${row('Description', e.description ? esc(e.description) : '<span class="muted">-</span>')}
      ${row('Specifications', e.specifications ? `<div class="pre">${esc(e.specifications)}</div>` : '<span class="muted">Not specified</span>')}
      ${row('Location', esc(e.location))}${row('Category', esc(e.category))}${row('Responsible', mail)}</dl>
    <div class="foot"><button class="btn" id="cx">Close</button>
      ${isAdmin() ? '' : `<button class="btn primary" id="bk" ${e.status === 'MAINTENANCE' ? 'disabled' : ''}>Book</button>`}</div>`, (m, close) => {
    m.querySelector('#cx').onclick = close;
    const bk = m.querySelector('#bk'); if (bk) bk.onclick = () => { close(); bookModal(e, refresh); };
  });
}

/* ---------- calendar: week view ---------- */
const CAL_FIRST = 8, CAL_LAST = 20;   // hours shown (the default lab hours)
const mondayOf = iso => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
let calState = { week: mondayOf(ymd(new Date())), eq: '' };

function bookingModal(b, onDone) {
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  modal(`<h2>${esc(b.equipmentTitle)}</h2><div class="kvhead">${badge(b.status)}<span class="sub" style="margin:0">${esc(b.inventoryNumber)} · ${esc(b.location)}</span></div>
    <dl class="kv">${row('When', `${fmt(b.start)}–${fmtT(b.end)}`)}${isAdmin() ? row('Student', `${esc(b.studentName)}<small>${esc(b.studentEmail)}</small>`) : ''}${row('Purpose', esc(b.description))}</dl>
    <div class="foot"><button class="btn" id="cx">Close</button>
      ${b.canCancel ? '<button class="btn danger" data-a="cancel">Cancel booking</button>' : ''}
      ${b.canDecide ? '<button class="btn danger" data-a="reject">Reject</button><button class="btn primary" data-a="approve">Approve</button>' : ''}</div>`, (m, close) => {
    m.querySelector('#cx').onclick = close;
    m.querySelectorAll('[data-a]').forEach(btn => btn.onclick = async () => { close(); await bookingAction(btn.dataset.a, b.id); onDone(); });
  });
}

async function calendar(view) {
  const draw = async () => {
    let list; try { list = await api('/bookings'); } catch (e) { if (!e.handled) loadFailed(view); return; }
    list = list.filter(b => b.status !== 'REJECTED' && b.status !== 'CANCELED');
    const eqs = [...new Map(list.map(b => [String(b.equipmentId), b.equipmentTitle]))].sort((a, b) => a[1].localeCompare(b[1]));
    const days = Array.from({ length: 7 }, (_, i) => addDays(calState.week, i)), today = ymd(new Date());
    const shown = list.filter(b => (!calState.eq || String(b.equipmentId) === calState.eq) && days.includes(b.start.slice(0, 10)));
    const hours = Array.from({ length: CAL_LAST - CAL_FIRST }, (_, i) => CAL_FIRST + i);
    const dayName = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
    const range = `${new Date(days[0] + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(days[6] + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const cell = (d, h) => `<div class="cal-c ${d === today ? 'today' : ''}">${shown.filter(b => b.start.slice(0, 10) === d && Number(b.start.slice(11, 13)) === h)
      .map(b => `<button class="chip s-${b.status.toLowerCase()}" data-b="${b.id}" title="${esc(b.equipmentTitle)} - ${label(b.status)}">${esc(b.equipmentTitle)}${isAdmin() ? `<small>${esc(b.studentName)}</small>` : ''}</button>`).join('')}</div>`;
    view.innerHTML = `<div class="page-head"><div><h1>Calendar</h1><p class="sub">${isAdmin() ? 'Bookings of all equipment' : 'Your bookings'} · ${range}</p></div>
      <div class="tools">${isAdmin() || eqs.length > 1 ? `<select id="cal-eq" style="width:200px"><option value="">All equipment</option>${eqs.map(([id, t]) => `<option value="${esc(id)}" ${calState.eq === id ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
        <div class="datenav"><button class="btn icon" id="c-prev" aria-label="Previous week">${ICON.left}</button><button class="btn" id="c-today">Today</button><button class="btn icon" id="c-next" aria-label="Next week">${ICON.right}</button></div></div></div>
      <div class="card"><div class="card-h"><div class="legend"><span><i class="l-pending"></i>Pending</span><span><i class="l-confirmed"></i>Confirmed</span><span><i class="l-in_progress"></i>In progress</span><span><i class="l-finished"></i>Finished</span></div>
        <div class="right"><small>${shown.length} booking${shown.length === 1 ? '' : 's'} this week</small></div></div>
        <div class="cal-scroll"><div class="cal"><div class="cal-h"></div>${days.map(d => `<div class="cal-h ${d === today ? 'today' : ''}"><span>${dayName(d)}</span><b>${Number(d.slice(8))}</b></div>`).join('')}
          ${hours.map(h => `<div class="cal-t">${hh(h)}:00</div>${days.map(d => cell(d, h)).join('')}`).join('')}</div></div></div>`;
    const go = w => { calState.week = w; draw(); };
    document.getElementById('c-prev').onclick = () => go(addDays(calState.week, -7));
    document.getElementById('c-next').onclick = () => go(addDays(calState.week, 7));
    document.getElementById('c-today').onclick = () => go(mondayOf(today));
    document.getElementById('cal-eq')?.addEventListener('change', ev => { calState.eq = ev.target.value; draw(); });
    const byId = Object.fromEntries(shown.map(b => [b.id, b]));
    view.querySelectorAll('[data-b]').forEach(c => c.onclick = () => bookingModal(byId[c.dataset.b], draw));
  };
  await draw(); timers.push(setInterval(() => { if (!document.querySelector('.ov')) draw().catch(() => { }); }, 20000));
}

/* ---------- notifications: full history ---------- */
let notesPage = 1;
async function notifications(view) {
  const draw = async () => {
    let d; try { d = await api(`/notifications?page=${notesPage}&pageSize=15`); } catch (e) { if (!e.handled) loadFailed(view); return; }
    const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
    view.innerHTML = `<div class="page-head"><div><h1>Notifications</h1><p class="sub">${d.total} message${d.total === 1 ? '' : 's'}, ${d.unread} unread.${isAdmin() ? '' : (user.emailNotifications ? ' A copy of booking messages is also sent to your e-mail.' : ' E-mail copies are switched off in your profile.')}</p></div>
      <div class="tools"><button class="btn" id="read-all" ${d.unread ? '' : 'disabled'}>Mark all as read</button></div></div>
      <div class="card">${d.items.length ? d.items.map(n => `<div class="nrow ${n.isRead ? '' : 'unread'}"><span class="dot" aria-hidden="true"></span><div>${esc(n.message)}<small>${fmt(n.createdAt)}</small></div></div>`).join('')
        : '<div class="empty"><b>No notifications yet</b>Decisions on your bookings and repair reports appear here.</div>'}</div>
      <div class="pager"><span>Showing ${d.items.length} of ${d.total}</span><div><button class="btn sm" id="prev" ${d.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${d.page} / ${pages}</span><button class="btn sm" id="next" ${d.page >= pages ? 'disabled' : ''}>Next ›</button></div></div>`;
    document.getElementById('read-all').onclick = async () => { await api('/notifications/read-all', 'POST'); loadNotes(false); draw(); };
    document.getElementById('prev').onclick = () => { notesPage--; draw(); };
    document.getElementById('next').onclick = () => { notesPage++; draw(); };
  };
  notesPage = 1; await draw();
}

/* ---------- profile ---------- */
async function profile(view) {
  view.innerHTML = `<div class="page-head"><div><h1>Profile</h1><p class="sub">Your account, notifications and password.</p></div></div>
    <div class="grid g2" style="align-items:start">
      <div class="card pad"><h2>Account</h2>
        <label for="p-name">Name</label><input id="p-name" maxlength="50" value="${esc(user.name)}"><div id="e-name"></div>
        <label for="p-surname">Surname</label><input id="p-surname" maxlength="50" value="${esc(user.surname)}"><div id="e-surname"></div>
        <label>E-mail</label><input value="${esc(user.email)}" disabled>
        <label>Role</label><input value="${isAdmin() ? 'Administrator' : 'Student'}" disabled>
        ${isAdmin() ? '' : `<label class="switch-row"><span class="switch"><input type="checkbox" id="p-mail" ${user.emailNotifications ? 'checked' : ''}><i></i></span><span><b>E-mail notifications</b><small>Receive booking confirmations and changes by e-mail, with a calendar file for confirmed bookings.</small></span></label>`}
        <div id="p-msg"></div><div class="foot"><button class="btn primary" id="p-save">Save changes</button></div></div>
      <div class="card pad"><h2>Change password</h2>
        <label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password"><div id="e-currentPassword"></div>
        <label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password"><div id="e-newPassword"></div>
        <label for="pw-cfm">Confirm new password</label><input id="pw-cfm" type="password" autocomplete="new-password"><div id="e-confirmPassword"></div>
        <div id="pw-msg"></div><p class="sub" style="margin-top:12px">At least 8 characters with a letter and a digit. You will stay signed in here; other devices are signed out.</p>
        <div class="foot"><button class="btn primary" id="pw-save">Change password</button></div></div></div>`;
  const val = id => document.getElementById(id).value, set = (id, h) => { document.getElementById(id).innerHTML = h; };
  document.getElementById('p-save').onclick = async () => {
    ['e-name', 'e-surname', 'p-msg'].forEach(i => set(i, ''));
    try {
      user = await api('/profile', 'PUT', { name: val('p-name'), surname: val('p-surname'), emailNotifications: isAdmin() ? undefined : document.getElementById('p-mail').checked });
      toast('Profile saved'); route();
    } catch (er) {
      if (er.handled) return;
      set('e-name', fieldErr(er.fields, 'name')); set('e-surname', fieldErr(er.fields, 'surname'));
      if (!Object.keys(er.fields).length) set('p-msg', `<div class="alert">${esc(er.message)}</div>`);
    }
  };
  document.getElementById('pw-save').onclick = async () => {
    ['e-currentPassword', 'e-newPassword', 'e-confirmPassword', 'pw-msg'].forEach(i => set(i, ''));
    try {
      await api('/profile/password', 'POST', { currentPassword: val('pw-cur'), newPassword: val('pw-new'), confirmPassword: val('pw-cfm') });
      ['pw-cur', 'pw-new', 'pw-cfm'].forEach(i => { document.getElementById(i).value = ''; });
      toast('Password changed');
    } catch (er) {
      if (er.handled) return;
      ['currentPassword', 'newPassword', 'confirmPassword'].forEach(k => set('e-' + k, fieldErr(er.fields, k)));
      if (!Object.keys(er.fields).length) set('pw-msg', `<div class="alert">${esc(er.message)}</div>`);
    }
  };
}

/* ---------- reports (admin) ---------- */
let repDays = 30;
async function reports(view) {
  const draw = async () => {
    let r; try { r = await api('/reports?days=' + repDays); } catch (e) { if (!e.handled) loadFailed(view); return; }
    const maxDay = Math.max(1, ...r.perDay.map(x => x.total)), maxHours = Math.max(1, ...r.utilization.map(x => x.usedHours));
    const stat = (l, n, sub, ico) => `<div class="card stat"><div class="top-row"><span class="l">${l}</span><span class="chip">${ico}</span></div><div class="n">${n}</div><div class="d">${sub}</div></div>`;
    const step = Math.max(1, Math.ceil(r.perDay.length / 6));
    const short = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    view.innerHTML = `<div class="page-head"><div><h1>Reports</h1><p class="sub">${short(r.fromDate)} – ${short(r.toDate)} · equipment usage and faults</p></div>
      <div class="tools"><select id="rep-days" style="width:170px">${[7, 30, 90].map(n => `<option value="${n}" ${n === repDays ? 'selected' : ''}>Last ${n} days</option>`).join('')}</select></div></div>
      <div class="grid g4">${stat('Bookings', r.totals.bookings, 'started in this period', ICON.bookings)}${stat('Booked hours', r.totals.usedHours, 'confirmed, in progress or finished', ICON.clock)}
        ${stat('Utilization', r.totals.utilizationPercent + '%', 'of all bookable hours', ICON.pulse)}${stat('Repair reports', r.totals.repairs, `${r.totals.confirmedRepairs} confirmed`, ICON.repairs)}</div>
      <div class="card sect"><div class="card-h">${ICON.pulse}<div class="ttl"><h2>Bookings per day</h2><small>All requests and the part that was actually used.</small></div>
        <div class="right legend"><span><i class="l-total"></i>Requested</span><span><i class="l-used"></i>Used</span></div></div>
        <div class="bars" role="img" aria-label="Bookings per day">${r.perDay.map((x, i) => `<div class="bar" title="${short(x.date)}: ${x.total} requested, ${x.used} used"><div class="bar-t" style="height:${Math.round(x.total * 100 / maxDay)}%"><div class="bar-u" style="height:${x.total ? Math.round(x.used * 100 / x.total) : 0}%"></div></div><span>${i % step === 0 ? short(x.date) : ''}</span></div>`).join('')}</div></div>
      <div class="grid g2 sect" style="align-items:start">
        <div class="card"><div class="card-h">${ICON.equipment}<div class="ttl"><h2>Equipment utilization</h2><small>Booked hours per piece of equipment.</small></div></div>
          ${r.utilization.length ? r.utilization.slice(0, 10).map(u => `<div class="urow"><div class="un"><b>${esc(u.title)}</b><small>${esc(u.inventoryNumber)}</small></div><div class="ubar"><i style="width:${Math.round(u.usedHours * 100 / maxHours)}%"></i></div><span class="uv">${u.usedHours} h · ${u.percent}%</span></div>`).join('') : '<div class="empty"><b>No equipment</b></div>'}</div>
        <div class="card"><div class="card-h">${ICON.repairs}<div class="ttl"><h2>Most frequent faults</h2><small>Equipment with the most problem reports.</small></div></div>
          ${r.faults.length ? `<div class="tbl"><table><thead><tr><th>Equipment</th><th>Reports</th><th>Confirmed</th><th>Last report</th></tr></thead><tbody>${r.faults.map(f => `<tr><td><span class="nm">${esc(f.title)}</span><small>${esc(f.inventoryNumber)}</small></td><td>${f.reports}</td><td>${f.confirmed}</td><td>${fmtShort(f.lastReport)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>No problem reports</b>Nothing was reported in this period.</div>'}</div></div>
      <div class="card sect"><div class="card-h">${ICON.list}<div class="ttl"><h2>Bookings by status</h2></div></div>
        <div class="statusrow">${r.byStatus.length ? r.byStatus.map(s => `<div>${badge(s.status)}<b>${s.count}</b></div>`).join('') : '<span class="muted">No bookings in this period.</span>'}</div></div>`;
    document.getElementById('rep-days').onchange = e => { repDays = Number(e.target.value); draw(); };
  };
  await draw();
}

/* ---------- rules & help (students) ---------- */
async function help(view) {
  let sc, eq;
  try { [sc, eq] = await Promise.all([api('/schedule'), api('/equipment?pageSize=60&sort=name')]); } catch (e) { if (!e.handled) loadFailed(view); return; }
  const contacts = eq.items.filter(e => e.contactName || e.contactEmail);
  view.innerHTML = `<div class="page-head"><div><h1>Rules &amp; Help</h1><p class="sub">How booking works and whom to contact.</p></div></div>
    <div class="grid g2" style="align-items:start">
      <div class="card pad"><h2>Booking rules</h2><ul class="rules">
        <li>A booking is <b>one hour</b> long. Slots start on the hour between <b>${hh(sc.openHour)}:00</b> and <b>${hh(sc.closeHour)}:00</b>.</li>
        <li>You can book at most <b>${sc.maxDaysAhead} days</b> ahead, and only a slot that has not started yet.</li>
        <li>A new request is <b>pending</b>: the slot is held for you until an administrator confirms or rejects it.</li>
        <li>A request without a decision is canceled automatically after <b>${sc.pendingTimeoutHours} hours</b>, or when its start time is reached.</li>
        <li>You can cancel a pending or confirmed booking until it starts.</li>
        <li>Equipment under maintenance cannot be booked. If it is placed under maintenance, its pending and confirmed bookings are canceled and you are notified.</li>
        <li>Found a fault? Use <a href="#/repairs">Report Issue</a> and describe the problem in English.</li></ul></div>
      <div class="card pad"><h2>E-mail and calendar</h2><ul class="rules">
        <li>You get an e-mail when a request is received, confirmed, rejected or canceled.</li>
        <li>A confirmed booking comes with a calendar file (.ics) and an <b>Add to Google Calendar</b> link. A canceled booking removes the event again.</li>
        <li>Switch e-mails on or off in your <a href="#/profile">profile</a>. Notifications inside LEMS always stay available under <a href="#/notifications">Notifications</a>.</li></ul></div></div>
    <div class="card sect"><div class="card-h">${ICON.students}<div class="ttl"><h2>Who to contact</h2><small>Persons responsible for the equipment.</small></div></div>
      ${contacts.length ? `<div class="tbl"><table><thead><tr><th>Equipment</th><th>Responsible</th><th>E-mail</th></tr></thead><tbody>${contacts.map(e => `<tr><td><span class="nm">${esc(e.title)}</span><small>${esc(e.inventoryNumber)} · ${esc(e.location)}</small></td><td>${esc(e.contactName) || '-'}</td>
        <td>${e.contactEmail ? `<a href="mailto:${esc(e.contactEmail)}?subject=${encodeURIComponent('Question about ' + e.inventoryNumber)}">${esc(e.contactEmail)}</a>` : '-'}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty"><b>No contacts yet</b>An administrator can add a responsible person to each piece of equipment.</div>'}</div>`;
}


route();
