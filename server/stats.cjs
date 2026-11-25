'use strict';

const express = require('express');
const db = require('./db.cjs');
const { requireLogin } = require('./auth.cjs');
const { ListQueryError, normalizeSearchText, parseListPagination, parseListQuery } = require('./list-query.cjs');
const { withConsistentListRead } = require('./list-snapshots.cjs');
const { handleListRequest, only, readSnapshotId } = require('./snapshot-list.cjs');
const snapshotStore = require('./snapshot-store.cjs');
const { sendListWorkbook } = require('./list-workbook.cjs');

const router = express.Router();
const datePattern = /^[1-9]\d{3}-\d{2}-\d{2}$/;
const maxDays = 366;
const scope = 'thong-ke:ky';
const titles = new Intl.Collator('vi');

// Vé thuộc ngày chiếu hợp lệ. Mọi dòng bắp nước thuộc ngày chứng từ của đầu hóa đơn.
const ticketFacts = `
  FROM SuatChieu sc
  JOIN Ve v ON v.MaSuatChieu = sc.MaSuatChieu AND v.TrangThai IN ('DaDat', 'DaSuDung')
  JOIN Phim p ON p.MaPhim = sc.MaPhim
  WHERE sc.TrangThai <> 'Huy' AND sc.NgayChieu BETWEEN ? AND ?`;
const comboFacts = `
  FROM DauHoaDon d
  JOIN HoaDon h ON h.MaHoaDon = d.MaHoaDon AND h.MaKhachHang = d.MaKhachHang
  JOIN BapNuoc b ON b.MaCombo = h.MaCombo
  WHERE d.NgayMua >= ? AND d.NgayMua <= CONCAT(?, ' 23:59:59.999999')`;

function rankingConfig(code, name, count, codeFilter, countFilter, countLabel) {
  const minCount = countFilter + 'Min';
  const maxCount = countFilter + 'Max';
  return {
    code, name, count, codeFilter, minCount, maxCount, countLabel,
    query: {
      searchColumns: [code, name],
      filters: {
        [codeFilter]: { type: 'exact', maxLength: code === 'MaPhim' ? 15 : 10 },
        [minCount]: { type: 'integer' },
        [maxCount]: { type: 'integer' },
        doanhThuMin: { type: 'decimal' },
        doanhThuMax: { type: 'decimal' }
      },
      ranges: [[minCount, maxCount], ['doanhThuMin', 'doanhThuMax']],
      sort: { doanhThu: 'revenueCents', ten: name, [countFilter]: count },
      defaultSort: 'doanhThu:desc',
      tieBreakers: [name, code]
    }
  };
}

const rankings = {
  phim: rankingConfig('MaPhim', 'TenPhim', 'SoVe', 'maPhim', 'soVe', 'Vé'),
  combo: rankingConfig('MaCombo', 'TenCombo', 'SoLuong', 'maCombo', 'soLuong', 'Số lượng')
};
const fieldsByExportName = new Map(Object.entries(rankings).flatMap(([group, config]) =>
  ['q', 'sort', ...Object.keys(config.query.filters)].map(field => [
    group + field[0].toUpperCase() + field.slice(1), [group, field]
  ])
));

router.use(requireLogin);

function parseDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function cents(amount) {
  const [whole, fraction = ''] = String(amount).split('.');
  return BigInt(whole + fraction.padEnd(2, '0'));
}

function amount(centsValue) {
  return Number(`${centsValue / 100n}.${String(centsValue % 100n).padStart(2, '0')}`);
}

function emptyTotals() {
  return { SoVe: 0, DoanhThuVe: 0n, SoHoaDon: 0, DoanhThuBapNuoc: 0n };
}

function addTotals(total, row) {
  total.SoVe += row.SoVe;
  total.DoanhThuVe += row.DoanhThuVe;
  total.SoHoaDon += row.SoHoaDon;
  total.DoanhThuBapNuoc += row.DoanhThuBapNuoc;
}

function publicTotals(row) {
  return {
    SoVe: row.SoVe,
    DoanhThuVe: amount(row.DoanhThuVe),
    SoHoaDon: row.SoHoaDon,
    DoanhThuBapNuoc: amount(row.DoanhThuBapNuoc),
    TongDoanhThu: amount(row.DoanhThuVe + row.DoanhThuBapNuoc)
  };
}

function totalsAt(totals, key) {
  if (!totals.has(key)) totals.set(key, emptyTotals());
  return totals.get(key);
}

