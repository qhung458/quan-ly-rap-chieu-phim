'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sql, withSchema, withApplication, json, signIn, signUp, download, sheetRows } = require('./fixtures/mysql-app.cjs');

const skip = process.env.G5_TEST_MYSQL !== '1' && 'Run with G5_TEST_MYSQL=1 for disposable schemas on the local MySQL server.';
const api = '/api/ban-ve';
const staff = 'g5_staff';
const manager = 'g5_manager';
const show = code => api + '/suat-chieu/' + code;
const list = code => show(code) + '/ve';
const exportPath = code => list(code) + '/xuat';
const seatCode = n => 'G' + String(n).padStart(3, '0');
const statusText = { DaDat: 'Đã đặt', DaSuDung: 'Đã sử dụng', DaHuy: 'Đã hủy' };

function seat(n) {
  return { MaGhe: seatCode(n), SoHang: ['A', 'B', 'AA', 'AB', 'C'][Math.floor((n - 1) / 12)], SoGhe: (n - 1) % 12 + 1 };
}

function pastTicket(n, dates, values = {}) {
  return {
    MaVe: 'PAST' + String(Math.floor((n - 1) / 3) + 1).padStart(2, '0'), MaSuatChieu: 'G5_PAST',
    MaKhachHang: n % 3 ? 'K001' : 'K002', ...seat(n),
    NgayDat: n % 2 ? dates.LastBooking + ' 23:59:59' : dates.FirstBooking + ' 00:00:00',
    GiaVe: n % 2 ? 85000.50 : 120000, TrangThai: n % 2 ? 'DaHuy' : 'DaSuDung', ...values
  };
}

function reference(ticket) {
  const { MaVe, MaSuatChieu, MaKhachHang, MaGhe } = ticket;
  return { MaVe, MaSuatChieu, MaKhachHang, MaGhe };
}

function key(ticket) {
  return Object.values(reference(ticket));
}

function detail(request, cookie, ticket, expected = 200) {
  return json(request, list(ticket.MaSuatChieu) + '/chi-tiet', { cookie, query: {
    maVe: ticket.MaVe, maKhachHang: ticket.MaKhachHang, maGhe: ticket.MaGhe
  } }, expected);
}

function findSeat(detail, code) {
  const row = detail.ghe.find(item => item.MaGhe === code);
  assert.ok(row, `missing seat ${code}`);
  return Boolean(row.DaCoVe);
}

async function installTicketRules(db) {
  const source = sql('create_trigger.sql');
  const [setup, routines] = source.split(/^DELIMITER \/\/\r?$/m);
  const [commands] = routines.split(/^DELIMITER ;\r?$/m);
  await db.query(setup);
  for (const statement of commands.split('//').map(part => part.trim()).filter(Boolean)) await db.query(statement);
}

async function insertTickets(db, rows) {
  await db.query(`INSERT INTO Ve (MaVe, MaSuatChieu, MaKhachHang, MaGhe, NgayDat, GiaVe, TrangThai) VALUES ?`, [
    rows.map(({ MaVe, MaSuatChieu, MaKhachHang, MaGhe, NgayDat, GiaVe, TrangThai }) =>
      [MaVe, MaSuatChieu, MaKhachHang, MaGhe, NgayDat, GiaVe, TrangThai])
  ]);
}

