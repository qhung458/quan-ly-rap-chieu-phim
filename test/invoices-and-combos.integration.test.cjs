'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sql, withSchema, withApplication, json, signIn, signUp, download, sheetRows } = require('./fixtures/mysql-app.cjs');

const skip = process.env.MYSQL_INTEGRATION_TESTS !== '1' && 'Run with MYSQL_INTEGRATION_TESTS=1 and local MySQL credentials for disposable schemas.';

test('Invoice migration backfills one header per code, supports reruns, and enforces the customer key', { skip }, async () => {
  await withSchema(async (db, schema) => {
    await db.query(`
      CREATE TABLE KhachHang (MaKhachHang VARCHAR(10) PRIMARY KEY);
      CREATE TABLE BapNuoc (MaCombo VARCHAR(10) PRIMARY KEY);
      CREATE TABLE HoaDon (
        MaHoaDon VARCHAR(15) NOT NULL,
        MaKhachHang VARCHAR(10) NOT NULL,
        MaCombo VARCHAR(10) NOT NULL,
        SoLuongCombo INT NOT NULL,
        NgayMua DATETIME NOT NULL,
        TongTien DECIMAL(18,2) NOT NULL,
        PRIMARY KEY (MaHoaDon, MaKhachHang, MaCombo),
        CONSTRAINT FK_HoaDon_KhachHang FOREIGN KEY (MaKhachHang) REFERENCES KhachHang(MaKhachHang),
        CONSTRAINT FK_HoaDon_BapNuoc FOREIGN KEY (MaCombo) REFERENCES BapNuoc(MaCombo)
      );
      INSERT INTO KhachHang VALUES ('K1'), ('K2');
      INSERT INTO BapNuoc VALUES ('C1'), ('C2');
      INSERT INTO HoaDon VALUES ('HD100', 'K1', 'C1', 1, '2032-02-25 23:58:00', 75000),
                                ('HD100', 'K1', 'C2', 1, '2032-02-26 00:03:00', 60000);
    `);
    await db.query('ALTER DATABASE ?? COLLATE utf8mb4_unicode_ci', [schema]);
    const migration = sql('migrate_invoice_headers.sql');
    await db.query(migration);
    const [[firstHead]] = await db.query(`SELECT DATE_FORMAT(NgayMua, '%Y-%m-%d %H:%i:%s') AS Ngay FROM DauHoaDon`);
    assert.equal(firstHead.Ngay, '2032-02-25 23:58:00');
    await db.query(`UPDATE HoaDon SET NgayMua = '2032-02-25 23:57:00' WHERE MaHoaDon = 'HD100' AND MaCombo = 'C1'`);
    await db.query(migration);
    const [heads] = await db.query(`SELECT MaHoaDon, MaKhachHang, DATE_FORMAT(NgayMua, '%Y-%m-%d %H:%i:%s') AS Ngay FROM DauHoaDon`);
    assert.deepEqual(heads, [{ MaHoaDon: 'HD100', MaKhachHang: 'K1', Ngay: '2032-02-25 23:57:00' }]);
    await assert.rejects(db.query(`INSERT INTO HoaDon VALUES ('HD100', 'K2', 'C1', 1, '2032-02-25 23:58:00', 75000)`), { code: 'ER_NO_REFERENCED_ROW_2' });
    await assert.rejects(db.query(`INSERT INTO DauHoaDon (MaHoaDon, MaKhachHang, NgayMua) VALUES ('HD100', 'K2', NOW())`), { code: 'ER_DUP_ENTRY' });
    await db.query(`INSERT INTO DauHoaDon (MaHoaDon, MaKhachHang, NgayMua) VALUES ('HD900', 'K2', NOW());
                    DELETE FROM DauHoaDon WHERE MaHoaDon = 'HD900'`);
    await db.query(migration);
    const [[allocation]] = await db.query('SELECT SoCuoi FROM DayMaHoaDon WHERE Id = 1');
    assert.equal(Number(allocation.SoCuoi), 900);
    const [[{ total, lineCount }]] = await db.query('SELECT SUM(TongTien) AS total, COUNT(*) AS lineCount FROM HoaDon');
    assert.deepEqual([Number(total), lineCount], [135000, 2]);
  });
});

