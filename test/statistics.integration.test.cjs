'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { sql, withSchema, withApplication, json, signIn, signUp, download, sheetRows } = require('./fixtures/mysql-app.cjs');

const skip = process.env.MYSQL_INTEGRATION_TESTS !== '1' && 'Run with MYSQL_INTEGRATION_TESTS=1 for disposable schemas on local MySQL.';
const stats = '/api/thong-ke';
const filmsPath = stats + '/theo-phim';
const combosPath = stats + '/theo-combo';
const exportPath = stats + '/xuat';
const dates = { tuNgay: '2032-01-31', denNgay: '2032-02-02' };
const firstDay = dates.tuNgay;
const middleDay = '2032-02-01';
const lastDay = dates.denNgay;
const movieQuery = { q: '  LAT   mat  ', soVeMin: 2, soVeMax: 4, doanhThuMin: 200, doanhThuMax: 1801.5,
  sort: 'soVe:desc,doanhThu:desc' };
const comboQuery = { q: '  SUAT    bap ', soLuongMin: 4, soLuongMax: 9, doanhThuMin: 700, doanhThuMax: 1200,
  sort: 'doanhThu:desc,soLuong:desc' };
const compareText = new Intl.Collator('vi', { sensitivity: 'base' }).compare;
const valueTotal = values => values.reduce((total, value) => total + value, 0);
const toDate = date => new Date(date + 'T00:00:00Z');

function movie(index, prices, extra = {}) {
  const key = String(index).padStart(2, '0');
  return { code: 'M' + key, name: 'Lật Mặt ' + (index === 2 ? '01' : key), prices,
    date: index % 2 ? firstDay : (index % 4 ? middleDay : lastDay), status: 'KetThuc', ...extra };
}

function combo(index, count, revenue, extra = {}) {
  const key = String(index).padStart(2, '0');
  return { code: 'B' + key, name: 'Suất Bắp ' + key, count, revenue, ...extra };
}

function movieRow(item) {
  return { MaPhim: item.code, TenPhim: item.name, SoVe: item.prices.length, DoanhThu: valueTotal(item.prices) };
}

function comboRow(item) {
  return { MaCombo: item.code, TenCombo: item.name, SoLuong: item.count, DoanhThu: item.revenue };
}

function orderMovies(a, b) {
  return b.SoVe - a.SoVe || b.DoanhThu - a.DoanhThu || compareText(a.TenPhim, b.TenPhim) || a.MaPhim.localeCompare(b.MaPhim);
}

function orderCombos(a, b) {
  return b.DoanhThu - a.DoanhThu || b.SoLuong - a.SoLuong || compareText(a.TenCombo, b.TenCombo) || a.MaCombo.localeCompare(b.MaCombo);
}

