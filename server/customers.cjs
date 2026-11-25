const express = require('express');
const db = require('./db.cjs');
const { requireLogin, requireAdmin } = require('./auth.cjs');
const { ListQueryError, parseListPagination, parseListQuery, vietnameseSearchColumn } = require('./list-query.cjs');
const { SnapshotError, withConsistentListRead } = require('./list-snapshots.cjs');
const { createSnapshotList } = require('./snapshot-list.cjs');
const snapshotStore = require('./snapshot-store.cjs');

const router = express.Router();
const fields = 'MaKhachHang, TenKhachHang, SoDienThoai, Email';
const codePattern = /^[A-Za-z0-9_-]{1,10}$/;
const notFound = { message: 'Không tìm thấy khách hàng.' };

router.use(requireLogin);

function readCustomer(body) {
  const { TenKhachHang, SoDienThoai, Email } = body ?? {};
  if (typeof TenKhachHang !== 'string' || typeof SoDienThoai !== 'string' ||
      (Email != null && typeof Email !== 'string')) return null;

  const name = TenKhachHang.trim();
  const phone = SoDienThoai.trim();
  const email = Email?.trim() || null;
  if (!name || name.length > 100 || !/^\+?[0-9]{8,15}$/.test(phone) || phone.length > 15 ||
      (email && (email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
    return null;
  }

  return { TenKhachHang: name, SoDienThoai: phone, Email: email };
}

const nameSearch = vietnameseSearchColumn('k.TenKhachHang');
const customerSearch = {
  accentInsensitive: true,
  searchColumns: [vietnameseSearchColumn('k.MaKhachHang'), nameSearch],
  phoneColumn: 'k.SoDienThoai'
};
const emailText = "REGEXP_REPLACE(CONVERT(k.Email USING utf8mb4), '^[[:space:]\ufeff]+|[[:space:]\ufeff]+$', '')";

const customerList = createSnapshotList({
  store: snapshotStore,
  pool: db,
  scope: 'khach-hang',
  query: {
    ...customerSearch,
    searchColumns: [...customerSearch.searchColumns, vietnameseSearchColumn('k.Email')],
    filters: {
      maKhachHang: { type: 'exact', column: 'k.MaKhachHang', maxLength: 10 },
      ten: { type: 'text', column: nameSearch, operator: 'contains' },
      soDienThoai: { type: 'phone', column: 'k.SoDienThoai' },
      email: { type: 'exact' },
      coEmail: { type: 'boolean' },
      veTuNgay: { type: 'date' },
      veDenNgay: { type: 'date' }
    },
    ranges: [['veTuNgay', 'veDenNgay']],
    sort: {
      maKhachHang: 'k.MaKhachHang',
      ten: 'CONVERT(k.TenKhachHang USING utf8mb4) COLLATE utf8mb4_vi_0900_ai_ci'
    },
    defaultSort: 'maKhachHang:asc',
    tieBreakers: ['k.MaKhachHang']
  },
  async load(connection, { filters, conditions, params, orderBy }) {
    if (filters.email) {
      conditions.push(`CAST(LOWER(${emailText}) AS BINARY) = CAST(LOWER(CONVERT(? USING utf8mb4)) AS BINARY)`);
      params.push(filters.email);
    }
    if (filters.coEmail !== undefined) {
      conditions.push(`COALESCE(${emailText}, '') ${filters.coEmail ? '<>' : '='} ''`);
    }
    if (filters.veTuNgay || filters.veDenNgay) {
      const ticketConditions = ["v.MaKhachHang = k.MaKhachHang", "v.TrangThai IN ('DaDat', 'DaSuDung')"];
      if (filters.veTuNgay) {
        ticketConditions.push('v.NgayDat >= ?');
        params.push(filters.veTuNgay);
      }
      if (filters.veDenNgay && filters.veDenNgay !== '9999-12-31') {
        ticketConditions.push('v.NgayDat < DATE_ADD(?, INTERVAL 1 DAY)');
        params.push(filters.veDenNgay);
      }
      conditions.push(`EXISTS (SELECT 1 FROM Ve v WHERE ${ticketConditions.join(' AND ')})`);
    }
    const [items] = await connection.execute(`
      SELECT k.MaKhachHang, k.TenKhachHang, k.SoDienThoai, k.Email
      FROM KhachHang k
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY ${orderBy}
    `, params);
    return { items };
  },
  workbook: ({ items }) => ({
    filename: 'khach-hang',
    sheets: [{
      name: 'Khách hàng',
      columns: [['Mã khách hàng', 18], ['Họ và tên', 30], ['Số điện thoại', 20, '@'], ['Email', 38]],
      rows: items.map(customer => [customer.MaKhachHang, customer.TenKhachHang, customer.SoDienThoai, customer.Email])
    }]
  })
});

const lookupQuery = {
  ...customerSearch,
  filters: { ma: { type: 'exact', column: 'k.MaKhachHang', maxLength: 10 } },
  sort: { ma: 'k.MaKhachHang' },
  defaultSort: 'ma:asc',
  tieBreakers: ['k.MaKhachHang']
};

router.get('/', customerList.list);
router.get('/xuat', customerList.exportXlsx);

router.get('/tuy-chon', async (req, res) => {
  const { page: requestedPage, pageSize: requestedPageSize = '20', ...query } = req.query;
  try {
    if (query.sort !== undefined) throw new ListQueryError('sort');
    const { page, pageSize } = parseListPagination(requestedPage, requestedPageSize);
    const { filters, conditions, params, orderBy } = parseListQuery(query, lookupQuery);
    if (filters.ma && conditions.length > 1) throw new ListQueryError('ma/q');
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { items, total } = await withConsistentListRead(db, async connection => {
      const [[count]] = await connection.execute(`SELECT COUNT(*) AS total FROM KhachHang k ${where}`, params);
      const total = Number(count.total);
      if (page > Math.ceil(total / pageSize)) return { items: [], total };
      const [items] = await connection.execute(`
        SELECT k.MaKhachHang, k.TenKhachHang, k.SoDienThoai FROM KhachHang k ${where}
        ORDER BY ${orderBy} LIMIT ? OFFSET ?
      `, [...params, pageSize, (page - 1) * pageSize]);
      return { items, total };
    });
    return res.json({ items, total, page, pageSize });
  } catch (error) {
    if (!(error instanceof ListQueryError)) throw error;
    return res.status(error.status).json({ code: error.code, message: error.message });
  }
});

router.post('/', async (req, res) => {
  const rawCode = req.body?.MaKhachHang;
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  const customer = readCustomer(req.body);
  if (!codePattern.test(code) || !customer) {
    return res.status(400).json({ message: 'Kiểm tra mã, họ tên, số điện thoại và email.' });
  }

  await db.execute(
    `INSERT INTO KhachHang (${fields}) VALUES (?, ?, ?, ?)`,
    [code, customer.TenKhachHang, customer.SoDienThoai, customer.Email]
  );
  res.status(201).json({ MaKhachHang: code, ...customer });
});

router.put('/:code', async (req, res) => {
  const { code } = req.params;
  const customer = readCustomer(req.body);
  if (!customer) {
    return res.status(400).json({ message: 'Kiểm tra họ tên, số điện thoại và email.' });
  }

  const [result] = await db.execute(
    'UPDATE KhachHang SET TenKhachHang = ?, SoDienThoai = ?, Email = ? WHERE MaKhachHang = ?',
    [customer.TenKhachHang, customer.SoDienThoai, customer.Email, code]
  );
  if (!result.affectedRows) return res.status(404).json(notFound);
  res.json({ MaKhachHang: code, ...customer });
});

router.delete('/:code', requireAdmin, async (req, res) => {
  const [result] = await db.execute(
    'DELETE FROM KhachHang WHERE MaKhachHang = ?', [req.params.code]
  );
  if (!result.affectedRows) return res.status(404).json(notFound);
  res.sendStatus(204);
});

const movieSearch = vietnameseSearchColumn('p.TenPhim');
const historyList = createSnapshotList({
  store: snapshotStore,
  pool: db,
  scope: req => 'khach-hang:ve:' + req.params.code,
  query: {
    accentInsensitive: true,
    searchColumns: [vietnameseSearchColumn('v.MaVe'), movieSearch],
    filters: {
      maVe: { type: 'exact', column: 'v.MaVe', maxLength: 15 },
      tenPhim: { type: 'text', column: movieSearch, operator: 'contains', maxLength: 150 },
      maPhim: { type: 'exact', column: 'p.MaPhim', multiple: true, maxLength: 15 },
      trangThai: { type: 'enum', column: 'v.TrangThai', multiple: true, values: ['DaDat', 'DaSuDung', 'DaHuy'] },
      tuNgay: { type: 'date', column: 'v.NgayDat', operator: '>=' },
      denNgay: { type: 'date', column: 'v.NgayDat', operator: 'throughDate' }
    },
    ranges: [['tuNgay', 'denNgay']],
    sort: { ngayDat: 'v.NgayDat' },
    defaultSort: 'ngayDat:desc',
    tieBreakers: ['v.MaVe', 'v.MaSuatChieu', 'v.MaKhachHang', 'v.MaGhe']
  },
  async load(connection, { conditions, params, orderBy }, req) {
    const code = req.params.code;
    const [[customer]] = await connection.execute(`
      SELECT EXISTS (SELECT 1 FROM Ve v WHERE v.MaKhachHang = k.MaKhachHang) AS hasHistory
      FROM KhachHang k
      WHERE k.MaKhachHang = ?
    `, [code]);
    if (!customer) throw new SnapshotError(404, 'CUSTOMER_NOT_FOUND', notFound.message);
    const meta = { hasHistory: Boolean(customer.hasHistory) };
    if (!meta.hasHistory) return { items: [], meta };

    const [items] = await connection.execute(`
      SELECT v.MaVe, v.MaSuatChieu, v.MaGhe, p.MaPhim, p.TenPhim,
             DATE_FORMAT(v.NgayDat, '%d/%m/%Y %H:%i') AS NgayDat, v.TrangThai
      FROM Ve v
      JOIN SuatChieu sc ON sc.MaSuatChieu = v.MaSuatChieu
      JOIN Phim p ON p.MaPhim = sc.MaPhim
      WHERE ${['v.MaKhachHang = ?', ...conditions].join(' AND ')}
      ORDER BY ${orderBy}
    `, [code, ...params]);
    return { items, meta };
  }
});

router.get('/:code/ve', historyList.list);

module.exports = router;