async function insertInvoices(db, invoices) {
  await db.query('INSERT INTO DauHoaDon (MaHoaDon, MaKhachHang, NgayMua) VALUES ?', [invoices.map(({ id, customer, date }) => [id, customer, date])]);
  await db.query('INSERT INTO HoaDon (MaHoaDon, MaKhachHang, MaCombo, SoLuongCombo, NgayMua, TongTien) VALUES ?', [
    invoices.flatMap(({ id, customer, date, lines }) => lines.map(([code, count, total, boughtAt]) => [id, customer, code, count, boughtAt ?? date, total]))
  ]);
}

function invoiceFixture(index) {
  const id = 'HD' + (1000 + index);
  const customer = 'BUY001';
  const date = index % 2 ? '2032-02-25 23:58:00' : '2032-02-25 10:05:00';
  const lines = index === 1
    ? [['CB07', 1, 80000], ['CB01', 1, 90000, '2032-02-26 00:03:00']]
    : [['CB07', 2, 160000]];
  return { id, customer, date, lines, total: lines.reduce((sum, [, , price]) => sum + price, 0) };
}

const invoiceQuery = {
  q: '  ĐẶNG  THUỲ  ', tenKhachHang: 'dang   thuy',
  tuNgay: '2032-02-25', denNgay: '2032-02-25', tongMin: '150000',
  maCombo: ['CB07', 'CBXX'], sort: 'tongTien:desc,ngayMua:desc', page: 1, pageSize: 25
};

const comboQuery = {
  q: 'bắp  phô', moTa: '  PHO  MAI ', giaMin: '60000', giaMax: '100000', daBanMin: '0',
  sort: 'gia:asc,daBan:desc'
};

