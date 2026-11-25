'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { createSnapshotList } = require('../server/snapshot-list.cjs');
const { normalizeSearchText } = require('../server/list-query.cjs');
const { createSnapshotStore } = require('../server/list-snapshots.cjs');

const options = {
  searchColumns: ['r.tenTim', 'r.nhomTim'],
  filters: {
    ten: { type: 'text', column: 'r.tenTim', operator: 'contains' },
    trangThai: { type: 'enum', column: 'r.trangThai', multiple: true, values: ['DaDat', 'DaSuDung', 'DaHuy'] },
    giaMin: { type: 'decimal', column: 'r.gia', operator: '>=' },
    denNgay: { type: 'date', column: 'r.ngay', operator: 'throughDate' }
  },
  sort: { gia: 'r.gia', ngay: 'r.ngay', ma: 'r.ma' },
  defaultSort: 'ma:asc',
  tieBreakers: ['r.ma']
};

const criteria = {
  q: ' ĐẶNG   THÙY ', ten: 'Đặng', trangThai: ['DaDat', 'DaSuDung'],
  giaMin: '10.00', denNgay: '2026-11-25', sort: 'gia:desc,ngay:asc', pageSize: '25'
};

function row(number) {
  const ma = 'V' + String(number).padStart(4, '0');
  const ten = number % 2 ? 'Đặng  Thùy' : 'Đặng Nguyễn';
  return {
    ma, ten, tenTim: normalizeSearchText(ten), nhomTim: 'thuy',
    ngay: number % 3 ? '2026-11-25 23:59:59' : '2026-11-24 10:00:00',
    trangThai: number % 2 ? 'DaDat' : 'DaSuDung', gia: number % 4 + 15,
    dienThoai: '0901234567'
  };
}

const rowOrder = (a, b) => b.gia - a.gia || a.ngay.localeCompare(b.ngay) || a.ma.localeCompare(b.ma);
const columnsFor = ({ ma, ten, gia, ngay, dienThoai }) => [ma, ten, gia, ngay, dienThoai];

async function request(handler, query, { sessionId = 'session-a', scope = 'suat-a' } = {}) {
  const response = {
    statusCode: 200,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    attachment(filename) { this.headers.filename = filename; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; }
  };
  await handler({ query, params: { scope }, sessionID: sessionId, session: sessionId ? { user: {} } : {} }, response);
  return response;
}

function fixture(pool, select, paginated = true) {
  let now = 0;
  let reads = 0;
  const data = Array.from({ length: 100 }, (_, index) => row(index + 1));
  const details = { V0001: ['C1', 'C2'] };
  data.push({ ...row(103), trangThai: 'DaHuy' }, { ...row(104), gia: 5 },
    { ...row(105), ngay: '2026-11-26 00:00:00' }, { ...row(106), tenTim: 'mai', nhomTim: 'mai' });

  const handlers = createSnapshotList({
    pool, store: createSnapshotStore({ ttlMs: 100, now: () => now }),
    scope: req => `fixture:${req.params.scope}`, query: options, paginated,
    async load(connection, selection) {
      reads++;
      const items = await select(connection, selection, data);
      const report = items.flatMap(item => (details[item.ma] ?? ['C1']).map(combo => [item.ma, combo]));
      return { items, report };
    },
    workbook: ({ items, report }) => ({
      filename: 'du-lieu-thu',
      sheets: [
        { name: 'Danh sách', columns: [['Mã', 16], ['Tên', 25], ['Giá', 18, '0.00'], ['Ngày', 20], ['Điện thoại', 16]], rows: items.map(columnsFor) },
        { name: 'Chi tiết', columns: [['Mã', 16], ['Combo', 16]], rows: report }
      ]
    })
  });
  return { ...handlers, data, details, expire: () => { now = 100; }, readCount: () => reads };
}

async function workbookRows(bytes) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook.worksheets.map(sheet => sheet.getRows(2, sheet.rowCount - 1).map(row => row.values.slice(1)));
}

const fakePool = {
  async getConnection() {
    return { query: async () => {}, commit: async () => {}, release() {} };
  }
};

async function inMemorySelect(_connection, selection, rows) {
  const filter = selection.filters;
  return rows.filter(item => item.tenTim.includes(filter.ten) && item.nhomTim.includes('thuy') &&
    filter.trangThai.includes(item.trangThai) && item.gia >= Number(filter.giaMin) &&
    item.ngay.slice(0, 10) <= filter.denNgay).sort(rowOrder);
}