function summarize(tickets, combos) {
  const days = new Map();
  for (const row of tickets) {
    Object.assign(totalsAt(days, row.Ngay), { SoVe: Number(row.SoVe), DoanhThuVe: cents(row.DoanhThu) });
  }
  for (const row of combos) {
    Object.assign(totalsAt(days, row.Ngay), { SoHoaDon: Number(row.SoHoaDon), DoanhThuBapNuoc: cents(row.DoanhThu) });
  }
  const months = new Map();
  const totals = emptyTotals();
  const byDay = [...days.keys()].sort().map(Ngay => {
    const row = days.get(Ngay);
    addTotals(totalsAt(months, Ngay.slice(0, 7)), row);
    addTotals(totals, row);
    return { Ngay, ...publicTotals(row) };
  });
  return {
    TongQuan: publicTotals(totals),
    TheoNgay: byDay,
    TheoThang: [...months].map(([Thang, row]) => ({ Thang, ...publicTotals(row) }))
  };
}

function rankingRows(rows, { code, name, count }) {
  return rows.map(row => ({
    [code]: row[code], [name]: row[name], [count]: Number(row[count]), revenueCents: cents(row.DoanhThu)
  }));
}

async function readPeriod(connection, from, to) {
  const params = [from, to];
  const [ticketDays] = await connection.execute(`
    SELECT DATE_FORMAT(sc.NgayChieu, '%Y-%m-%d') AS Ngay,
           COUNT(v.MaVe) AS SoVe, COALESCE(SUM(v.GiaVe), 0) AS DoanhThu
    ${ticketFacts}
    GROUP BY sc.NgayChieu`, params);
  const [comboDays] = await connection.execute(`
    SELECT DATE_FORMAT(d.NgayMua, '%Y-%m-%d') AS Ngay,
           COUNT(DISTINCT d.MaHoaDon) AS SoHoaDon, COALESCE(SUM(h.TongTien), 0) AS DoanhThu
    ${comboFacts}
    GROUP BY Ngay`, params);
  const [films] = await connection.execute(`
    SELECT p.MaPhim, p.TenPhim, COUNT(v.MaVe) AS SoVe, COALESCE(SUM(v.GiaVe), 0) AS DoanhThu
    ${ticketFacts}
    GROUP BY p.MaPhim, p.TenPhim`, params);
  const [combos] = await connection.execute(`
    SELECT b.MaCombo, b.TenCombo, SUM(h.SoLuongCombo) AS SoLuong, SUM(h.TongTien) AS DoanhThu
    ${comboFacts}
    GROUP BY b.MaCombo, b.TenCombo`, params);

  return {
    summary: { TuNgay: from, DenNgay: to, ...summarize(ticketDays, comboDays) },
    phim: rankingRows(films, rankings.phim),
    combo: rankingRows(combos, rankings.combo)
  };
}

