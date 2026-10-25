/* LEMS single-page frontend (vanilla JS). Talks to the C# backend under /api (cookie session). */
const $app = document.getElementById('app');
let user = null, timers = [], eqState = { q: '', category: '', status: '', sort: 'name', page: 1 };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtT = d => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const label = s => String(s).replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
const badge = s => `<span class="badge b-${String(s).toLowerCase()}">${label(s)}</span>`;
const ICONS = { Electronics: '🔌', Optics: '🔬', Chemistry: '🧪', Fabrication: '🛠️' };
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
  ov.innerHTML = `<div class="modal">${html}</div>`;
  ov.addEventListener('mousedown', e => { if (e.target === ov) ov.remove(); });
  document.body.append(ov); onMount?.(ov.firstChild, () => ov.remove()); return ov;
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
  $app.innerHTML = `<div class="auth"><div class="card">
    <div class="logo"><i>🔬</i> LEMS</div><p class="sub" style="text-align:center">Laboratory Equipment Management System</p>
    <h2>${reg ? 'Create student account' : 'Log in'}</h2>
    <label>Email</label><input id="email" type="email" value="${esc(vals.email)}" placeholder="${reg ? 'name.surname@student.tuke.sk' : 'you@example.com'}">${fieldErr(errors, 'email')}
    <label>Password</label><input id="pw" type="password">${fieldErr(errors, 'password')}
    ${reg ? `<label>Confirm password</label><input id="pw2" type="password">${fieldErr(errors, 'confirmPassword')}` : ''}
    ${msg ? `<div class="alert">${esc(msg)}</div>` : ''}
    <button class="btn primary" id="go" style="width:100%;margin-top:18px">${reg ? 'Create Account' : 'Log In'}</button>
    <div class="alt">${reg ? 'Have an account? <a id="sw">Log in</a>' : 'New student? <a id="sw">Create an account</a>'}</div>
  </div></div>`;
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
const NAV = () => isAdmin()
  ? [['dashboard', '🏠', 'Dashboard'], ['equipment', '🧰', 'Equipment'], ['bookings', '📅', 'Bookings'], ['repairs', '🛠️', 'Repair Requests']]
  : [['dashboard', '🏠', 'Dashboard'], ['equipment', '🧰', 'Equipment'], ['bookings', '📅', 'Bookings'], ['repairs', '🛠️', 'Repair Requests']];

function shell(page) {
  const ini = (user.name[0] + user.surname[0]).toUpperCase();
  $app.innerHTML = `<div class="shell">
    <aside class="side"><div class="logo"><i>🔬</i> LEMS</div>
      <nav class="nav">${NAV().map(([k, ic, t]) => `<a href="#/${k}" class="${k === page ? 'active' : ''}">${ic} ${t}</a>`).join('')}</nav></aside>
    <div class="main"><header class="top">
      <div class="rel"><button class="bell" id="bell">🔔<span class="badge-n" id="nbadge" hidden>0</span></button><div class="drop notes" id="notes" hidden></div></div>
      <div class="rel"><button class="acct" id="acct"><span class="avatar">${esc(ini)}</span><b>${esc(user.name)} ${esc(user.surname)}</b> ▾</button>
        <div class="drop" id="menu" hidden><div class="it"><small style="color:var(--muted)">Account role</small><br><b>${isAdmin() ? 'Administrator' : 'Student'}</b></div>
        <div class="it"><button class="btn" id="logout" style="width:100%">Log out</button></div></div></div>
    </header><main class="content" id="view"></main></div></div>`;
  const notes = document.getElementById('notes'), menu = document.getElementById('menu');
  document.getElementById('bell').onclick = async e => { e.stopPropagation(); menu.hidden = true; notes.hidden = !notes.hidden; if (!notes.hidden) { await loadNotes(true); } };
  document.getElementById('acct').onclick = e => { e.stopPropagation(); notes.hidden = true; menu.hidden = !menu.hidden; };
  document.onclick = () => { notes.hidden = true; menu.hidden = true; };
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
  await (pages[page] || dashboard)(document.getElementById('view'));
}
window.addEventListener('hashchange', route);