async function seed(db) {
  await db.query(sql('createTable.sql'));
  await db.query(sql('create_tai_khoan.sql'));
  const matchedMovies = Array.from({ length: 32 }, (_, index) => {
    const n = index + 1;
    const prices = Array(n < 31 ? (n > 4 && n % 5 === 0 ? 4 : 3) : 2).fill(n < 3 ? 100 : 100 + n);
    return movie(n, n === 32 ? [900.5, 901] : prices);
  });
  const inPeriodMovies = [...matchedMovies,
    movie(33, [200, 200, 200], { name: 'Chuyến tàu' }), movie(34, [480]),
    movie(35, [90, 90]), movie(36, [90, 90, 90, 90, 90]), movie(37, [900.5, 901.5])];
  const allMovies = [...inPeriodMovies, movie(38, [50000], { status: 'Huy' }),
    movie(39, [60000], { date: '2032-01-30' }), movie(40, [70000], { date: '2032-02-03' })];

  const eligibleCombos = Array.from({ length: 33 }, (_, index) => {
    const n = index + 1;
    return combo(n, n <= 3 ? (n === 1 ? 8 : 9) : 4 + n % 5, n <= 3 ? 1200 : 700.5 + n * 11);
  });
  const firstInvoice = [...eligibleCombos, combo(34, 5, 1000, { name: 'Nước riêng' }), combo(35, 3, 950),
    combo(36, 5, 699.5), combo(37, 10, 720), combo(38, 5, 1200.5)];
  const lastInvoice = [combo(39, 1, 325, { name: 'Phần cuối kỳ' })];
  const outsideInvoices = [combo(40, 7, 85000), combo(41, 8, 95000)];

  await db.query(`
    INSERT INTO PhongChieu (MaPhong, TenPhong, SoGhe) VALUES ('P1', 'Phòng kiểm thử', 7);
    INSERT INTO KhachHang (MaKhachHang, TenKhachHang, SoDienThoai) VALUES ('K1', 'Khách kiểm thử', '0901234567');
  `);
  await db.query('INSERT INTO Ghe (MaGhe, MaPhong, SoHang, SoGhe) VALUES ?', [
    Array.from({ length: 7 }, (_, index) => ['G' + String(index + 1).padStart(3, '0'), 'P1', 'A', index + 1])
  ]);
  await db.query('INSERT INTO Phim (MaPhim, TenPhim, TheLoai, ThoiLuong, NgayKhoiChieu) VALUES ?', [
    allMovies.map(item => [item.code, item.name, 'Hành động', 110, '2031-01-01'])
  ]);
  await db.query(`INSERT INTO SuatChieu
    (MaSuatChieu, MaPhim, MaPhong, NgayChieu, GioBatDau, GioKetThuc, TrangThai) VALUES ?`, [
    allMovies.map(item => ['SC' + item.code, item.code, 'P1', item.date, '20:00:00', '21:50:00', item.status])
  ]);
  await db.query('INSERT INTO Ve (MaVe, MaSuatChieu, MaKhachHang, MaGhe, NgayDat, GiaVe, TrangThai) VALUES ?', [
    allMovies.flatMap(item => item.prices.map((price, index) =>
      ['V' + item.code + '_' + index, 'SC' + item.code, 'K1', 'G' + String(index + 1).padStart(3, '0'), index ? '2032-01-30 10:00:00'
        : '2032-01-31 19:00:00', price, index % 2 ? 'DaDat' : 'DaSuDung']))
      .concat([['VOID', 'SCM01', 'K1', 'G001', '2032-01-31 11:00:00', 99000, 'DaHuy']])
  ]);
  await db.query('INSERT INTO BapNuoc (MaCombo, TenCombo, GiaCombo) VALUES ?', [
    [...firstInvoice, ...lastInvoice, ...outsideInvoices].map(item => [item.code, item.name, 1])
  ]);
  await db.query(`INSERT INTO DauHoaDon (MaHoaDon, MaKhachHang, NgayMua) VALUES
    ('HD01', 'K1', '2032-01-31 23:59:00'), ('HD02', 'K1', '2032-02-02 23:59:59'),
    ('HD03', 'K1', '2032-01-30 23:59:59'), ('HD04', 'K1', '2032-02-03 00:00:00')`);
  await db.query('INSERT INTO HoaDon (MaHoaDon, MaKhachHang, MaCombo, SoLuongCombo, NgayMua, TongTien) VALUES ?', [
    firstInvoice.map((item, index) => ['HD01', 'K1', item.code, item.count, index % 2 ? '2032-02-01 00:10:00'
      : '2032-01-31 23:59:00', item.revenue]).concat(
      lastInvoice.map(item => ['HD02', 'K1', item.code, item.count, '2032-02-03 00:10:00', item.revenue]),
      outsideInvoices.map((item, index) => ['HD0' + (3 + index), 'K1', item.code, item.count, '2032-01-31 00:10:00', item.revenue]))
  ]);
  const dayRows = [[firstDay, firstInvoice], [middleDay, []], [lastDay, lastInvoice]].map(([Ngay, parts]) => {
    const tickets = inPeriodMovies.filter(item => item.date === Ngay).flatMap(item => item.prices);
    const DoanhThuVe = valueTotal(tickets);
    const DoanhThuBapNuoc = valueTotal(parts.map(item => item.revenue));
    return { Ngay, SoVe: tickets.length, DoanhThuVe, SoHoaDon: parts.length ? 1 : 0,
      DoanhThuBapNuoc, TongDoanhThu: DoanhThuVe + DoanhThuBapNuoc };
  });
  const totalOf = rows => Object.fromEntries(Object.keys(dayRows[0]).filter(key => key !== 'Ngay')
    .map(key => [key, valueTotal(rows.map(row => row[key]))]));
  const monthRows = [{ Thang: '2032-01', ...totalOf(dayRows.slice(0, 1)) }, { Thang: '2032-02', ...totalOf(dayRows.slice(1)) }];
  return {
    dayRows, monthRows, total: totalOf(dayRows), movieRows: matchedMovies.map(movieRow).sort(orderMovies),
    comboRows: eligibleCombos.map(comboRow).sort(orderCombos)
  };
}

function exportFilters(prefix, query) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [
    prefix + key[0].toUpperCase() + key.slice(1), value
  ]));
}

function metrics(row) {
  return [row.SoVe, row.DoanhThuVe, row.SoHoaDon, row.DoanhThuBapNuoc, row.TongDoanhThu];
}