function compareValue(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rank(rows, config, query) {
  const { filters, order, terms } = parseListQuery(query, config.query);
  const { code, name, count, codeFilter, minCount, maxCount } = config;
  const keywords = [...terms];
  const exactCode = filters[codeFilter]?.toUpperCase();
  const minimum = filters.doanhThuMin === undefined ? undefined : cents(filters.doanhThuMin);
  const maximum = filters.doanhThuMax === undefined ? undefined : cents(filters.doanhThuMax);
  const matches = rows.filter(row => {
    if (exactCode !== undefined && row[code].toUpperCase() !== exactCode) return false;
    if (row[count] < (filters[minCount] ?? 0) || row[count] > (filters[maxCount] ?? Infinity)) return false;
    if (minimum !== undefined && row.revenueCents < minimum) return false;
    if (maximum !== undefined && row.revenueCents > maximum) return false;
    if (!keywords.length) return true;
    const rowCode = normalizeSearchText(row[code]);
    const rowName = normalizeSearchText(row[name]);
    return keywords.every(term => rowCode.includes(term) || rowName.includes(term));
  });
  return matches.sort((left, right) => {
    for (const [field, direction] of order) {
      const difference = field === name ? titles.compare(left[field], right[field]) : compareValue(left[field], right[field]);
      if (difference) return direction === 'DESC' ? -difference : difference;
    }
    return 0;
  });
}

function publicRanking({ revenueCents, ...row }) {
  return { ...row, DoanhThu: amount(revenueCents) };
}

function access(req) {
  return { sessionId: req.sessionID, scope };
}

function frozenPeriod(snapshotId, req) {
  const { items, report: { filmCount, summary } } = snapshotStore.read(snapshotId, access(req));
  return { summary, phim: items.slice(0, filmCount), combo: items.slice(filmCount) };
}

router.get('/', handleListRequest(async (req, res) => {
  only(req.query, ['tuNgay', 'denNgay', 'tomTat']);
  const { tuNgay: from, denNgay: to, tomTat } = req.query;
  if (tomTat !== undefined && tomTat !== '1') throw new ListQueryError('tomTat');
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (!fromDate || !toDate || fromDate > toDate) {
    return res.status(400).json({ message: 'Chọn khoảng ngày hợp lệ: từ ngày không được sau đến ngày.' });
  }
  if ((toDate - fromDate) / 86400000 + 1 > maxDays) {
    return res.status(400).json({ message: 'Khoảng thống kê tối đa ' + maxDays + ' ngày.' });
  }

  const { summary, phim, combo } = await withConsistentListRead(db, connection => readPeriod(connection, from, to));
  if (res.destroyed) return;
  const snapshotId = snapshotStore.create({
    ...access(req), items: [...phim, ...combo], report: { summary, filmCount: phim.length }
  });
  if (tomTat === '1') return res.json({ snapshotId, ...summary });

  // Giữ các trường của API cũ cho caller dùng trực tiếp báo cáo toàn kỳ.
  return res.json({
    snapshotId, ...summary,
    TheoPhim: rank(phim, rankings.phim, {}).map(publicRanking),
    TheoCombo: rank(combo, rankings.combo, {}).map(publicRanking)
  });
}));

for (const [group, config] of Object.entries(rankings)) {
  router.get('/theo-' + group, handleListRequest((req, res) => {
    const { snapshotId: rawId, page: rawPage, pageSize: rawPageSize, ...query } = req.query;
    const snapshotId = readSnapshotId(rawId);
    const { page, pageSize } = parseListPagination(rawPage, rawPageSize);
    const period = frozenPeriod(snapshotId, req);
    const rows = rank(period[group], config, query);
    if (page > Math.max(1, Math.ceil(rows.length / pageSize))) throw new ListQueryError('page');

    const maximum = rows.reduce((max, row) => max < row.revenueCents ? row.revenueCents : max, 0n);
    const start = (page - 1) * pageSize;
    return res.json({
      snapshotId, items: rows.slice(start, start + pageSize).map(publicRanking), total: rows.length, page, pageSize,
      meta: { maxRevenue: amount(maximum) }
    });
  }));
}

const moneyFormat = '#,##0.##" ₫"';
const integerFormat = '#,##0';
const dateFormat = 'dd/mm/yyyy';
const metrics = [
  ['Vé', 12, integerFormat], ['Doanh thu vé', 20, moneyFormat], ['Hóa đơn', 12, integerFormat],
  ['Doanh thu bắp nước', 23, moneyFormat], ['Tổng doanh thu', 20, moneyFormat]
];

function workbookDate(value) {
  const date = value.length === 7 ? value + '-01' : value;
  return new Date(date + 'T00:00:00Z');
}

function metricCells(row) {
  return [row.SoVe, row.DoanhThuVe, row.SoHoaDon, row.DoanhThuBapNuoc, row.TongDoanhThu];
}

function rankingSheet(name, label, rows, config) {
  return {
    name,
    columns: [['Mã ' + label.toLowerCase(), 16], [label, 38], [config.countLabel, 12, integerFormat],
      ['Doanh thu', 20, moneyFormat]],
    rows: rows.map(row => [row[config.code], row[config.name], row[config.count], amount(row.revenueCents)])
  };
}

function workbook(period, mode, queries) {
  const data = period.summary;
  const byDay = mode === 'day';
  const periodRows = byDay ? data.TheoNgay : data.TheoThang;
  const films = rank(period.phim, rankings.phim, queries.phim);
  const combos = rank(period.combo, rankings.combo, queries.combo);
  return {
    filename: 'thong-ke-' + data.TuNgay + '_' + data.DenNgay,
    sheets: [
      { name: 'Tổng quan', columns: [['Từ ngày', 16, dateFormat], ['Đến ngày', 16, dateFormat], ...metrics],
        rows: [[workbookDate(data.TuNgay), workbookDate(data.DenNgay), ...metricCells(data.TongQuan)]] },
      { name: byDay ? 'Theo ngày' : 'Theo tháng',
        columns: [[byDay ? 'Ngày' : 'Tháng', 16, byDay ? dateFormat : 'mm/yyyy'], ...metrics],
        rows: periodRows.map(row => [workbookDate(byDay ? row.Ngay : row.Thang), ...metricCells(row)]) },
      rankingSheet('Theo phim', 'Phim', films, rankings.phim),
      rankingSheet('Theo combo', 'Combo', combos, rankings.combo)
    ]
  };
}

router.get('/xuat', handleListRequest((req, res) => {
  const { snapshotId: rawId, mode = 'day', ...params } = req.query;
  const snapshotId = readSnapshotId(rawId);
  if (mode !== 'day' && mode !== 'month') throw new ListQueryError('mode');
  const queries = { phim: {}, combo: {} };
  for (const [name, value] of Object.entries(params)) {
    const key = fieldsByExportName.get(name);
    if (!key) throw new ListQueryError(name);
    const [group, field] = key;
    queries[group][field] = value;
  }
  return sendListWorkbook(res, workbook(frozenPeriod(snapshotId, req), mode, queries));
}));

module.exports = router;