async function seed(db) {
  await db.query(sql('createTable.sql'));
  await db.query(sql('create_tai_khoan.sql'));
  const [[dates]] = await db.query(`SELECT
    DATE_FORMAT(CURDATE() - INTERVAL 11 DAY, '%Y-%m-%d') AS BeforeBooking,
    DATE_FORMAT(CURDATE() - INTERVAL 10 DAY, '%Y-%m-%d') AS FirstBooking,
    DATE_FORMAT(CURDATE() - INTERVAL 8 DAY, '%Y-%m-%d') AS LastBooking,
    DATE_FORMAT(CURDATE() - INTERVAL 7 DAY, '%Y-%m-%d') AS PastShow,
    DATE_FORMAT(CURDATE() + INTERVAL 3 DAY, '%Y-%m-%d') AS OpenShow,
    DATE_FORMAT(CURDATE() + INTERVAL 4 DAY, '%Y-%m-%d') AS NextShow`);
  await db.query(`
    INSERT INTO Phim (MaPhim, TenPhim, TheLoai, ThoiLuong, NgayKhoiChieu)
      VALUES ('G5F', 'Đêm Ánh Trăng', 'Tâm lý', 110, '2020-01-01');
    INSERT INTO PhongChieu (MaPhong, TenPhong, SoGhe) VALUES ('G5R', 'Phòng kiểm thử', 60);
    INSERT INTO KhachHang (MaKhachHang, TenKhachHang, SoDienThoai, Email) VALUES
      ('K001', 'Đặng Müller Anh', '0907000001', 'first@example.test'),
      ('K002', 'Đặng Müller Bình', '0907000002', 'second@example.test'),
      ('K003', 'Khách khác', '0907000003', NULL);
  `);
  await db.query('INSERT INTO Ghe (MaGhe, MaPhong, SoHang, SoGhe) VALUES ?', [
    Array.from({ length: 60 }, (_, i) => { const item = seat(i + 1); return [item.MaGhe, 'G5R', item.SoHang, item.SoGhe]; })
  ]);
  await db.query(`INSERT INTO SuatChieu
    (MaSuatChieu, MaPhim, MaPhong, NgayChieu, GioBatDau, GioKetThuc, GiaVe, TrangThai) VALUES ?`, [[
    ['G5_PAST', 'G5F', 'G5R', dates.PastShow, '18:00:00', '19:50:00', 85000.50, 'KetThuc'],
    ['G5_OPEN', 'G5F', 'G5R', dates.OpenShow, '18:00:00', '19:50:00', 90000, 'SapChieu'],
    ['G5_NEXT', 'G5F', 'G5R', dates.NextShow, '18:00:00', '19:50:00', 110000, 'SapChieu'],
    ['G5_CANCELLED', 'G5F', 'G5R', dates.PastShow, '21:00:00', '22:50:00', 90000, 'Huy']
  ]]);
  const past = Array.from({ length: 34 }, (_, i) => pastTicket(i + 1, dates));
  past.push(pastTicket(1, dates, { MaKhachHang: 'K002', TrangThai: 'DaHuy' }));
  const oldCancelled = pastTicket(1, dates, { MaVe: 'CANCELLED', MaSuatChieu: 'G5_OPEN', MaKhachHang: 'K001', TrangThai: 'DaHuy' });
  const active = pastTicket(1, dates, { MaVe: 'ACTIVE', MaSuatChieu: 'G5_OPEN', MaKhachHang: 'K002', TrangThai: 'DaDat' });
  const openHistory = Array.from({ length: 28 }, (_, index) => pastTicket(index % 12 + 1, dates, {
    MaVe: 'OPEN_HIST' + String(index + 1).padStart(2, '0'), MaSuatChieu: 'G5_OPEN', MaKhachHang: 'K001', TrangThai: 'DaHuy',
    NgayDat: (index % 2 ? dates.FirstBooking : dates.LastBooking) + ' 15:00:00'
  }));
  await insertTickets(db, [
    ...past,
    pastTicket(42, dates, { MaVe: 'PAST_OUT_DATE', NgayDat: dates.PastShow + ' 00:00:00' }),
    pastTicket(43, dates, { MaVe: 'PAST_OUT_KH', MaKhachHang: 'K003' }),
    pastTicket(44, dates, { MaVe: 'PAST_OUT_STATUS', TrangThai: 'DaDat' }),
    pastTicket(45, dates, { MaVe: 'OTHER_PREFIX' }),
    pastTicket(2, dates, { MaVe: 'CANCELLED_SHOW', MaSuatChieu: 'G5_CANCELLED', TrangThai: 'DaHuy' }),
    oldCancelled, active, ...openHistory,
    { ...openHistory[0], ...seat(13), MaVe: 'OPEN_OUT_ROW' },
    { ...openHistory[0], MaVe: 'OPEN_OUT_DATE', NgayDat: dates.BeforeBooking + ' 10:00:00' },
    { ...openHistory[0], MaVe: 'OPEN_OUT_NAME', MaKhachHang: 'K003' }
  ]);
  await installTicketRules(db);
  return { past, dates, oldCancelled, active, openHistory };
}