/* ---------- dashboard ---------- */
async function dashboard(view) {
  const draw = async () => {
    let d; try { d = await api('/dashboard'); } catch { return; }
    const stat = (n, l, badgeCls) => `<div class="card stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
    view.innerHTML = `<h1>Dashboard</h1><p class="sub">Overview of laboratory equipment and recent activity.</p>
      <div class="grid g4">${stat(d.equipment.available, 'Available equipment')}${stat(d.equipment.reserved, 'Reserved equipment')}${stat(d.equipment.maintenance, 'Under maintenance')}${stat(d.equipment.total, 'Total equipment')}</div>
      ${d.admin ? `<div class="grid g4" style="margin-top:16px">${stat(d.admin.repairsOpen, 'Open repair requests')}${stat(d.admin.repairsClosed, 'Closed repair requests')}${stat(d.admin.students, 'Students')}${stat(d.admin.admins, 'Administrators')}</div>` : ''}
      <div class="card feed" style="margin-top:20px"><h2>Activity feed</h2>
      ${d.feed.length ? d.feed.map(e => `<div class="ev">${esc(e.message)}<small>${fmt(e.createdAt)}</small></div>`).join('') : '<div class="empty">No activity yet</div>'}</div>`;
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
      ${d.items.length ? `<div class="grid g3">${d.items.map(card).join('')}</div>` : '<div class="card empty">No equipment found</div>'}
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

function card(e) {
  const maint = e.status === 'MAINTENANCE';
  const acts = isAdmin()
    ? `<button class="btn" data-act="edit" data-id="${e.id}">Edit</button><button class="btn danger" data-act="del" data-id="${e.id}">Remove</button>`
    : `<button class="btn primary" data-act="book" data-id="${e.id}" ${maint ? 'disabled title="Equipment is under maintenance"' : ''}>Book</button><button class="btn" data-act="report" data-id="${e.id}">Report Issue</button>`;
  return `<div class="card eq"><div class="thumb">${ICONS[e.category] || '🧰'}</div><h3>${esc(e.title)}</h3>
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
    <label>Description</label><textarea id="rd" rows="5" maxlength="500" placeholder="Describe what is wrong"></textarea><div id="e-desc"></div>
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
    <div id="e-gen"></div><div class="foot"><button class="btn" id="cx">Cancel</button><button class="btn primary" id="ok">Save</button></div>`, (m, close) => {
    m.querySelector('#cx').onclick = close;
    m.querySelector('#ok').onclick = async () => {
      const g = id => m.querySelector('#f-' + id)?.value;
      const body = { inventoryNumber: g('inventoryNumber'), title: g('title'), category: g('category'), location: g('location'), description: g('description'), status: g('status') ?? v.status };
      if (e && body.status === 'MAINTENANCE' && v.status !== 'MAINTENANCE' && !(await confirmBox('Place under maintenance?', 'All pending and confirmed bookings of this equipment will be canceled and students notified.', 'Continue', true))) return;
      try {
        await api(e ? `/equipment/${e.id}` : '/equipment', e ? 'PUT' : 'POST', body);
        close(); toast(e ? 'Equipment updated' : 'Equipment created'); refresh();
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
      <div class="card" style="padding:6px 10px;overflow:auto">${list.length ? `<table><thead><tr><th>Equipment</th>${isAdmin() ? '<th>Student</th>' : ''}<th>Time</th><th>Purpose</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(b => `<tr><td><b>${esc(b.equipmentTitle)}</b><br><small>${esc(b.inventoryNumber)} · ${esc(b.location)}</small></td>
        ${isAdmin() ? `<td>${esc(b.studentName)}<br><small>${esc(b.studentEmail)}</small></td>` : ''}
        <td>${fmt(b.start)}–${fmtT(b.end)}</td><td>${esc(b.description)}</td><td>${badge(b.status)}</td>
        <td><div class="acts-cell">${b.canDecide ? `<button class="btn sm primary" data-a="approve" data-id="${b.id}">Approve</button><button class="btn sm danger" data-a="reject" data-id="${b.id}">Reject</button>` : ''}
        ${b.canCancel ? `<button class="btn sm" data-a="cancel" data-id="${b.id}">Cancel</button>` : ''}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No bookings</div>'}</div>`;
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
    const aiBox = r => {
      if (!isAdmin()) return '';
      if (!r.ai) return '<div class="ai pending">AI recommendations are being generated or are currently unavailable.</div>';
      return `<div class="ai"><b>AI recommendations</b><div>${esc(r.ai.summary)}</div><ul>${r.ai.recommendations.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    };
    const actions = r => {
      if (!isAdmin() || r.status === 'CLOSED') return '';
      return r.confirmed
        ? `<button class="btn primary sm" data-a="complete" data-w="true" data-id="${r.id}">Repair checked - equipment works</button><button class="btn sm" data-a="complete" data-w="false" data-id="${r.id}">Checked - still not working</button>`
        : `<button class="btn primary sm" data-a="confirm" data-id="${r.id}">Confirm problem</button><button class="btn sm" data-a="dismiss" data-id="${r.id}">Not confirmed - close</button>`;
    };
    view.innerHTML = `<h1>Repair Requests</h1><p class="sub">${isAdmin() ? 'Review reported problems and track repairs.' : 'Problems you reported. Use "Report Issue" on the Equipment page to create one.'}</p>
      ${list.length ? list.map(r => `<div class="card rep"><div class="head"><div><b>${esc(r.title)}</b><div class="sub" style="margin:0">${esc(r.equipmentTitle)} (${esc(r.inventoryNumber)}) · ${esc(r.location)}${isAdmin() ? ` · by ${esc(r.reporter)}` : ''} · ${fmt(r.createdAt)}</div></div>
        <div style="text-align:right">${badge(r.status)} ${badge(r.stage)}<div><small style="color:var(--muted)">${STAGE[r.stage] || ''}</small></div></div></div>
        <p>${esc(r.description)}</p>${aiBox(r)}<div class="acts">${actions(r)}</div></div>`).join('') : '<div class="card empty">No repair requests</div>'}`;
    view.querySelectorAll('[data-a]').forEach(btn => btn.onclick = async () => {
      const a = btn.dataset.a;
      if (a === 'confirm' && !(await confirmBox('Confirm problem?', 'Equipment goes to MAINTENANCE and all pending/confirmed bookings are canceled.', 'Confirm', true))) return;
      try {
        const res = await api(`/repairs/${btn.dataset.id}/${a}`, 'POST', a === 'complete' ? { working: btn.dataset.w === 'true' } : undefined);
        toast(a === 'complete' && res.repeated ? 'Repair cycle continues' : 'Request updated');
      } catch (er) { if (!er.handled) toast(er.message, true); }
      draw();
    });
  };
  await draw(); timers.push(setInterval(() => { if (!document.querySelector('.ov')) draw().catch(() => { }); }, 15000));
}

route();
