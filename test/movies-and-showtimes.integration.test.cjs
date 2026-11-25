'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sql, withSchema, withApplication, json, signIn, signUp, download, sheetRows } = require('./fixtures/mysql-app.cjs');

const skip = process.env.MYSQL_INTEGRATION_TESTS !== '1' && 'Run with MYSQL_INTEGRATION_TESTS=1 for disposable schemas on the local MySQL server.';
const filmPath = '/api/phim';
const showPath = '/api/suat-chieu';
const staff = 'catalog_worker';

const movieQuery = {
  q: '  DEM   TRANG ', daoDien: ' dang  minh ', theLoai: ['Tâm lý', 'kich tinh'],
  tuNgay: '2034-02-20', denNgay: '2034-02-21', phutMin: 100, phutMax: 140, tuoiToiDa: 13,
  sort: 'ngayKhoiChieu:desc,tenPhim:asc'
};
const showQuery = {
  q: ' dem   anh ', tenPhim: 'dem trang', tenPhong: 'ANH', maPhim: ['GP001', 'GP035'], maPhong: ['R01', 'R02'],
  trangThai: ['SapChieu', 'KetThuc'], tuNgay: '2034-02-20', denNgay: '2034-02-21',
  gioTu: '18:00', gioDen: '23:30', giaMin: '85000.5', giaMax: '95000.25', sort: 'phong:asc,lich:asc'
};
const filmCode = n => 'GP' + String(n).padStart(3, '0');
const showCode = n => 'GS' + String(n).padStart(3, '0');

function movie(n, fields = {}) {
  const genres = ['Tâm lý, Tình cảm', 'Gia đình,  TÂM   LÝ', 'Kịch tính, Gia đình "Thiếu nhi"'];
  return {
    MaPhim: filmCode(n), TenPhim: n % 2 ? 'Đêm Trăng A' : 'Đêm Trăng B',
    TheLoai: genres[(n - 1) % 3], DaoDien: n % 2 ? 'Đặng   Minh' : 'Đa\u0323̆ng\u00a0 Minh',
    ThoiLuong: n === 35 ? 125 : 110, NgayKhoiChieu: n % 3 ? '2034-02-21' : '2034-02-20',
    DoTuoiChoPhep: 13, ...fields
  };
}

function show(n, fields = {}) {
  return {
    MaSuatChieu: showCode(n), MaPhim: n % 2 ? 'GP001' : 'GP035', MaPhong: n % 2 ? 'R02' : 'R01',
    NgayChieu: n === 1 || n % 3 === 0 ? '2034-02-21' : '2034-02-20',
    GioBatDau: n === 1 ? '23:30:00' : '18:00:00', GioKetThuc: n === 1 ? '01:15:00' : '20:00:00',
    GiaVe: n % 2 ? '85000.50' : '95000.25', TrangThai: n % 2 ? 'SapChieu' : 'KetThuc', ...fields
  };
}

const rooms = [['R01', 'Ánh B', 30], ['R02', 'Ánh A', 20], ['R03', 'Phòng ngoài bộ lọc', 10]];
const roomNames = new Map(rooms.map(([code, name]) => [code, name]));

async function fill(db, movies, shows) {
  await db.query('INSERT INTO Phim (MaPhim, TenPhim, TheLoai, DaoDien, ThoiLuong, NgayKhoiChieu, DoTuoiChoPhep) VALUES ?', [
    [...movies, movie(90, { TheLoai: 'Tâm lý học' }), movie(91, { DoTuoiChoPhep: 18 }),
      movie(92, { ThoiLuong: 99 }), movie(93, { NgayKhoiChieu: '2034-02-22' }),
      movie(96, { TenPhim: 'Đêm\ufeffTrăng Müller 100%_!', TheLoai: 'Niño, \ufeffTình cảm' }),
      movie(97, { TenPhim: 'Đêm Trăng Muller 100XY!', TheLoai: 'Phiêu lưu' })]
      .map(row => Object.values(row))
  ]);
  await db.query('INSERT INTO PhongChieu (MaPhong, TenPhong, SoGhe) VALUES ?', [rooms]);
  await db.query('INSERT INTO SuatChieu (MaSuatChieu, MaPhim, MaPhong, NgayChieu, GioBatDau, GioKetThuc, GiaVe, TrangThai) VALUES ?', [
    [...shows, show(90, { TrangThai: 'Huy' }), show(91, { GiaVe: '95000.26' }),
      show(92, { GioBatDau: '17:59:59' }), show(93, { NgayChieu: '2034-02-22' }),
      show(94, { MaPhong: 'R03' }), show(95, { MaPhim: 'GP002' }),
      show(96, { MaPhim: 'GP096', MaPhong: 'R03' })].map(row => Object.values(row))
  ]);
}

async function nextPage(request, route, cookie, page1) {
  const second = await json(request, route, { cookie, query: { snapshotId: page1.snapshotId, page: 2 } });
  assert.equal(second.snapshotId, page1.snapshotId);
  assert.equal(second.total, page1.total);
  assert.equal(second.items.length, second.total - page1.items.length);
  return [...page1.items, ...second.items];
}

