// Frontend smoke tests: runs the real frontend/app.js in jsdom against a mocked /api (see mock.mjs).
// Run:  cd tests/frontend && npm install && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { mockApi } from './mock.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../frontend');
const html = readFileSync(join(root, 'index.html'), 'utf8').replace(/<script src="app\.js[^"]*"><\/script>/, '');
const code = readFileSync(join(root, 'app.js'), 'utf8');
const art = readFileSync(join(root, 'art.js'), 'utf8');

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

const TITLES = {
  ADMIN: [['#/dashboard', 'Equipment Availability'], ['#/equipment', 'Equipment'], ['#/calendar', 'Calendar'], ['#/bookings', 'Bookings'], ['#/repairs', 'Repair Requests'], ['#/inventory', 'Inventory'], ['#/students', 'Students'],
          ['#/reports', 'Reports'], ['#/notifications', 'Notifications'], ['#/profile', 'Profile']],
  STUDENT: [['#/dashboard', 'Equipment Availability'], ['#/equipment', 'Equipment'], ['#/calendar', 'Calendar'], ['#/bookings', 'My Bookings'], ['#/repairs', 'Report Issue'],
            ['#/notifications', 'Notifications'], ['#/profile', 'Profile'], ['#/help', 'Rules & Help']]
};
for (const role of ['ADMIN', 'STUDENT']) {
  for (const [hash, title] of TITLES[role]) {
    test(`${role} ${hash}: renders without errors`, async () => {
      const { d, errors, w } = await boot(role, hash);
      assert.deepEqual(errors, []);
      assert.equal(d.querySelector('#view h1').textContent, title);
      assert.doesNotMatch(d.getElementById('view').textContent, /undefined|\[object|NaN/);
      assert.equal(w.__xss, undefined, 'script injection must not run');
      assert.equal(d.querySelector('#view img:not(.photo)'), null, 'user text must be escaped');
      assert.equal(d.querySelector('#view [onerror]'), null, 'no injected handlers');
      assert.equal(d.querySelectorAll('.nav a').length, role === 'ADMIN' ? 10 : 8);
      assert.equal(d.querySelectorAll('.nav a.active').length, 1);
    });
  }
}

test('STUDENT cannot open admin-only pages, ADMIN has no student help page', async () => {
  for (const hash of ['#/students', '#/inventory', '#/reports']) {
    const { d } = await boot('STUDENT', hash);
    assert.equal(d.querySelector('#view h1').textContent, 'Equipment Availability');
  }
  const a = await boot('ADMIN', '#/help');
  assert.equal(a.d.querySelector('#view h1').textContent, 'Equipment Availability');
});

test('sidebar groups: admin has an extra Admin section, student does not', async () => {
  const a = await boot('ADMIN', '#/dashboard');
  assert.deepEqual([...a.d.querySelectorAll('.nav-h')].map(x => x.textContent), ['Main', 'Admin', 'Account']);
  const s = await boot('STUDENT', '#/dashboard');
  assert.deepEqual([...s.d.querySelectorAll('.nav-h')].map(x => x.textContent), ['Main', 'Account']);
  assert.match(s.d.querySelector('.side-user').textContent, /Jan User/);
});

test('dashboard: 4 stat cards and a schedule that shows only 5 pieces of equipment until "Show all"', async () => {
  const { d } = await boot('STUDENT', '#/dashboard');
  assert.equal(d.querySelectorAll('.stat').length, 4);
  assert.deepEqual([...d.querySelectorAll('.stat .l')].map(x => x.textContent), ['Total Equipment', 'Available Now', 'In Use Now', 'Under Maintenance']);
  assert.equal(d.querySelectorAll('.sched .row:not(.head)').length, 5);
  assert.equal(d.querySelectorAll('.sched .row.head span').length, 13, 'name column + 12 hours');
  d.getElementById('sched-all').click();
  await waitFor(() => d.querySelectorAll('.sched .row:not(.head)').length === 7);
  assert.match(d.getElementById('sched-all').textContent, /Show first 5/);
});

test('dashboard schedule: free green / unavailable red / maintenance struck out', async () => {
  const { d } = await boot('STUDENT', '#/dashboard');
  d.getElementById('sched-all').click();
  await waitFor(() => d.querySelectorAll('.sched .row:not(.head)').length === 7);
  assert.ok(d.querySelector('.cell.free') && d.querySelector('.cell.taken') && d.querySelector('.cell.mine') && d.querySelector('.cell.past'));
  const maint = d.querySelector('.sched .row.maint');
  assert.ok(maint, 'maintenance row is marked');
  assert.equal(maint.querySelectorAll('.cell.maint').length, 12);
  assert.equal(maint.querySelector('.cell.go'), null, 'nothing to click in a maintenance row');
  assert.match(maint.textContent, /Maintenance/);
});

test('STUDENT: clicking a free slot opens the booking dialog with that slot pre-selected', async () => {
  const { d } = await boot('STUDENT', '#/dashboard');
  const cell = d.querySelector('.cell.free.go');
  assert.ok(cell);
  cell.click();
  await waitFor(() => d.querySelectorAll('.slot').length === 12);
  await waitFor(() => d.querySelector('.slot.sel'));
  assert.equal(d.querySelector('.slot.sel').dataset.s, cell.dataset.start);
});

test('ADMIN dashboard: free slots are not clickable, recent bookings and repair requests are tables', async () => {
  const { d } = await boot('ADMIN', '#/dashboard');
  assert.equal(d.querySelector('.cell.go'), null);
  const heads = [...d.querySelectorAll('#view .card-h h2')].map(x => x.textContent);
  assert.ok(heads.includes('Recent Bookings') && heads.includes('Recent Repair Requests'));
  const th = t => [...d.querySelectorAll('#view .card')].find(c => c.querySelector('h2')?.textContent === t).querySelectorAll('th');
  assert.deepEqual([...th('Recent Bookings')].map(x => x.textContent), ['Equipment', 'Student', 'Date', 'Status']);
  assert.deepEqual([...th('Recent Repair Requests')].map(x => x.textContent), ['Equipment', 'Student', 'Date', 'Status']);
});

test('STUDENT dashboard has upcoming bookings but no admin tables', async () => {
  const { d } = await boot('STUDENT', '#/dashboard');
  const heads = [...d.querySelectorAll('#view .card-h h2')].map(x => x.textContent);
  assert.ok(heads.includes('My upcoming bookings'));
  assert.ok(!heads.includes('Recent Bookings') && !heads.includes('Recent Repair Requests'));
});

test('dashboard: previous day is disabled today, next day moves the date', async () => {
  const { d } = await boot('STUDENT', '#/dashboard');
  assert.equal(d.getElementById('d-prev').disabled, true);
  const before = d.querySelector('.page-head .sub').textContent;
  d.getElementById('d-next').click();
  await waitFor(() => d.querySelector('.page-head .sub').textContent !== before || d.getElementById('d-prev').disabled === false);
  assert.equal(d.getElementById('d-prev').disabled, false);
});

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

test('STUDENT never sees AI output or admin actions; can start a new report', async () => {
  const { d } = await boot('STUDENT', '#/repairs');
  assert.equal(d.querySelector('.ai'), null);
  assert.equal(d.querySelector('[data-a="confirm"]'), null);
  d.getElementById('new-rep').click();
  await waitFor(() => d.querySelector('.modal #re'));
  assert.ok(d.querySelector('.modal #rt') && d.querySelector('.modal #rd'));
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

test('top-bar action: "New Booking" asks for the equipment first, admin gets "Add Equipment"', async () => {
  const s = await boot('STUDENT', '#/dashboard');
  assert.match(s.d.getElementById('top-act').textContent, /New Booking/);
  s.d.getElementById('top-act').click();
  await waitFor(() => s.d.querySelector('.modal #nb'));
  assert.equal(s.d.querySelectorAll('.modal #nb option').length, 2, 'equipment under maintenance is not offered');
  const a = await boot('ADMIN', '#/dashboard');
  assert.match(a.d.getElementById('top-act').textContent, /Add Equipment/);
  a.d.getElementById('top-act').click();
  await waitFor(() => a.d.querySelector('.modal #f-inventoryNumber'));
});

test('global search sends the query to the equipment page', async () => {
  const { w, d } = await boot('STUDENT', '#/dashboard');
  const gs = d.getElementById('gs'); gs.value = 'printer';
  gs.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' }));
  await waitFor(() => w.location.hash === '#/equipment');
  await waitFor(() => d.getElementById('q') && d.getElementById('q').value === 'printer');
});

test('ADMIN equipment has edit/remove, STUDENT has book/report', async () => {
  const a = await boot('ADMIN', '#/equipment');
  assert.ok(a.d.querySelector('[data-act="edit"]'));
  assert.equal(a.d.querySelector('[data-act="book"]'), null);
  const s = await boot('STUDENT', '#/equipment');
  assert.ok(s.d.querySelector('[data-act="book"]') && s.d.querySelector('[data-act="report"]'));
  assert.equal(s.d.querySelector('[data-act="edit"]'), null);
  assert.ok(s.d.querySelector('[data-act="book"][disabled]'), 'maintenance equipment cannot be booked');
});

test('ADMIN inventory: table with edit/remove per row', async () => {
  const { d } = await boot('ADMIN', '#/inventory');
  assert.equal(d.querySelectorAll('#view tbody tr').length, 3);
  assert.deepEqual([...d.querySelectorAll('#view th')].map(x => x.textContent).slice(0, 5), ['Equipment', 'Inventory no.', 'Category', 'Location', 'Status']);
  assert.equal(d.querySelectorAll('#view [data-act="edit"]').length, 3);
  assert.equal(d.querySelectorAll('#view [data-act="del"]').length, 3);
});

test('ADMIN students: table, search filter and escaped names', async () => {
  const { w, d } = await boot('ADMIN', '#/students');
  assert.equal(d.querySelectorAll('#stbl tbody tr').length, 2);
  const sq = d.getElementById('sq'); sq.value = 'jan'; sq.dispatchEvent(new w.Event('input'));
  assert.equal(d.querySelectorAll('#stbl tbody tr').length, 1);
  assert.equal(w.__xss, undefined);
});

test('login screen renders when not authenticated', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.setInterval = () => 0;
  w.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Not authenticated' }) });
  w.eval(art); w.eval(code);
  await waitFor(() => w.document.querySelector('.auth'));
  assert.ok(w.document.getElementById('email') && w.document.getElementById('pw'));
  assert.match(w.document.querySelector('.hero').textContent, /Laboratory Equipment/);
  w.document.getElementById('sw').click();
  assert.ok(w.document.getElementById('pw2'), 'register form has a confirmation field');
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

test('brand logo: sidebar icon and login wordmark', async () => {
  const { d } = await boot('STUDENT', '#/dashboard');
  assert.match(d.querySelector('.side .brand img.logo').getAttribute('src'), /^logo\.svg/);
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.setInterval = () => 0;
  w.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  w.eval(art); w.eval(code);
  await waitFor(() => w.document.querySelector('.hero'));
  assert.match(w.document.querySelector('.hero img.hero-logo').getAttribute('src'), /^wordmark\.svg/);
});

test('equipment details dialog: specifications, responsible person, safe mailto', async () => {
  const { w, d } = await boot('STUDENT', '#/equipment');
  d.querySelector('[data-act="info"][data-id="1"]').click();
  await waitFor(() => d.querySelector('.modal .kv'));
  const text = d.querySelector('.modal').textContent;
  assert.match(text, /Power: 230 V/); assert.match(text, /Dr\. Novak/);
  const a = d.querySelector('.modal .kv a');
  assert.equal(a.getAttribute('href'), 'mailto:novak@tuke.sk?subject=Question%20about%20ARD-001');
  assert.equal(d.querySelector('.modal [onerror], .modal img:not(.photo)'), null, 'specifications are escaped');
  assert.ok(d.querySelector('.modal #bk'), 'students can book from the dialog');
  // a contact e-mail that tries to break out of the attribute stays inert
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  d.querySelector('[data-act="info"][data-id="2"]').click();
  await waitFor(() => d.querySelector('.modal .kv'));
  assert.equal(d.querySelector('.modal .kv a').hasAttribute('onmouseover'), false);
  assert.equal(w.__xss, undefined);
});

test('ADMIN details dialog has no booking button; equipment form has the new fields', async () => {
  const { d } = await boot('ADMIN', '#/equipment');
  d.querySelector('[data-act="info"][data-id="1"]').click();
  await waitFor(() => d.querySelector('.modal .kv'));
  assert.equal(d.querySelector('.modal #bk'), null);
  d.querySelector('#cx').click();
  d.querySelector('[data-act="edit"][data-id="1"]').click();
  await waitFor(() => d.querySelector('.modal #f-specifications'));
  assert.equal(d.querySelector('#f-contactName').value, 'Dr. Novak');
  assert.equal(d.querySelector('#f-contactEmail').value, 'novak@tuke.sk');
});

test('calendar: week grid with bookings, details dialog and week navigation', async () => {
  const { d } = await boot('STUDENT', '#/calendar');
  assert.equal(d.querySelectorAll('.cal-h').length, 8, 'corner + 7 days');
  assert.equal(d.querySelectorAll('.cal-t').length, 12, 'one row per hour 08-19');
  assert.ok(d.querySelectorAll('.cal .chip').length >= 1);
  assert.equal(d.querySelector('.cal-h.today').textContent.length > 0, true);
  d.querySelector('.cal .chip').click();
  await waitFor(() => d.querySelector('.modal .kv'));
  assert.match(d.querySelector('.modal').textContent, /Purpose/);
  d.querySelector('#cx').click();
  d.getElementById('c-next').click();
  await waitFor(() => d.querySelectorAll('.cal .chip').length === 0);
});

test('ADMIN calendar shows student names and an equipment filter', async () => {
  const { d } = await boot('ADMIN', '#/calendar');
  assert.ok(d.getElementById('cal-eq'));
  assert.match(d.querySelector('.cal .chip small').textContent, /Jan Novak/);
});

test('notifications page: list, unread marker, escaping and paging', async () => {
  const { d, w } = await boot('STUDENT', '#/notifications');
  assert.equal(d.querySelectorAll('.nrow').length, 2);
  assert.equal(d.querySelectorAll('.nrow.unread').length, 1);
  assert.equal(d.getElementById('read-all').disabled, false);
  assert.equal(d.getElementById('prev').disabled, true);
  assert.match(d.querySelector('.page-head .sub').textContent, /e-mail/);
  assert.equal(w.__xss, undefined);
});

test('profile: account form, e-mail switch for students only, password form', async () => {
  const s = await boot('STUDENT', '#/profile');
  assert.equal(s.d.getElementById('p-name').value, 'Jan');
  assert.equal(s.d.getElementById('p-mail').checked, true);
  assert.equal(s.d.querySelector('input[value="u@x.sk"]').disabled, true, 'e-mail is read-only');
  assert.ok(s.d.getElementById('pw-cur') && s.d.getElementById('pw-new') && s.d.getElementById('pw-cfm'));
  const a = await boot('ADMIN', '#/profile');
  assert.equal(a.d.getElementById('p-mail'), null);
});

test('ADMIN reports: totals, per-day bars, utilization and faults', async () => {
  const { d, w } = await boot('ADMIN', '#/reports');
  assert.equal(d.querySelectorAll('.stat').length, 4);
  assert.equal(d.querySelectorAll('.bars .bar').length, 30);
  assert.ok(d.querySelector('.urow'));
  assert.match(d.getElementById('view').textContent, /Most frequent faults/);
  assert.equal(d.querySelectorAll('.statusrow .badge').length, 4);
  d.getElementById('rep-days').value = '7'; d.getElementById('rep-days').dispatchEvent(new w.Event('change'));
  await waitFor(() => d.querySelectorAll('.bars .bar').length === 7);
  assert.equal(w.__xss, undefined);
});

test('STUDENT help page: booking rules from the server settings and contacts', async () => {
  const { d } = await boot('STUDENT', '#/help');
  const text = d.getElementById('view').textContent;
  assert.match(text, /08:00/); assert.match(text, /60 days/); assert.match(text, /24 hours/);
  assert.match(text, /Dr\. Novak/);
  assert.ok(d.querySelector('a[href^="mailto:novak@tuke.sk"]'));
});

test('bell dropdown links to the full notification list', async () => {
  const { w, d } = await boot('STUDENT', '#/dashboard');
  await waitFor(() => d.querySelector('#notes a[href="#/notifications"]'));
});