function ticketSort(a, b) {
  return a.SoHang.length - b.SoHang.length || a.SoHang.localeCompare(b.SoHang) || a.SoGhe - b.SoGhe ||
    b.NgayDat.localeCompare(a.NgayDat) || a.MaVe.localeCompare(b.MaVe) ||
    a.MaSuatChieu.localeCompare(b.MaSuatChieu) || a.MaKhachHang.localeCompare(b.MaKhachHang) || a.MaGhe.localeCompare(b.MaGhe);
}

function workbookDate(date) {
  return new Date(date.slice(0, 16).replace(' ', 'T') + ':00Z');
}

function assertWorkbook(book, ordered) {
  assert.equal(book.getWorksheet(1).name, 'Vé theo suất');
  assert.deepEqual(book.getWorksheet(1).getRow(1).values.slice(1),
    ['Mã vé', 'Mã suất chiếu', 'Ghế', 'Ngày đặt', 'Giá', 'Trạng thái', 'Mã khách']);
  assert.deepEqual(sheetRows(book, 1), ordered.map(row => [
    row.MaVe, row.MaSuatChieu, row.SoHang + '-' + row.SoGhe, workbookDate(row.NgayDat), row.GiaVe, statusText[row.TrangThai], row.MaKhachHang
  ]));
}