const excelDate = value => new Date(value + 'T00:00:00Z');
const statusLabels = { SapChieu: 'Sắp chiếu', KetThuc: 'Kết thúc' };

test('Movie and showtime catalogs use full source options, compound filters, consistent snapshots and real XLSX for both tabs', { skip }, async t => {
  await withSchema(async (db, schema) => {
    await db.query(sql('createTable.sql'));
    await db.query(sql('create_tai_khoan.sql'));
    const movies = Array.from({ length: 35 }, (_, i) => movie(i + 1));
    const shows = Array.from({ length: 32 }, (_, i) => show(i + 1));
    await fill(db, movies, shows);

    await withApplication(schema, async request => {
      await signUp(request, staff);
      const cookie = await signIn(request, staff);

      await t.test('single genre tokens match exactly and the option feed includes off-page movies', async () => {
        const query = { ...movieQuery, theLoai: ' TÂM  LÝ ' };
        const psych = await json(request, filmPath, { cookie, query });
        assert.equal(psych.total, 24);
        assert.deepEqual(new Set(psych.items.map(row => row.TheLoai)), new Set(['Tâm lý, Tình cảm', 'Gia đình,  TÂM   LÝ']));
        const quoted = await json(request, filmPath, { cookie, query: { ...movieQuery, theLoai: 'Gia đình "Thiếu nhi"' } });
        assert.equal(quoted.total, 11);
        const page1 = await json(request, filmPath, { cookie });
        const options = await json(request, filmPath + '/tuy-chon', { cookie });
        assert.ok(!page1.items.some(row => row.MaPhim === 'GP035'));
        assert.deepEqual(options.phim.find(row => row.MaPhim === 'GP035'), { MaPhim: 'GP035', TenPhim: 'Đêm Trăng A', ThoiLuong: 125 });
        assert.equal(options.theLoai.filter(item => item.value === 'tam ly').length, 1);
        assert.ok(options.theLoai.some(item => item.value === 'tam ly hoc'));
        assert.ok(options.theLoai.some(item => item.value === 'gia dinh "thieu nhi"'));
        const genreFromOptions = options.theLoai.find(item => item.label === 'Niño');
        const foreign = await json(request, filmPath, { cookie, query: {
          ...movieQuery, q: 'MÜLLER', tenPhim: 'dem trang', theLoai: genreFromOptions.value
        } });
        assert.deepEqual(foreign.items.map(row => row.MaPhim), ['GP096']);
        const literal = await json(request, filmPath, { cookie, query: { q: 'Muller', tenPhim: '100%_!' } });
        assert.deepEqual(literal.items.map(row => row.MaPhim), ['GP096']);
        const showWithForeignTitle = await json(request, showPath, { cookie, query: { q: 'muller loc', tenPhim: '100%_!' } });
        assert.deepEqual(showWithForeignTitle.items.map(row => row.MaSuatChieu), ['GS096']);
        assert.ok(options.theLoai.every(item => !item.value.includes(',')));

        const roomOptions = await json(request, '/api/phong-chieu/tuy-chon', { cookie });
        assert.deepEqual(roomOptions, rooms.map(([MaPhong, TenPhong]) => ({ MaPhong, TenPhong })));
        assert.ok(Array.isArray(await json(request, '/api/phong-chieu', { cookie })));
        await json(request, filmPath + '/tuy-chon', undefined, 401);
        await json(request, '/api/phong-chieu/tuy-chon', undefined, 401);
      });

      await t.test('movie Excel exported from page 2 retains original rows, order, dates and genre strings', async () => {
        const first = await json(request, filmPath, { cookie, query: movieQuery });
        assert.equal(first.total, 35);
        assert.equal(first.items.length, 25);
        await db.query(`UPDATE Phim SET TenPhim = 'Đã đổi tên' WHERE MaPhim = 'GP002'`);
        const viewed = await nextPage(request, filmPath, cookie, first);
        const book = await download(request, filmPath + '/xuat', cookie, first.snapshotId);
        assert.equal(book.getWorksheet(1).name, 'Phim');
        const ordered = movies.slice().sort((a, b) => b.NgayKhoiChieu.localeCompare(a.NgayKhoiChieu) ||
          a.TenPhim.localeCompare(b.TenPhim, 'vi') || a.MaPhim.localeCompare(b.MaPhim));
        assert.deepEqual(viewed.map(row => row.MaPhim), ordered.map(row => row.MaPhim));
        assert.deepEqual(sheetRows(book, 1), ordered.map(row => [row.MaPhim, row.TenPhim, row.TheLoai, row.DaoDien,
          row.ThoiLuong, excelDate(row.NgayKhoiChieu), row.DoTuoiChoPhep]));
        const refreshed = await json(request, filmPath, { cookie, query: movieQuery });
        assert.equal(refreshed.total, 34);
        assert.notEqual(refreshed.snapshotId, first.snapshotId);
        const missing = await json(request, filmPath, { cookie, query: { ...movieQuery, maPhim: 'GP0' } });
        assert.deepEqual(missing.items, []);
        await json(request, filmPath, { cookie, query: { phutMin: 120, phutMax: 100 } }, 400);
        await json(request, showPath + '/xuat', { cookie, query: { snapshotId: first.snapshotId } }, 403);
        await db.query(`UPDATE Phim SET TenPhim = 'Đêm Trăng B' WHERE MaPhim = 'GP002'`);
      });

      await t.test('showtime Excel retains joined names and the midnight suffix in exact page order', async () => {
        const first = await json(request, showPath, { cookie, query: showQuery });
        assert.equal(first.total, 32);
        assert.equal(first.items.length, 25);
        const { sort, ...filters } = showQuery;
        const defaultOrder = await json(request, showPath, { cookie, query: { ...filters, maPhong: 'R01' } });
        const expectedDefault = shows.filter(row => row.MaPhong === 'R01').slice()
          .sort((a, b) => a.NgayChieu.localeCompare(b.NgayChieu) || a.GioBatDau.localeCompare(b.GioBatDau) ||
            a.MaSuatChieu.localeCompare(b.MaSuatChieu));
        assert.deepEqual(defaultOrder.items.map(row => row.MaSuatChieu), expectedDefault.map(row => row.MaSuatChieu));

        await db.query(`UPDATE PhongChieu SET TenPhong = 'Ánh A mới' WHERE MaPhong = 'R02'`);
        const viewed = await nextPage(request, showPath, cookie, first);
        const book = await download(request, showPath + '/xuat', cookie, first.snapshotId);
        assert.equal(book.getWorksheet(1).name, 'Suất chiếu');
        const ordered = shows.slice().sort((a, b) => roomNames.get(a.MaPhong).localeCompare(roomNames.get(b.MaPhong), 'vi') ||
          a.NgayChieu.localeCompare(b.NgayChieu) || a.GioBatDau.localeCompare(b.GioBatDau) ||
          a.MaSuatChieu.localeCompare(b.MaSuatChieu));
        assert.deepEqual(viewed.map(row => row.MaSuatChieu), ordered.map(row => row.MaSuatChieu));
        const exported = sheetRows(book, 1);
        assert.deepEqual(exported, ordered.map(row => [row.MaSuatChieu, 'Đêm Trăng A', roomNames.get(row.MaPhong), excelDate(row.NgayChieu),
          row.GioBatDau, row.GioKetThuc + (row.GioKetThuc < row.GioBatDau ? ' (+1 ngày)' : ''), Number(row.GiaVe), statusLabels[row.TrangThai]]));
        assert.equal(exported.find(row => row[0] === 'GS001')[5], '01:15:00 (+1 ngày)');
        const exact = await json(request, showPath, { cookie, query: { maSuatChieu: 'GS001' } });
        assert.equal(exact.items[0].TenPhong, 'Ánh A mới');
        await json(request, showPath, { cookie, query: { gioTu: '21:00', gioDen: '18:00' } }, 400);
        await json(request, showPath, { cookie, query: { trangThai: 'Sai' } }, 400);
      });

      await t.test('authenticated movie and showtime CRUD still work and cross-midnight clashes are rejected', async () => {
        const created = movie(101, { TheLoai: 'Phiêu lưu, Tình cảm' });
        await json(request, filmPath, { cookie, method: 'POST', data: created }, 201);
        const renamed = { ...created, TenPhim: 'Tên phim mới', ThoiLuong: 135 };
        await json(request, filmPath + '/' + created.MaPhim, { cookie, method: 'PUT', data: renamed });
        const options = await json(request, filmPath + '/tuy-chon', { cookie });
        assert.deepEqual(options.phim.find(row => row.MaPhim === created.MaPhim),
          { MaPhim: created.MaPhim, TenPhim: renamed.TenPhim, ThoiLuong: renamed.ThoiLuong });
        const scheduled = show(101, { MaPhim: created.MaPhim, MaPhong: 'R03', NgayChieu: '2035-03-01',
          GioBatDau: '23:40', GioKetThuc: '01:55', GiaVe: 90000 });
        await json(request, showPath, { cookie, method: 'POST', data: scheduled }, 201);
        await json(request, showPath, { cookie, method: 'POST', data: {
          ...scheduled, MaSuatChieu: 'GS102', NgayChieu: '2035-03-02', GioBatDau: '00:30', GioKetThuc: '02:45'
        } }, 409);
        await json(request, showPath + '/GS101', { cookie, method: 'PUT', data: { ...scheduled, GiaVe: 95000 } });
        await json(request, filmPath + '/' + created.MaPhim, { cookie, method: 'DELETE' }, 409);
        await json(request, showPath + '/GS101', { cookie, method: 'DELETE' });
        await json(request, filmPath + '/' + created.MaPhim, { cookie, method: 'DELETE' });
        const remaining = await json(request, filmPath, { cookie, query: { maPhim: created.MaPhim } });
        assert.equal(remaining.total, 0);
      });
    });
  });
});