async function verifyPagedSnapshot(pool, select) {
  const source = fixture(pool, select);
  const initial = source.data.slice(0, 100).sort(rowOrder).map(columnsFor);
  const initialDetails = initial.flatMap(([ma]) => (source.details[ma] ?? ['C1']).map(combo => [ma, combo]));
  const first = (await request(source.list, criteria)).body;
  assert.equal(first.total, 100);
  assert.equal(first.pageSize, 25);

  source.data[0].ten = 'Đặng Thùy đã sửa';
  source.data[0].gia = 99;
  source.data.splice(1, 1);
  source.data.push(row(101), row(102));
  source.details.V0001.push('SAU-KHI-TAI');

  const { snapshotId } = first;
  const viewed = [...first.items];
  let file;
  for (let page = 2; page <= 4; page++) {
    const response = await request(source.list, { snapshotId, page: String(page), pageSize: '25' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.total, 100);
    assert.equal(response.body.snapshotId, snapshotId);
    viewed.push(...response.body.items);
    if (page === 2) file = await request(source.exportXlsx, { snapshotId });
  }
  assert.equal(file.headers.filename, 'du-lieu-thu.xlsx');
  assert.equal(file.headers['Cache-Control'], 'no-store');
  assert.equal(file.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const sheets = await workbookRows(file.body);
  assert.deepEqual(viewed.map(columnsFor), initial);
  assert.deepEqual(sheets[0], initial);
  assert.deepEqual(sheets[1], initialDetails);
  assert.equal(source.readCount(), 1);

  const refreshed = (await request(source.list, criteria)).body;
  assert.notEqual(refreshed.snapshotId, snapshotId);
  assert.equal(refreshed.total, 101);
  assert.equal(refreshed.items[0].ten, 'Đặng Thùy đã sửa');
  assert.equal(source.readCount(), 2);

  assert.equal((await request(source.list, { snapshotId, q: 'changed' })).statusCode, 400);
  assert.equal((await request(source.list, { snapshotId, page: '5' })).body.code, 'INVALID_SNAPSHOT_PAGE');
  assert.equal((await request(source.list, { snapshotId: '-'.repeat(36) })).body.code, 'INVALID_LIST_QUERY');
  assert.equal((await request(source.exportXlsx, { snapshotId, page: '2' })).statusCode, 400);
  assert.equal((await request(source.exportXlsx, { snapshotId }, { sessionId: 'session-b' })).statusCode, 403);
  assert.equal((await request(source.list, { snapshotId }, { scope: 'suat-b' })).statusCode, 403);
  assert.equal((await request(source.exportXlsx, { snapshotId }, { sessionId: null })).statusCode, 401);
  source.expire();
  assert.equal((await request(source.list, { snapshotId, page: '2' })).body.code, 'SNAPSHOT_EXPIRED');
  assert.equal((await request(source.exportXlsx, { snapshotId })).statusCode, 410);
  assert.equal(source.readCount(), 2);
}

test('frozen list and XLSX use the same 100 rows, original values, order, and detail sheet', async () => {
  await verifyPagedSnapshot(fakePool, inMemorySelect);
});

test('one-page list exports its entire frozen result and an empty list can return zero rows', async () => {
  const source = fixture(fakePool, inMemorySelect, false);
  const data = (await request(source.list, criteria)).body;
  assert.equal(data.pageSize, 100);
  assert.equal(data.items.length, 100);
  source.data[0].gia = 99;
  const output = await request(source.exportXlsx, { snapshotId: data.snapshotId });
  assert.deepEqual((await workbookRows(output.body))[0], data.items.map(columnsFor));
  assert.equal((await request(source.list, { ...criteria, page: '2' })).statusCode, 400);
  const empty = (await request(source.list, { ...criteria, giaMin: '1000' })).body;
  assert.deepEqual(empty.items, []);
  assert.equal(empty.total, 0);
});

test('read-only MySQL query applies every condition and order before snapshot paging/export', {
  skip: process.env.MYSQL_INTEGRATION_TESTS !== '1' && 'Run with MYSQL_INTEGRATION_TESTS=1 and the local database configuration.'
}, async () => {
  const mysql = require('mysql2/promise');
  const host = process.env.DB_HOST || '127.0.0.1';
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'The fixture uses the local MySQL server.');
  const pool = mysql.createPool({
    host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, charset: 'utf8mb4',
    connectTimeout: 3000, connectionLimit: 1
  });
  try {
    await verifyPagedSnapshot(pool, async (connection, { conditions, params, orderBy }, data) => {
      const [rows] = await connection.execute(`
        SELECT r.ma, r.ten, DATE_FORMAT(r.ngay, '%Y-%m-%d %H:%i:%s') AS ngay, r.dienThoai,
               CAST(r.gia AS UNSIGNED) AS gia
        FROM JSON_TABLE(?, '$[*]' COLUMNS (
          ma VARCHAR(15) PATH '$.ma', ten VARCHAR(100) PATH '$.ten',
          tenTim VARCHAR(100) PATH '$.tenTim', nhomTim VARCHAR(100) PATH '$.nhomTim',
          ngay DATETIME PATH '$.ngay', dienThoai VARCHAR(15) PATH '$.dienThoai',
          trangThai VARCHAR(20) PATH '$.trangThai', gia DECIMAL(18,2) PATH '$.gia'
        )) AS r
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${orderBy}
      `, [JSON.stringify(data), ...params]);
      return rows;
    });
  } finally {
    await pool.end();
  }
});