test('G5 ticket lists, administrator Excel, and sale/move/cancel use the real MySQL schema', { skip }, async t => {
  await withSchema(async (db, schema) => {
    const { past, dates, oldCancelled, active, openHistory } = await seed(db);
    await withApplication(schema, async request => {
      await signUp(request, staff);
      await signUp(request, manager);
      await db.execute('UPDATE TaiKhoan SET VaiTro = ? WHERE TenDangNhap = ?', ['QuanTriVien', manager]);
      const staffCookie = await signIn(request, staff);
      const adminCookie = await signIn(request, manager);

      await t.test('the active picker and administrator entry provide the intended show scopes', async () => {
        const shows = await json(request, api + '/suat-chieu', { cookie: staffCookie });
        assert.deepEqual(shows.map(item => item.MaSuatChieu), ['G5_OPEN', 'G5_NEXT']);
        const history = await json(request, '/api/suat-chieu', { cookie: adminCookie, query: { maSuatChieu: 'G5_PAST' } });
        assert.equal(history.items[0].TrangThai, 'KetThuc');
        const old = await json(request, show('G5_PAST'), { cookie: staffCookie });
        assert.equal(old.suatChieu.CoTheBan, false);
        assert.equal(old.suatChieu.CoTheHuyDoi, false);
        assert.deepEqual(Object.keys(old).sort(), ['ghe', 'suatChieu']);
        const selectedCustomer = await json(request, '/api/khach-hang/tuy-chon', { cookie: staffCookie, query: { q: '  dang   muller  ', pageSize: 1 } });
        assert.deepEqual([selectedCustomer.total, selectedCustomer.items[0].MaKhachHang], [2, 'K001']);
      });

      await t.test('past-show admin export matches both pages, seven columns, and old values after a database change', async () => {
        const route = list('G5_PAST');
        const query = {
          q: '  ĐẶNG  MÜLLER  ', maVe: 'past', maVeMode: 'contains', maKhachHang: 'K00', maKhachHangMode: 'contains',
          trangThai: ['DaHuy', 'DaSuDung'], tuNgay: dates.FirstBooking, denNgay: dates.LastBooking, sort: 'viTri:asc,ngayDat:desc'
        };
        const first = await json(request, route, { cookie: adminCookie, query });
        assert.equal(first.total, 35);
        assert.equal(first.items.length, 25);
        assert.deepEqual(first.meta, { hasTickets: true });
        const normalized = await json(request, route, { cookie: adminCookie, query: { ...query, q: 'dang   muller' } });
        assert.equal(normalized.total, first.total);
        assert.deepEqual(normalized.items.map(key), first.items.map(key));
        await db.execute('UPDATE Ve SET GiaVe = 99000 WHERE MaVe = ? AND MaSuatChieu = ? AND MaKhachHang = ? AND MaGhe = ?', key(past[0]));
        const second = await json(request, route, { cookie: adminCookie, query: { snapshotId: first.snapshotId, page: 2 } });
        assert.equal(second.snapshotId, first.snapshotId);
        const ordered = past.slice().sort(ticketSort);
        assert.deepEqual([...first.items, ...second.items].map(key), ordered.map(key));
        assertWorkbook(await download(request, exportPath('G5_PAST'), adminCookie, second.snapshotId), ordered);
        assert.equal(Number((await detail(request, adminCookie, past[0])).GiaVe), 99000);
        await json(request, exportPath('G5_PAST'), { cookie: staffCookie, query: { snapshotId: first.snapshotId } }, 403);
        await json(request, exportPath('G5_PAST'), { query: { snapshotId: first.snapshotId } }, 401);
        await json(request, exportPath('G5_OPEN'), { cookie: adminCookie, query: { snapshotId: first.snapshotId } }, 403);
        const staffResult = await json(request, route, { cookie: staffCookie, query });
        await json(request, exportPath('G5_PAST'), { cookie: staffCookie, query: { snapshotId: staffResult.snapshotId } }, 403);
        const cancelled = await json(request, list('G5_CANCELLED'), { cookie: adminCookie });
        assert.equal(sheetRows(await download(request, exportPath('G5_CANCELLED'), adminCookie, cancelled.snapshotId), 1).length, 1);
      });

      await t.test('advanced exact lookups, empty reasons and occupied seats are independent from the ticket query', async () => {
        const route = list('G5_OPEN');
        const byPhone = await json(request, route, { cookie: staffCookie, query: { q: '0907 000 002' } });
        assert.deepEqual(byPhone.items.map(key), [key(active)]);
        const byCodes = await json(request, route, { cookie: staffCookie, query: { q: 'active K002' } });
        assert.deepEqual(byCodes.items.map(key), [key(active)]);
        const exact = await json(request, route, { cookie: staffCookie, query: {
          maVe: 'CANCELLED', maVeMode: 'exact', maKhachHang: 'K001', maKhachHangMode: 'exact', soDienThoai: '0907 000 001',
          hang: 'A', soGhe: 1, trangThai: 'DaHuy', sort: 'maVe:asc'
        } });
        assert.deepEqual(exact.items.map(key), [key(oldCancelled)]);
        const shortCode = await json(request, route, { cookie: staffCookie, query: { maVe: 'CANCEL' } });
        assert.equal(shortCode.total, 1);
        const activeOnly = await detail(request, staffCookie, active);
        assert.equal(activeOnly.TrangThai, 'DaDat');
        const seats = await json(request, show('G5_OPEN'), { cookie: staffCookie });
        assert.equal(seats.ghe.length, 60);
        assert.ok(findSeat(seats, 'G001'));
        assert.equal(seats.suatChieu.CoTheBan, true);
        const noMatch = await json(request, route, { cookie: staffCookie, query: { maVe: 'CANCEL', maVeMode: 'exact' } });
        assert.equal(noMatch.total, 0);
        assert.deepEqual(noMatch.meta, { hasTickets: true });
        const empty = await json(request, list('G5_NEXT'), { cookie: staffCookie });
        assert.deepEqual(empty.meta, { hasTickets: false });
        await json(request, route, { cookie: staffCookie, query: { maVe: 'ACTIVE', maVeMode: 'invalid' } }, 400);
        await json(request, route, { cookie: staffCookie, query: { tuNgay: dates.LastBooking, denNgay: dates.FirstBooking } }, 400);
        await json(request, list('MISSING'), { cookie: staffCookie }, 404);
        await detail(request, staffCookie, { ...active, MaKhachHang: 'K001' }, 404);
        const defaults = await json(request, route, { cookie: adminCookie });
        assert.deepEqual(defaults.items.slice(0, 2).map(key), [key(active), key(oldCancelled)]);
      });

      await t.test('open-show filtered page 2 exports all matched cancellations without releasing occupied seats', async () => {
        const route = list('G5_OPEN');
        const query = {
          q: 'dang muller', hang: 'A', trangThai: 'DaHuy', tuNgay: dates.FirstBooking, denNgay: dates.LastBooking,
          sort: 'viTri:asc,ngayDat:desc'
        };
        const first = await json(request, route, { cookie: adminCookie, query });
        const second = await json(request, route, { cookie: adminCookie, query: { snapshotId: first.snapshotId, page: 2 } });
        const ordered = [oldCancelled, ...openHistory].sort(ticketSort);
        assert.equal(first.total, 29);
        assert.equal(first.items.length, 25);
        assert.equal(second.items.length, 4);
        assert.equal(second.snapshotId, first.snapshotId);
        assert.deepEqual([...first.items, ...second.items].map(key), ordered.map(key));
        assertWorkbook(await download(request, exportPath('G5_OPEN'), adminCookie, second.snapshotId), ordered);
        assert.equal(findSeat(await json(request, show('G5_OPEN'), { cookie: adminCookie }), 'G001'), true);
      });

      await t.test('real rules allow sale, same-show and cross-show move, and cancellation while keeping seat occupancy consistent', async () => {
        const purchase = (code, seats) => ({ cookie: staffCookie, method: 'POST', data: {
          MaSuatChieu: code, MaKhachHang: 'K001', MaGhes: seats
        } });
        await json(request, api, purchase('G5_PAST', ['G058']), 409);
        await json(request, api, purchase('G5_OPEN', ['G001']), 409);
        const sold = await json(request, api, purchase('G5_OPEN', ['G038', 'G039']), 201);
        assert.equal(sold.length, 2);
        assert.deepEqual(sold.map(row => row.MaGhe), ['G038', 'G039']);
        const move = (old, code, seat) => json(request, api + '/doi', { cookie: staffCookie, method: 'PUT', data: {
          Ve: reference(old), MaSuatChieu: code, MaGhe: seat
        } });
        const sameShow = await move(sold[0], 'G5_OPEN', 'G040');
        assert.equal(Number(sameShow.GiaVe), 90000);
        await detail(request, staffCookie, sold[0], 404);
        const sameMap = await json(request, show('G5_OPEN'), { cookie: staffCookie });
        assert.equal(findSeat(sameMap, 'G038'), false);
        assert.equal(findSeat(sameMap, 'G040'), true);
        const anotherShow = await move(sameShow, 'G5_NEXT', 'G041');
        assert.equal(anotherShow.MaVe, sold[0].MaVe);
        assert.equal(anotherShow.MaSuatChieu, 'G5_NEXT');
        assert.equal(Number(anotherShow.GiaVe), 110000);
        await detail(request, staffCookie, sameShow, 404);
        assert.deepEqual(key(await detail(request, staffCookie, anotherShow)), key(anotherShow));
        assert.equal(findSeat(await json(request, show('G5_OPEN'), { cookie: staffCookie }), 'G040'), false);
        assert.equal(findSeat(await json(request, show('G5_NEXT'), { cookie: staffCookie }), 'G041'), true);
        const cancelled = await json(request, api + '/huy', { cookie: staffCookie, method: 'PUT', data: { Ve: reference(anotherShow) } });
        assert.equal(cancelled.TrangThai, 'DaHuy');
        assert.equal(findSeat(await json(request, show('G5_NEXT'), { cookie: staffCookie }), 'G041'), false);
        assert.equal((await detail(request, staffCookie, anotherShow)).TrangThai, 'DaHuy');
      });
    });
  });
});