test('Invoices and combos support migration-compatible lists, pickers, frozen Excel, writes and stats', { skip }, async t => {
  await withSchema(async (db, schema) => {
    await db.query(sql('createTable.sql'));
    await db.query(sql('addSample.sql'));
    await db.query(sql('create_tai_khoan.sql'));
    const [[seed]] = await db.query('SELECT COUNT(*) AS total FROM DauHoaDon');
    assert.ok(seed.total > 0, 'Bootstrapping a fresh database creates seed heads.');
    await db.query('INSERT INTO KhachHang (MaKhachHang, TenKhachHang, SoDienThoai, Email) VALUES ?', [
      Array.from({ length: 23 }, (_, i) => [
        'BUY' + String(i + 1).padStart(3, '0'), 'Đặng\u00a0  Thuỳ ' + i, '090711' + String(i + 1).padStart(4, '0'), `buyer${i}@example.test`
      ])
    ]);
    await db.query(`UPDATE BapNuoc SET TenCombo = 'Combo Bắp kiểm thử', MoTa = 'Bắp  phô mai', GiaCombo = 80000 WHERE MaCombo = 'CB07'`);
    await db.query('INSERT INTO BapNuoc (MaCombo, TenCombo, GiaCombo, MoTa) VALUES ?', [
      [['CBZ0', 'Bắp chưa bán', 80000, 'Bắp pho\u0302 mai'], ['CBERR', 'Combo gây lỗi kiểm thử', 1000, null]]
    ]);
    const invoices = Array.from({ length: 205 }, (_, index) => invoiceFixture(index + 1));
    await insertInvoices(db, [...invoices, {
      id: 'HD1991', customer: 'BUY001', date: '2032-02-25 10:10:00', lines: [['CB01', 2, 160000]]
    }, {
      id: 'HD1992', customer: 'BUY001', date: '2032-02-25 10:10:00', lines: [['CB07', 1, 80000]]
    }, {
      id: 'HD1993', customer: 'BUY001', date: '2032-02-26 00:00:00', lines: [['CB07', 2, 160000]]
    }]);

    await withApplication(schema, async request => {
      await signUp(request, 'invoice_worker');
      await signUp(request, 'invoice_admin');
      await db.query(`UPDATE TaiKhoan SET VaiTro = 'QuanTriVien' WHERE TenDangNhap = 'invoice_admin'`);
      const cookie = await signIn(request, 'invoice_worker');
      const admin = await signIn(request, 'invoice_admin');

      await t.test('customer lookup loads all matching pages and stays independent from the management snapshot', async () => {
        const query = { q: '   DANG  THUY   ' };
        const first = await json(request, '/api/khach-hang/tuy-chon', { cookie, query });
        const next = await json(request, '/api/khach-hang/tuy-chon', { cookie, query: { ...query, page: 2 } });
        assert.deepEqual([first.total, first.items.length, next.items.length], [23, 20, 3]);
        assert.equal(next.items[0].MaKhachHang, 'BUY021');
        assert.deepEqual(Object.keys(first.items[0]), ['MaKhachHang', 'TenKhachHang', 'SoDienThoai']);
        const exact = await json(request, '/api/khach-hang/tuy-chon', { cookie, query: { ma: 'BUY023' } });
        assert.deepEqual(exact.items.map(row => row.MaKhachHang), ['BUY023']);
        const phone = await json(request, '/api/khach-hang/tuy-chon', { cookie, query: { q: '(0907) 110-023' } });
        assert.deepEqual(phone.items.map(row => row.MaKhachHang), ['BUY023']);
        assert.ok(!Object.hasOwn(first, 'snapshotId'));
        const management = await json(request, '/api/khach-hang', { cookie, query: { ...query, pageSize: 10 } });
        assert.equal(management.total, 23);
        assert.equal(management.items.length, 10);
        assert.ok(management.snapshotId);
        assert.ok(Object.hasOwn(management.items[0], 'Email'));
      });

      await t.test('combo filters and Excel use frozen projected values and the picker remains complete', async () => {
        const result = await json(request, '/api/bap-nuoc', { cookie, query: comboQuery });
        assert.equal(result.total, 2);
        assert.deepEqual(result.items.map(row => row.MaCombo), ['CB07', 'CBZ0']);
        assert.equal(result.items[1].DaBan, 0);
        const options = await json(request, '/api/bap-nuoc/tuy-chon', { cookie });
        assert.ok(options.some(row => row.MaCombo === 'CB01'));
        assert.deepEqual(Object.keys(options[0]), ['MaCombo', 'TenCombo', 'GiaCombo']);
        await db.query(`UPDATE BapNuoc SET GiaCombo = 95000 WHERE MaCombo = 'CB07'`);
        const book = await download(request, '/api/bap-nuoc/xuat', cookie, result.snapshotId);
        assert.deepEqual(sheetRows(book, 1), result.items.map(row => [row.MaCombo, row.TenCombo, row.MoTa, row.GiaCombo, row.DaBan]));
        await json(request, '/api/bap-nuoc/xuat', { cookie: admin, query: { snapshotId: result.snapshotId } }, 403);
        const empty = await json(request, '/api/bap-nuoc', { cookie, query: { ...comboQuery, giaMin: '99000' } });
        assert.deepEqual(empty.items, []);
        await json(request, '/api/bap-nuoc', { cookie, query: { giaMin: '99999', giaMax: '10' } }, 400);
      });

      await t.test('205 invoices and 206 lines export in page order, even after live data changes', async () => {
        const first = await json(request, '/api/hoa-don', { cookie, query: invoiceQuery });
        assert.equal(first.total, 205);
        assert.equal(first.items.length, 25);
        assert.deepEqual([first.items[0].MaHoaDon, first.items[0].TongTien], ['HD1001', 170000]);
        const next = await json(request, '/api/hoa-don', { cookie, query: { snapshotId: first.snapshotId, page: 2 } });
        assert.equal(next.items.length, 25);
        await insertInvoices(db, [invoiceFixture(206)]);
        await db.query(`UPDATE BapNuoc SET TenCombo = 'Bắp đã đổi tên' WHERE MaCombo = 'CB01'`);
        const viewed = [...first.items, ...next.items];
        const book = await download(request, '/api/hoa-don/xuat', cookie, first.snapshotId);
        for (let page = 3; page <= 9; page++) {
          const result = await json(request, '/api/hoa-don', { cookie, query: { snapshotId: first.snapshotId, page } });
          viewed.push(...result.items);
        }
        const ordered = invoices.slice().sort((a, b) => b.total - a.total || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
        const headers = sheetRows(book, 1);
        const details = sheetRows(book, 2);
        assert.deepEqual(headers.map(row => row[0]), ordered.map(row => row.id));
        assert.deepEqual(headers.map(row => row[3].toISOString().slice(0, 16).replace('T', ' ')),
          ordered.map(row => row.date.slice(0, 16)));
        assert.deepEqual(headers.map(row => [row[0], row[1], row[2], row[4], row[5]]),
          viewed.map(row => [row.MaHoaDon, row.MaKhachHang, row.TenKhachHang, row.SoLuong, row.TongTien]));
        assert.equal(details.length, 206);
        assert.deepEqual(details.map(row => [row[0], row[1], row[3], row[4], row[5]]), ordered.flatMap(item =>
          item.lines.slice().sort(([a], [b]) => a.localeCompare(b)).map(([code, count, total]) => [item.id, code, count, total / count, total])
        ));
        assert.notEqual(details[0][2], 'Bắp đã đổi tên');
        const refreshed = await json(request, '/api/hoa-don', { cookie, query: invoiceQuery });
        assert.equal(refreshed.total, 206);
        const detail = await json(request, '/api/hoa-don/HD1001', { cookie });
        assert.deepEqual([detail.TongTien, detail.ChiTiet.length, detail.NgayMua], [170000, 2, '25/02/2032 23:58']);
        await json(request, '/api/hoa-don', { cookie, query: { tuNgay: '2032-02-26', denNgay: '2032-02-25' } }, 400);
        await json(request, '/api/hoa-don/xuat', { cookie: admin, query: { snapshotId: first.snapshotId } }, 403);
      });

      await t.test('stats count the split invoice once and assign all lines to its earliest document date', async () => {
        const summary = await json(request, '/api/thong-ke', { cookie, query: { tuNgay: '2032-02-25', denNgay: '2032-02-26' } });
        const day = summary.TheoNgay.find(row => row.Ngay === '2032-02-25');
        const next = summary.TheoNgay.find(row => row.Ngay === '2032-02-26');
        assert.deepEqual([day.SoHoaDon, day.DoanhThuBapNuoc], [208, 206 * 160000 + 10000 + 160000 + 80000]);
        assert.deepEqual([next.SoHoaDon, next.DoanhThuBapNuoc], [1, 160000]);
        const feb25 = await json(request, '/api/thong-ke', { cookie, query: { tuNgay: '2032-02-25', denNgay: '2032-02-25' } });
        assert.equal(feb25.TheoCombo.find(row => row.MaCombo === 'CB01').DoanhThu, 250000);
        assert.equal(feb25.TheoThang[0].TongDoanhThu, day.TongDoanhThu);
      });

      await t.test('failed detail insert rolls back and a deleted code cannot be issued to another customer', async () => {
        const [[before]] = await db.query('SELECT COUNT(*) AS total FROM DauHoaDon');
        await db.query(`CREATE TRIGGER invoice_fixture_fail BEFORE INSERT ON HoaDon FOR EACH ROW
          BEGIN
            IF NEW.MaCombo = 'CBERR' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'invoice fixture rollback'; END IF;
          END`);
        const order = (customer, combos) => ({ cookie, method: 'POST', data: {
          MaKhachHang: customer, ChiTiet: combos.map(MaCombo => ({ MaCombo, SoLuong: 1 }))
        } });
        const rejected = await request('/api/hoa-don', order('BUY001', ['CB07', 'CBERR']));
        assert.ok(!rejected.ok);
        await rejected.body.cancel();
        const [[after]] = await db.query('SELECT COUNT(*) AS total FROM DauHoaDon');
        assert.equal(after.total, before.total);
        const created = await Promise.all(['BUY001', 'BUY002'].map(customer =>
          json(request, '/api/hoa-don', order(customer, ['CB07', 'CB01']), 201)));
        assert.notEqual(created[0].MaHoaDon, created[1].MaHoaDon);
        assert.deepEqual(created.map(invoice => invoice.ChiTiet.length), [2, 2]);
        const code = created.map(invoice => invoice.MaHoaDon).sort().at(-1);
        await json(request, '/api/hoa-don/' + code, { method: 'DELETE', cookie }, 403);
        assert.equal((await request('/api/hoa-don/' + code, { method: 'DELETE', cookie: admin })).status, 204);
        const [[remaining]] = await db.execute('SELECT COUNT(*) AS total FROM HoaDon WHERE MaHoaDon = ?', [code]);
        assert.equal(remaining.total, 0);
        const later = await json(request, '/api/hoa-don', order('BUY003', ['CB01']), 201);
        assert.ok(Number(later.MaHoaDon.slice(2)) > Number(code.slice(2)));
        await json(request, '/api/hoa-don/' + code, { cookie }, 404);
      });
    });
  });
});
