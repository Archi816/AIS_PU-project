// Shared fake backend for the frontend tests (jsdom smoke tests and browser screenshots).
export const iso = (h) => { const d = new Date(Date.now() + h * 3600e3); return d.toISOString().slice(0, 19); };
export const EVIL = '<img src=x onerror="window.__xss=1">';

export const eq = (id, title, status, category = 'Electronics', hasImage = false, extra = {}) => ({ id, inventoryNumber: 'ARD-00' + id, title, description: '', location: 'Lab', category, status, createdAt: iso(-50), hasImage, imageVersion: hasImage ? 123 : 0, specifications: '', contactName: '', contactEmail: '', ...extra });
const report = { symptoms: ['S1'], possible_causes: ['C1'], recommended_checks: ['K1'], missing_information: ['M1'], documentation_status: 'ok',
  documentation_sources: [{ source_id: 'S1', title: 'Manual', url: 'https://example.com/m.pdf' }, { source_id: 'S2', title: 'Evil', url: 'javascript:alert(1)' }] };
const repair = (id, stage, ai) => ({ id, title: 'T' + id, description: 'D' + id, status: stage === 'RESOLVED' ? 'CLOSED' : 'OPEN', confirmed: stage === 'IN_REPAIR', resolution: null, stage,
  createdAt: iso(-3 - id), equipmentId: 1, equipmentTitle: 'Arduino', inventoryNumber: 'ARD-001', location: 'Lab', equipmentStatus: 'AVAILABLE', reporter: 'Jan Novak', ai });

const TITLES = [EVIL, 'Printer', 'Robot arm', 'Oscilloscope', 'Microscope', 'Centrifuge', 'Spectrometer'];
const STATUS = ['AVAILABLE', 'RESERVED', 'MAINTENANCE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE'];

export function mockApi(role) {
  const me = { id: role === 'ADMIN' ? 1 : 2, name: role === 'ADMIN' ? 'Admin' : 'Jan', surname: 'User', email: 'u@x.sk', role, emailNotifications: true };
  const slots = Array.from({ length: 12 }, (_, i) => { const s = new Date(Date.now() + 86400e3); s.setHours(8 + i, 0, 0, 0); const e = new Date(s.getTime() + 3600e3);
    return { start: s.toISOString().slice(0, 19), end: e.toISOString().slice(0, 19), state: i % 4 === 0 ? 'taken' : 'free' }; });
  // schedule: row 3 is under maintenance; per row hours 0,4,8 booked by others, hour 9 is the viewer's own booking, hour 8+1 past
  const scheduleRows = TITLES.map((title, k) => ({ id: k + 1, inventoryNumber: 'ARD-00' + (k + 1), title, category: 'Electronics', location: 'Lab', status: STATUS[k],
    slots: slots.map((s, i) => ({ hour: 8 + i, start: s.start, end: s.end,
      state: STATUS[k] === 'MAINTENANCE' ? 'maintenance' : i % 4 === 0 ? 'taken' : i === 1 ? 'mine' : i === 2 ? 'past' : 'free' })) }));
  const bookingsList = [1, 2, 3].map(i => ({ id: i, equipmentId: 1, equipmentTitle: 'Arduino', inventoryNumber: 'ARD-001', location: 'Lab', userId: 2, studentName: 'Jan Novak', studentEmail: 'j@x.sk', description: i === 1 ? EVIL : 'Experiment ' + i,
    start: iso(0).slice(0, 11) + String(10 + i).padStart(2, '0') + ':00:00', end: iso(0).slice(0, 11) + String(11 + i).padStart(2, '0') + ':00:00', status: ['PENDING', 'CONFIRMED', 'FINISHED'][i - 1], createdAt: iso(-i), canCancel: i < 3, canDecide: role === 'ADMIN' && i === 1 }));
  return (path) => {
    const p = path.split('?')[0];
    if (p === '/auth/me') return me;
    if (p === '/notifications') return { unread: 1, total: 2, page: 1, pageSize: 15, items: [{ id: 2, message: EVIL, isRead: false, createdAt: iso(-1) }, { id: 1, message: 'Your booking of Arduino was confirmed.', isRead: true, createdAt: iso(-30) }] };
    if (p === '/profile') return me;
    if (p === '/reports') {
      if (role !== 'ADMIN') throw new Error('forbidden');
      const days = Number((path.split('days=')[1] || '30'));
      return { days, fromDate: '2026-10-13', toDate: '2026-11-11',
        totals: { bookings: 42, usedHours: 31, repairs: 5, confirmedRepairs: 3, utilizationPercent: 12.4 },
        perDay: Array.from({ length: days }, (_, i) => ({ date: '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), total: (i * 3) % 7, used: (i * 3) % 5 })),
        byStatus: [{ status: 'FINISHED', count: 20 }, { status: 'CONFIRMED', count: 10 }, { status: 'PENDING', count: 4 }, { status: 'CANCELED', count: 8 }],
        utilization: [{ id: 1, inventoryNumber: 'ARD-001', title: EVIL, usedHours: 12, percent: 4.1 }, { id: 2, inventoryNumber: 'ARD-002', title: 'Printer', usedHours: 6, percent: 2 }],
        faults: [{ equipmentId: 1, inventoryNumber: 'ARD-001', title: 'Arduino', reports: 3, confirmed: 2, lastReport: iso(-5) }] };
    }
    if (p === '/dashboard') return { equipment: { available: 5, reserved: 1, maintenance: 1, total: 7 }, admin: role === 'ADMIN' ? { repairsOpen: 2, repairsClosed: 1, students: 4, admins: 1, pendingBookings: 2 } : null, feed: [{ id: 1, message: EVIL, createdAt: iso(-1) }] };
    if (p === '/schedule') return { date: new Date().toISOString().slice(0, 10), openHour: 8, closeHour: 20, maxDaysAhead: 60, pendingTimeoutHours: 24, equipment: scheduleRows };
    if (p === '/students') {
      if (role !== 'ADMIN') throw new Error('forbidden');
      return [{ id: 2, name: 'Jan', surname: 'Novak', email: 'jan.novak@student.tuke.sk', createdAt: iso(-500), bookings: 3, activeBookings: 2, repairs: 1 },
              { id: 3, name: EVIL, surname: 'Kral', email: 'eva.kral@student.tuke.sk', createdAt: iso(-90), bookings: 0, activeBookings: 0, repairs: 0 }];
    }
    if (p === '/equipment') return { items: [eq(1, EVIL, 'AVAILABLE', 'Electronics', false, { description: 'Desc', specifications: 'Power: 230 V\n' + EVIL, contactName: 'Dr. Novak', contactEmail: 'novak@tuke.sk' }), eq(2, 'Printer', 'RESERVED', 'Computing', true, { contactEmail: 'x"onmouseover="window.__xss=1' }), eq(3, 'Robot', 'MAINTENANCE', 'Robotics')], total: 3, page: 1, pageSize: 9, counts: { all: 3, available: 1, reserved: 1, maintenance: 1 }, categories: ['Electronics'] };
    if (/^\/equipment\/\d+\/slots/.test(p)) return { equipment: eq(1, 'Arduino', 'AVAILABLE'), slots };
    if (p === '/bookings') return bookingsList;
    if (p === '/repairs') return [repair(1, 'AWAITING_REVIEW', { ok: true, report }), repair(2, 'IN_REPAIR', { ok: false, code: 'MODEL_UNAVAILABLE', message: 'x' }), repair(3, 'RESOLVED', null), repair(4, 'NO_REPAIR_REQUIRED', null)];
    throw new Error('unmocked ' + path);
  };
}
