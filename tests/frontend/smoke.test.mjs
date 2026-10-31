// Frontend smoke tests: runs the real backend/wwwroot/app.js in jsdom against a mocked /api.
// Run:  cd tests/frontend && npm install && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../backend/wwwroot');
const html = readFileSync(join(root, 'index.html'), 'utf8').replace(/<script src="app\.js[^"]*"><\/script>/, '');
const code = readFileSync(join(root, 'app.js'), 'utf8');
const art = readFileSync(join(root, 'art.js'), 'utf8');

const iso = (h) => { const d = new Date(Date.now() + h * 3600e3); return d.toISOString().slice(0, 19); };
const EVIL = '<img src=x onerror="window.__xss=1">';

const eq = (id, title, status, category = 'Electronics', hasImage = false) => ({ id, inventoryNumber: 'ARD-00' + id, title, description: '', location: 'Lab', category, status, createdAt: iso(-50), hasImage, imageVersion: hasImage ? 123 : 0 });
const report = { symptoms: ['S1'], possible_causes: ['C1'], recommended_checks: ['K1'], missing_information: ['M1'], documentation_status: 'ok',
  documentation_sources: [{ source_id: 'S1', title: 'Manual', url: 'https://example.com/m.pdf' }, { source_id: 'S2', title: 'Evil', url: 'javascript:alert(1)' }] };
const repair = (id, stage, ai) => ({ id, title: 'T' + id, description: 'D' + id, status: stage === 'RESOLVED' ? 'CLOSED' : 'OPEN', confirmed: stage === 'IN_REPAIR', resolution: null, stage,
  createdAt: iso(-3), equipmentId: 1, equipmentTitle: 'Arduino', inventoryNumber: 'ARD-001', location: 'Lab', equipmentStatus: 'AVAILABLE', reporter: 'Jan Novak', ai });

function mockApi(role) {
  const me = { id: role === 'ADMIN' ? 1 : 2, name: role === 'ADMIN' ? 'Admin' : 'Jan', surname: 'User', email: 'u@x.sk', role };
  const slots = Array.from({ length: 12 }, (_, i) => { const s = new Date(Date.now() + 86400e3); s.setHours(8 + i, 0, 0, 0); const e = new Date(s.getTime() + 3600e3);
    return { start: s.toISOString().slice(0, 19), end: e.toISOString().slice(0, 19), state: i % 4 === 0 ? 'taken' : 'free' }; });
  return (path) => {
    const p = path.split('?')[0];
    if (p === '/auth/me') return me;
    if (p === '/notifications') return { unread: 1, items: [{ id: 1, message: 'Hello', isRead: false, createdAt: iso(-1) }] };
    if (p === '/dashboard') return { equipment: { available: 3, reserved: 1, maintenance: 1, total: 5 }, admin: role === 'ADMIN' ? { repairsOpen: 2, repairsClosed: 1, students: 4, admins: 1, pendingBookings: 2 } : null, feed: [{ id: 1, message: EVIL, createdAt: iso(-1) }] };
    if (p === '/equipment') return { items: [eq(1, EVIL, 'AVAILABLE'), eq(2, 'Printer', 'RESERVED', 'Computing', true), eq(3, 'Robot', 'MAINTENANCE', 'Robotics')], total: 3, page: 1, pageSize: 9, counts: { all: 3, available: 1, reserved: 1, maintenance: 1 }, categories: ['Electronics'] };
    if (/^\/equipment\/\d+\/slots/.test(p)) return { equipment: eq(1, 'Arduino', 'AVAILABLE'), slots };
    if (p === '/bookings') return [{ id: 1, equipmentId: 1, equipmentTitle: 'Arduino', inventoryNumber: 'ARD-001', location: 'Lab', userId: 2, studentName: 'Jan Novak', studentEmail: 'j@x.sk', description: EVIL, start: iso(5), end: iso(6), status: 'PENDING', createdAt: iso(-1), canCancel: true, canDecide: role === 'ADMIN' }];
    if (p === '/repairs') return [repair(1, 'AWAITING_REVIEW', { ok: true, report }), repair(2, 'IN_REPAIR', { ok: false, code: 'MODEL_UNAVAILABLE', message: 'x' }), repair(3, 'RESOLVED', null), repair(4, 'NO_REPAIR_REQUIRED', null)];
    throw new Error('unmocked ' + path);
  };
}

async function boot(role, hash) {
  const dom = new JSDOM(html, { url: 'http://localhost/' + hash, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = []; const api = mockApi(role);
  w.addEventListener('error', e => errors.push(e.message));
  w.setInterval = () => 0;                                        // no polling in tests
  w.fetch = async (url, opts = {}) => {
    try { const data = api(String(url).replace(/^\/api/, '')); return { ok: true, status: 200, json: async () => data }; }
    catch (e) { return { ok: false, status: 500, json: async () => ({ error: e.message }) }; }
  };
  w.eval(art); w.eval(code);
  await waitFor(() => w.document.getElementById('view') && !w.document.querySelector('#view .skeleton'));
  return { w, d: w.document, errors };
}
async function waitFor(fn, ms = 2000) { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); } }