function checkWorkbook(book, mode, expected, movies, combos) {
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['Tổng quan',
    mode === 'month' ? 'Theo tháng' : 'Theo ngày', 'Theo phim', 'Theo combo']);
  assert.deepEqual(sheetRows(book, 1), [[toDate(firstDay), toDate(lastDay), ...metrics(expected.total)]]);
  const timeline = mode === 'month' ? expected.monthRows : expected.dayRows;
  assert.deepEqual(sheetRows(book, 2), timeline.map(row => [toDate(row.Ngay ?? row.Thang + '-01'), ...metrics(row)]));
  assert.deepEqual(sheetRows(book, 3), movies.map(row => [row.MaPhim, row.TenPhim, row.SoVe, row.DoanhThu]));
  assert.deepEqual(sheetRows(book, 4), combos.map(row => [row.MaCombo, row.TenCombo, row.SoLuong, row.DoanhThu]));
}

test('Statistics period, independently filtered rankings and four-sheet export agree on MySQL', { skip }, async t => {
  await withSchema(async (db, schema) => {
    const expected = await seed(db);
    await withApplication(schema, async request => {
      await signUp(request, 'statistics_staff');
      const cookie = await signIn(request, 'statistics_staff');
      const other = await signIn(request, 'statistics_staff');
      const period = query => json(request, stats, { cookie, query: { tomTat: 1, ...query } });
      const summary = await period(dates);
      const snapshotId = summary.snapshotId;
      const list = (route, query, page = 1, id = snapshotId) =>
        json(request, route, { cookie, query: { ...query, snapshotId: id, page } });
      const films = page => list(filmsPath, movieQuery, page);
      const combos = page => list(combosPath, comboQuery, page);

      await t.test('keeps full-period totals, day and month buckets on the right date and counts each invoice once', async () => {
        assert.ok(snapshotId);
        assert.deepEqual([summary.TuNgay, summary.DenNgay], [firstDay, lastDay]);
        assert.deepEqual(summary.TongQuan, expected.total);
        assert.deepEqual(summary.TheoNgay, expected.dayRows);
        assert.deepEqual(summary.TheoThang, expected.monthRows);
        assert.equal(summary.TheoPhim, undefined);
        assert.equal(summary.TheoCombo, undefined);
        const sameDay = await period({ tuNgay: firstDay, denNgay: firstDay });
        assert.equal(sameDay.TongQuan.SoHoaDon, 1);
        assert.equal(sameDay.TongQuan.DoanhThuBapNuoc, expected.dayRows[0].DoanhThuBapNuoc);
        const legacy = await json(request, stats, { cookie, query: dates });
        assert.ok(legacy.TheoCombo.length > 25 && legacy.TheoPhim.length > 25);
        assert.deepEqual(legacy.TongQuan, expected.total);
      });

      await t.test('orders stable independent result sets, exact codes, and scaling before pagination', async () => {
        const [film1, combo1, film2, combo2] = await Promise.all([films(1), combos(1), films(2), combos(2)]);
        assert.deepEqual([film1.items.length, film2.items.length, combo1.items.length, combo2.items.length], [25, 7, 25, 8]);
        assert.deepEqual([film2.page, combo2.page, film1.total, combo1.total], [2, 2, 32, 33]);
        assert.ok([film1, film2, combo1, combo2].every(result => result.snapshotId === snapshotId && result.pageSize === 25));
        assert.deepEqual([...film1.items, ...film2.items], expected.movieRows);
        assert.deepEqual([...combo1.items, ...combo2.items], expected.comboRows);
        assert.ok(film1.items.every(row => row.DoanhThu < film1.meta.maxRevenue));
        assert.equal(film1.meta.maxRevenue, 1801.5);
        assert.equal(film2.meta.maxRevenue, film1.meta.maxRevenue);
        assert.equal(combo1.meta.maxRevenue, 1200);
        assert.equal(combo2.meta.maxRevenue, combo1.meta.maxRevenue);
        assert.deepEqual(combo1.items.slice(0, 3).map(row => row.MaCombo), ['B02', 'B03', 'B01']);

        assert.deepEqual((await list(filmsPath, { maPhim: ' M01 ' })).items.map(row => row.MaPhim), ['M01']);
        assert.deepEqual((await list(filmsPath, { maPhim: 'M0' })).items, []);
        assert.deepEqual((await list(combosPath, { maCombo: 'B02', q: 'SUẤT BẮP' })).items.map(row => row.MaCombo), ['B02']);
        assert.deepEqual((await list(combosPath, { q: 'b02' })).items.map(row => row.MaCombo), ['B02']);
        assert.deepEqual((await list(combosPath, { maCombo: 'B02', q: 'B03' })).items, []);
        assert.deepEqual((await list(filmsPath, { doanhThuMin: '1801.50', doanhThuMax: '1801.50' })).items.map(row => row.MaPhim), ['M32']);
        const defaultOrder = await list(filmsPath, { q: 'LAT MAT 01' });
        assert.deepEqual(defaultOrder.items.map(row => row.MaPhim), ['M01', 'M02']);
      });

      await t.test('reads both XLSX modes against every page with different active filters and frozen original values', async () => {
        const [film1, film2, combo1, combo2] = await Promise.all([films(1), films(2), combos(1), combos(2)]);
        const movies = [...film1.items, ...film2.items];
        const parts = [...combo1.items, ...combo2.items];
        const criteria = { ...exportFilters('phim', movieQuery), ...exportFilters('combo', comboQuery) };
        await db.query(`
          UPDATE Phim SET TenPhim = 'Tên đã cập nhật' WHERE MaPhim = 'M01';
          UPDATE Ve SET GiaVe = GiaVe + 1234 WHERE MaVe = 'VM32_0';
          UPDATE HoaDon SET TongTien = TongTien + 5000 WHERE MaHoaDon = 'HD01' AND MaCombo = 'B02';
        `);
        const monthly = await download(request, exportPath, cookie, snapshotId, { ...criteria, mode: 'month' });
        const daily = await download(request, exportPath, cookie, snapshotId, { ...criteria, mode: 'day' });
        checkWorkbook(monthly, 'month', expected, movies, parts);
        checkWorkbook(daily, 'day', expected, movies, parts);
        assert.deepEqual((await films(2)).items, film2.items);
        assert.deepEqual((await combos(2)).items, combo2.items);
        const refreshed = await period(dates);
        assert.notEqual(refreshed.snapshotId, snapshotId);
        assert.equal(refreshed.TongQuan.DoanhThuVe, expected.total.DoanhThuVe + 1234);
        assert.equal(refreshed.TongQuan.DoanhThuBapNuoc, expected.total.DoanhThuBapNuoc + 5000);
        assert.equal((await list(filmsPath, { maPhim: 'M01' }, 1, refreshed.snapshotId)).items[0].TenPhim, 'Tên đã cập nhật');
      });

      await t.test('exports empty rankings as header-only sheets and rejects invalid, expired or foreign state', async () => {
        const empty = await list(filmsPath, { maPhim: 'MISSING' });
        assert.deepEqual([empty.total, empty.items, empty.meta.maxRevenue], [0, [], 0]);
        const emptyBook = await download(request, exportPath, cookie, snapshotId, { phimMaPhim: 'MISSING', comboMaCombo: 'MISSING' });
        checkWorkbook(emptyBook, 'day', expected, [], []);
        assert.equal(emptyBook.getWorksheet(3).getRow(1).getCell(1).value, 'Mã phim');
        assert.equal(emptyBook.getWorksheet(4).getRow(1).getCell(1).value, 'Mã combo');
        const missingPeriod = await period({ tuNgay: '2040-01-01', denNgay: '2040-01-01' });
        assert.deepEqual(missingPeriod.TheoNgay, []);
        assert.deepEqual(missingPeriod.TheoThang, []);
        assert.equal(missingPeriod.TongQuan.TongDoanhThu, 0);

        await json(request, stats, { cookie, query: { tuNgay: '2032-01-01', denNgay: '2033-01-02' } }, 400);
        await json(request, stats, { cookie, query: { tuNgay: '2032-02-30', denNgay: '2032-03-01' } }, 400);
        await json(request, filmsPath, { cookie, query: { snapshotId, soVeMin: 4, soVeMax: 2 } }, 400);
        await json(request, combosPath, { cookie, query: { snapshotId, sort: 'doanhThu:asc,doanhThu:desc' } }, 400);
        await json(request, filmsPath, { cookie, query: { snapshotId, page: 99 } }, 400);
        await json(request, exportPath, { cookie, query: { snapshotId, mode: 'week' } }, 400);
        await json(request, exportPath, { cookie, query: { snapshotId, phimPage: 2 } }, 400);
        for (const route of [filmsPath, combosPath, exportPath]) {
          await json(request, route, { query: { snapshotId } }, 401);
          await json(request, route, { cookie: other, query: { snapshotId } }, 403);
          await json(request, route, { cookie, query: { snapshotId: randomUUID() } }, 410);
        }
      });
    });
  });
});
