'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sql, withSchema, withApplication, json, signIn, signUp, download, sheetRows } = require('./fixtures/mysql-app.cjs');

const skip = process.env.MYSQL_INTEGRATION_TESTS !== '1' && 'Run with MYSQL_INTEGRATION_TESTS=1 for disposable schemas on the local MySQL server.';
const path = '/api/khach-hang';
const worker = 'customer_worker';
const admin = 'customer_admin';
const customerCode = n => 'K' + String(n).padStart(3, '0');
const seatCode = n => 'G' + String(n).padStart(3, '0');
const bookingStart = '2033-10-03';
const bookingEnd = '2033-10-08';

function customer(n, fields = {}) {
  return {
    MaKhachHang: customerCode(n), TenKhachHang: n % 2 ? 'Đặng Müller Anh' : 'Đặng Müller Bình',
    SoDienThoai: '0906400' + String(n).padStart(3, '0'), Email: null, ...fields
  };
}

function ticket(n, fields = {}) {
  return {
    MaVe: 'V' + String(n).padStart(3, '0'), MaSuatChieu: 'SH03', MaKhachHang: customerCode(n), MaGhe: seatCode(n % 400),
    NgayDat: bookingEnd + ' 23:59:59', GiaVe: 80000, TrangThai: n % 2 ? 'DaDat' : 'DaSuDung', ...fields
  };
}

async function seed(db, customers, history) {
  await db.query('INSERT INTO KhachHang (MaKhachHang, TenKhachHang, SoDienThoai, Email) VALUES ?', [
    [...customers, customer(490), customer(491), customer(492), customer(494, { Email: 'Buyer@Example.test' }),
      customer(495, { TenKhachHang: 'Đặng Hồ', Email: 'résumé@example.test' })].map(row => Object.values(row))
  ]);
  await db.query(`INSERT INTO Phim (MaPhim, TenPhim, TheLoai, ThoiLuong, NgayKhoiChieu) VALUES
    ('PH01', 'Đỏ Ánh Müller', 'Tâm lý', 100, '2033-08-01'),
    ('PH02', 'Đỏ Ánh 2', 'Tâm lý', 110, '2033-08-01'),
    ('PH03', 'Đỏ Ánh ngoài bộ lọc', 'Tâm lý', 120, '2033-08-01');
    INSERT INTO PhongChieu (MaPhong, TenPhong, SoGhe) VALUES ('R01', 'Phòng 01', 130);
    INSERT INTO SuatChieu (MaSuatChieu, MaPhim, MaPhong, NgayChieu, GioBatDau, GioKetThuc) VALUES
    ('SH01', 'PH01', 'R01', '2033-10-12', '18:00:00', '19:40:00'),
    ('SH02', 'PH02', 'R01', '2033-10-12', '20:00:00', '21:50:00'),
    ('SH03', 'PH03', 'R01', '2033-10-13', '18:00:00', '20:00:00');`);
  await db.query('INSERT INTO Ghe (MaGhe, MaPhong, SoHang, SoGhe) VALUES ?', [
    Array.from({ length: 130 }, (_, i) => [seatCode(i + 1), 'R01', 'A', i + 1])
  ]);
  await db.query('INSERT INTO Ve (MaVe, MaSuatChieu, MaKhachHang, MaGhe, NgayDat, GiaVe, TrangThai) VALUES ?', [
    [...customers.map((_, i) => ticket(401 + i)),
      ticket(401, { MaVe: 'V401extra', MaGhe: 'G044', NgayDat: bookingStart + ' 00:00:00' }),
      ticket(490, { MaSuatChieu: 'SH02', TrangThai: 'DaHuy' }),
      ticket(491, { NgayDat: '2033-10-09 00:00:00' }), ticket(494),
      ...history, ticket(401, { MaVe: 'VexcludedFilm', MaSuatChieu: 'SH03', MaGhe: 'G111', TrangThai: 'DaHuy' }),
      ticket(401, { MaVe: 'VexcludedState', MaSuatChieu: 'SH02', MaGhe: 'G112', TrangThai: 'DaDat' }),
      ticket(401, { MaVe: 'VexcludedDate', MaSuatChieu: 'SH02', MaGhe: 'G113', NgayDat: '2033-10-09 00:00:00', TrangThai: 'DaHuy' })]
      .map(row => Object.values(row))
  ]);
}

const combined = {
  q: ' ĐẶNG    MÜLLER ', ten: 'muller', coEmail: 'false', veTuNgay: bookingStart, veDenNgay: bookingEnd, sort: 'ten:asc'
};
const historyPath = code => path + '/' + code + '/ve';
const historyQuery = {
  q: ' do   anh ', tenPhim: 'ĐỎ ÁNH', maPhim: ['PH01', 'PH02'], trangThai: ['DaHuy', 'DaSuDung'],
  tuNgay: bookingStart, denNgay: bookingEnd, sort: 'ngayDat:asc'
};