for (const role of ['ADMIN', 'STUDENT']) {
  for (const [hash, title] of [['#/dashboard', 'Dashboard'], ['#/equipment', 'Equipment'], ['#/bookings', 'Bookings'], ['#/repairs', 'Repair Requests']]) {
    test(`${role} ${hash}: renders without errors`, async () => {
      const { d, errors, w } = await boot(role, hash);
      assert.deepEqual(errors, []);
      assert.equal(d.querySelector('#view h1').textContent, title);
      assert.doesNotMatch(d.getElementById('view').textContent, /undefined|\[object|NaN/);
      assert.equal(w.__xss, undefined, 'script injection must not run');
      assert.equal(d.querySelector('#view img:not(.photo)'), null, 'user text must be escaped');
      assert.equal(d.querySelector('#view [onerror]'), null, 'no injected handlers');
      assert.equal(d.querySelectorAll('.nav a').length, 4);
    });
  }
}

test('ADMIN repair requests: AI report, error and unsafe link handling', async () => {
  const { d } = await boot('ADMIN', '#/repairs');
  const text = d.getElementById('view').textContent;
  assert.match(text, /AI preliminary report/);
  assert.match(text, /requires technician review/);
  assert.match(text, /AI analysis unavailable/);
  assert.match(text, /language model did not answer/);
  const links = [...d.querySelectorAll('.ai a')].map(a => a.getAttribute('href'));
  assert.deepEqual(links, ['https://example.com/m.pdf']);          // javascript: URL is NOT a link
  assert.ok(d.querySelector('[data-a="analyze"]'), 're-run button present');
  assert.equal(d.querySelectorAll('.rep .badge').length, 4, 'one status badge per request');
});

test('STUDENT never sees AI output or admin actions', async () => {
  const { d } = await boot('STUDENT', '#/repairs');
  assert.equal(d.querySelector('.ai'), null);
  assert.equal(d.querySelector('[data-a="confirm"]'), null);
});

test('STUDENT equipment: book dialog shows slots, Escape closes it', async () => {
  const { w, d } = await boot('STUDENT', '#/equipment');
  d.querySelector('[data-act="book"]').click();
  await waitFor(() => d.querySelectorAll('.slot').length === 12);
  assert.equal(d.querySelectorAll('.slot:disabled').length, 3);   // 'taken' slots are disabled
  assert.ok(d.querySelector('.modal[role="dialog"]'));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(d.querySelector('.ov'), null);
});

test('ADMIN equipment has edit/remove, STUDENT has book/report', async () => {
  const a = await boot('ADMIN', '#/equipment');
  assert.ok(a.d.querySelector('[data-act="edit"]') && a.d.getElementById('add'));
  assert.equal(a.d.querySelector('[data-act="book"]'), null);
  const s = await boot('STUDENT', '#/equipment');
  assert.ok(s.d.querySelector('[data-act="book"]') && s.d.querySelector('[data-act="report"]'));
  assert.equal(s.d.getElementById('add'), null);
  assert.ok(s.d.querySelector('[data-act="book"][disabled]'), 'maintenance equipment cannot be booked');
});

test('login screen renders when not authenticated', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.setInterval = () => 0;
  w.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Not authenticated' }) });
  w.eval(art); w.eval(code);
  await waitFor(() => w.document.querySelector('.auth'));
  assert.ok(w.document.getElementById('email') && w.document.getElementById('pw'));
  assert.match(w.document.querySelector('.hero').textContent, /Laboratory Equipment/);
});

test('equipment cards: photo when uploaded, vector illustration otherwise', async () => {
  const { d } = await boot('STUDENT', '#/equipment');
  const cards = [...d.querySelectorAll('.eq')];
  assert.equal(cards.length, 3);
  const photos = d.querySelectorAll('.eq img.photo');
  assert.equal(photos.length, 1);
  assert.equal(photos[0].getAttribute('src'), '/api/equipment/2/image?v=123');
  assert.equal(d.querySelectorAll('.eq .thumb svg').length, 2, 'the other two use an illustration');
  assert.ok(cards.every(c => c.querySelector('.thumb').children.length === 1));
});

test('ADMIN equipment form offers an optional photo', async () => {
  const { d } = await boot('ADMIN', '#/equipment');
  d.querySelector('[data-act="edit"][data-id="2"]').click();
  await waitFor(() => d.querySelector('.modal'));
  assert.ok(d.querySelector('#f-photo[accept*="image/png"]'));
  assert.ok(d.querySelector('#rm-photo'), 'equipment with a photo can have it removed');
});

test('illustration picker matches equipment types', async () => {
  const { w } = await boot('STUDENT', '#/dashboard');
  const pick = (title, category = '', inv = '') => w.equipmentArt({ title, category, inventoryNumber: inv });
  assert.notEqual(pick('Optical Microscope'), pick('Digital Oscilloscope'));
  assert.notEqual(pick('3D printer'), pick('Centrifuge'));
  assert.equal(pick('Centrifuge'), pick('Something unknown'), 'unknown equipment gets the generic picture');
});

test('brand logo: header icon and login wordmark', async () => {
  const { d } = await boot('STUDENT', '#/dashboard');
  assert.match(d.querySelector('.top .brand img.logo').getAttribute('src'), /^logo\.svg/);
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.setInterval = () => 0;
  w.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  w.eval(art); w.eval(code);
  await waitFor(() => w.document.querySelector('.hero'));
  assert.match(w.document.querySelector('.hero img.hero-logo').getAttribute('src'), /^wordmark\.svg/);
});