const customerValues = row => [row.MaKhachHang, row.TenKhachHang, row.SoDienThoai, row.Email ?? null];
const ticketKey = row => [row.MaVe, row.MaSuatChieu, row.MaGhe];
const compareTie = (a, b) => a.MaVe.localeCompare(b.MaVe) || a.MaSuatChieu.localeCompare(b.MaSuatChieu) || a.MaGhe.localeCompare(b.MaGhe);

test('Customer and ticket history snapshots, authentic XLSX, customer lookup and permissions', { skip }, async t => {
  await withSchema(async (db, schema) => {
    await db.query(sql('createTable.sql'));
    await db.query(sql('create_tai_khoan.sql'));
    const customers = Array.from({ length: 35 }, (_, i) => customer(401 + i));
    customers[0].Email = '';
    customers[1].Email = '  \t  ';
    const history = Array.from({ length: 32 }, (_, i) => ticket(401, {
      MaVe: 'VH' + String(Math.floor(i / 4)).padStart(2, '0'), MaGhe: seatCode(51 + i),
      MaSuatChieu: i % 4 < 2 ? 'SH02' : 'SH01', TrangThai: i % 2 ? 'DaHuy' : 'DaSuDung',
      NgayDat: i < 4 ? bookingStart + ' 00:00:00' : bookingEnd + ' 23:59:59'
    }));
    await seed(db, customers, history);

    await withApplication(schema, async request => {
      await signUp(request, worker);
      await signUp(request, admin);
      await db.query(`UPDATE TaiKhoan SET VaiTro = 'QuanTriVien' WHERE TenDangNhap = '${admin}'`);
      const cookie = await signIn(request, worker);
      const adminCookie = await signIn(request, admin);

      await t.test('multi-filter customer snapshot paginates distinct customers and exports original values in order', async () => {
        const page1 = await json(request, path, { cookie, query: combined });
        assert.equal(page1.pageSize, 25);
        assert.equal(page1.total, customers.length);
        assert.equal(page1.items.length, 25);
        await db.query(`UPDATE KhachHang SET TenKhachHang = 'Đã đổi tên' WHERE MaKhachHang = 'K401'`);
        const page2 = await json(request, path, { cookie, query: { snapshotId: page1.snapshotId, page: 2 } });
        assert.equal(page2.total, page1.total);
        assert.equal(page2.snapshotId, page1.snapshotId);
        const expected = customers.slice().sort((a, b) => a.TenKhachHang.localeCompare(b.TenKhachHang, 'vi') ||
          a.MaKhachHang.localeCompare(b.MaKhachHang));
        const visible = [...page1.items, ...page2.items];
        assert.equal(new Set(visible.map(row => row.MaKhachHang)).size, 35);
        assert.deepEqual(visible.map(customerValues), expected.map(customerValues));

        const book = await download(request, path + '/xuat', cookie, page2.snapshotId);
        assert.equal(book.getWorksheet(1).name, 'Khách hàng');
        assert.deepEqual(sheetRows(book, 1).map(row => [row[0], row[1], row[2], row[3] ?? null]), expected.map(customerValues));
        assert.equal(book.getWorksheet(1).getCell('C2').value, expected[0].SoDienThoai);
        assert.match(book.getWorksheet(1).getCell('C2').value, /^0\d+$/);
        const refreshed = await json(request, path, { cookie, query: combined });
        assert.equal(refreshed.total, 34);
        assert.notEqual(refreshed.snapshotId, page1.snapshotId);
        await json(request, path + '/xuat', { cookie: adminCookie, query: { snapshotId: page1.snapshotId } }, 403);
        await json(request, path + '/xuat', { query: { snapshotId: page1.snapshotId } }, 401);
        await db.query(`UPDATE KhachHang SET TenKhachHang = 'Đặng Müller Anh' WHERE MaKhachHang = 'K401'`);
      });

      await t.test('exact code, formatted phone, email matching and the customer picker use the intended separate contracts', async () => {
        const exact = await json(request, path, { cookie, query: {
          maKhachHang: 'K494', soDienThoai: '0906 400-494', email: ' BUYER@EXAMPLE.TEST ', coEmail: 'true', q: 'buyer'
        } });
        assert.deepEqual(exact.items.map(row => row.MaKhachHang), ['K494']);
        const accented = await json(request, path, { cookie, query: { email: 'RÉSUMÉ@Example.test' } });
        assert.deepEqual(accented.items.map(row => row.MaKhachHang), ['K495']);
        const wrongEmail = await json(request, path, { cookie, query: { email: 'resume@example.test' } });
        assert.equal(wrongEmail.total, 0);
        const prefix = await json(request, path, { cookie, query: { maKhachHang: 'K49' } });
        assert.deepEqual(prefix.items, []);
        const all = await json(request, path, { cookie });
        assert.deepEqual(all.items.map(row => row.MaKhachHang), customers.slice(0, 25).map(row => row.MaKhachHang));
        await json(request, path, { cookie, query: { veTuNgay: bookingEnd, veDenNgay: bookingStart } }, 400);
        await json(request, path, { cookie, query: { coEmail: 'maybe' } }, 400);

        const lookup = await json(request, path + '/tuy-chon', { cookie, query: { q: 'dang muller', page: 2, pageSize: 10 } });
        assert.equal(lookup.total, 39);
        assert.equal(lookup.page, 2);
        assert.equal(lookup.pageSize, 10);
        assert.equal(lookup.items[0].MaKhachHang, 'K411');
        assert.deepEqual(Object.keys(lookup.items[0]), ['MaKhachHang', 'TenKhachHang', 'SoDienThoai']);
        assert.ok(!Object.hasOwn(lookup, 'snapshotId'));
      });

      await t.test('history includes cancelled tickets, orders full keys across pages and separates empty reasons', async () => {
        const route = historyPath('K401');
        const first = await json(request, route, { cookie, query: historyQuery });
        assert.equal(first.total, 32);
        assert.deepEqual(first.meta, { hasHistory: true });
        const next = await json(request, route, { cookie, query: { snapshotId: first.snapshotId, page: 2 } });
        assert.equal(next.snapshotId, first.snapshotId);
        assert.deepEqual(next.meta, { hasHistory: true });
        const visible = [...first.items, ...next.items];
        const ordered = history.slice().sort((a, b) => a.NgayDat.localeCompare(b.NgayDat) || compareTie(a, b));
        assert.deepEqual(visible.map(ticketKey), ordered.map(ticketKey));
        assert.ok(visible.some(row => row.TrangThai === 'DaHuy'));
        assert.ok(visible.some(row => row.TrangThai === 'DaSuDung'));
        const newest = await json(request, route, { cookie, query: { ...historyQuery, sort: 'ngayDat:desc' } });
        const byDesc = history.slice().sort((a, b) => b.NgayDat.localeCompare(a.NgayDat) || compareTie(a, b));
        assert.deepEqual(newest.items.map(ticketKey), byDesc.slice(0, 25).map(ticketKey));
        const code = await json(request, route, { cookie, query: { ...historyQuery, maVe: 'VH07' } });
        assert.deepEqual(code.items.map(ticketKey), ordered.filter(row => row.MaVe === 'VH07').map(ticketKey));
        const unmatched = await json(request, route, { cookie, query: { maVe: 'VH' } });
        assert.equal(unmatched.total, 0);
        assert.deepEqual(unmatched.meta, { hasHistory: true });

        const cancelled = await json(request, historyPath('K490'), { cookie, query: { trangThai: 'DaHuy' } });
        assert.deepEqual(cancelled.items.map(row => row.MaVe), ['V490']);
        const noHistory = await json(request, historyPath('K492'), { cookie, query: { trangThai: 'DaHuy' } });
        assert.equal(noHistory.total, 0);
        assert.deepEqual(noHistory.meta, { hasHistory: false });
        await json(request, historyPath('K999'), { cookie }, 404);
        await json(request, historyPath('K490'), { cookie, query: { snapshotId: first.snapshotId, page: 2 } }, 403);
        await json(request, path + '/xuat', { cookie, query: { snapshotId: first.snapshotId } }, 403);
        await json(request, route + '/xuat', { cookie, query: { snapshotId: first.snapshotId } }, 404);
        await json(request, route, { cookie, query: { sort: 'maVe:asc' } }, 400);
      });

      await t.test('staff create/update and administrator delete remain protected', async () => {
        const saved = customer(499, { TenKhachHang: 'Khách thêm mới' });
        await json(request, path, { data: saved, method: 'POST' }, 401);
        assert.deepEqual(await json(request, path, { cookie, data: saved, method: 'POST' }, 201), saved);
        const updated = { ...saved, TenKhachHang: 'Khách đã sửa', Email: 'fresh@example.test' };
        assert.deepEqual(await json(request, path + '/K499', { cookie, data: updated, method: 'PUT' }), updated);
        await json(request, path + '/K499', { cookie, method: 'DELETE' }, 403);
        const deletion = await request(path + '/K499', { cookie: adminCookie, method: 'DELETE' });
        assert.equal(deletion.status, 204);
        await json(request, historyPath('K499'), { cookie }, 404);
      });
    });
  });
});
