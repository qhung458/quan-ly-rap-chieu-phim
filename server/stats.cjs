const express = require('express');
const db = require('./db.cjs');
const { requireLogin } = require('./auth.cjs');

const router = express.Router();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const maxDays = 366;

router.use(requireLogin);

function parseDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function emptyDay() {
  return { SoVe: 0, DoanhThuVe: 0, SoHoaDon: 0, DoanhThuBapNuoc: 0 };
}

function withTotal(row) {
  return { ...row, TongDoanhThu: row.DoanhThuVe + row.DoanhThuBapNuoc };
}

// Doanh thu vé tính theo ngày chiếu, bỏ suất đã hủy và vé đã hủy (cùng quy ước với NormalQuery.sql).
// Toàn bộ doanh thu bắp nước thuộc ngày chứng từ của đầu hóa đơn.
router.get('/', async (req, res) => {
  const fromDate = parseDate(req.query.tuNgay);
  const toDate = parseDate(req.query.denNgay);
  if (!fromDate || !toDate || fromDate > toDate) {
    return res.status(400).json({ message: 'Chọn khoảng ngày hợp lệ: từ ngày không được sau đến ngày.' });
  }
  if ((toDate - fromDate) / 86400000 + 1 > maxDays) {
    return res.status(400).json({ message: 'Khoảng thống kê tối đa ' + maxDays + ' ngày.' });
  }
  const from = req.query.tuNgay;
  const to = req.query.denNgay;

  const [ticketDays, comboDays, films, combos] = await Promise.all([
    db.execute(`
      SELECT DATE_FORMAT(sc.NgayChieu, '%Y-%m-%d') AS Ngay,
             COUNT(v.MaVe) AS SoVe, COALESCE(SUM(v.GiaVe), 0) AS DoanhThu
      FROM SuatChieu sc
      JOIN Ve v ON v.MaSuatChieu = sc.MaSuatChieu AND v.TrangThai IN ('DaDat', 'DaSuDung')
      WHERE sc.TrangThai <> 'Huy'
        AND sc.NgayChieu >= ? AND sc.NgayChieu < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY sc.NgayChieu
    `, [from, to]),
    db.execute(`
      SELECT DATE_FORMAT(d.NgayMua, '%Y-%m-%d') AS Ngay,
             COUNT(DISTINCT d.MaHoaDon) AS SoHoaDon, COALESCE(SUM(h.TongTien), 0) AS DoanhThu
      FROM DauHoaDon d
      JOIN HoaDon h ON h.MaHoaDon = d.MaHoaDon AND h.MaKhachHang = d.MaKhachHang
      WHERE d.NgayMua >= ? AND d.NgayMua < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY Ngay
    `, [from, to]),
    db.execute(`
      SELECT p.MaPhim, p.TenPhim, COUNT(v.MaVe) AS SoVe, COALESCE(SUM(v.GiaVe), 0) AS DoanhThu
      FROM Phim p
      JOIN SuatChieu sc ON sc.MaPhim = p.MaPhim AND sc.TrangThai <> 'Huy'
        AND sc.NgayChieu >= ? AND sc.NgayChieu < DATE_ADD(?, INTERVAL 1 DAY)
      JOIN Ve v ON v.MaSuatChieu = sc.MaSuatChieu AND v.TrangThai IN ('DaDat', 'DaSuDung')
      GROUP BY p.MaPhim, p.TenPhim
      ORDER BY DoanhThu DESC, p.TenPhim
    `, [from, to]),
    db.execute(`
      SELECT b.MaCombo, b.TenCombo, SUM(h.SoLuongCombo) AS SoLuong, SUM(h.TongTien) AS DoanhThu
      FROM DauHoaDon d
      JOIN HoaDon h ON h.MaHoaDon = d.MaHoaDon AND h.MaKhachHang = d.MaKhachHang
      JOIN BapNuoc b ON b.MaCombo = h.MaCombo
      WHERE d.NgayMua >= ? AND d.NgayMua < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY b.MaCombo, b.TenCombo
      ORDER BY DoanhThu DESC, b.TenCombo
    `, [from, to])
  ]);

  const days = new Map();
  const day = key => {
    if (!days.has(key)) days.set(key, emptyDay());
    return days.get(key);
  };
  for (const row of ticketDays[0]) {
    Object.assign(day(row.Ngay), { SoVe: Number(row.SoVe), DoanhThuVe: Number(row.DoanhThu) });
  }
  for (const row of comboDays[0]) {
    Object.assign(day(row.Ngay), { SoHoaDon: Number(row.SoHoaDon), DoanhThuBapNuoc: Number(row.DoanhThu) });
  }

  const byDay = [...days.keys()].sort().map(Ngay => withTotal({ Ngay, ...days.get(Ngay) }));
  const months = new Map();
  for (const row of byDay) {
    const key = row.Ngay.slice(0, 7);
    const month = months.get(key) ?? emptyDay();
    month.SoVe += row.SoVe;
    month.DoanhThuVe += row.DoanhThuVe;
    month.SoHoaDon += row.SoHoaDon;
    month.DoanhThuBapNuoc += row.DoanhThuBapNuoc;
    months.set(key, month);
  }
  const byMonth = [...months.keys()].sort().map(Thang => withTotal({ Thang, ...months.get(Thang) }));

  const summary = withTotal(byDay.reduce((sum, row) => ({
    SoVe: sum.SoVe + row.SoVe,
    DoanhThuVe: sum.DoanhThuVe + row.DoanhThuVe,
    SoHoaDon: sum.SoHoaDon + row.SoHoaDon,
    DoanhThuBapNuoc: sum.DoanhThuBapNuoc + row.DoanhThuBapNuoc
  }), emptyDay()));

  res.json({
    TuNgay: from,
    DenNgay: to,
    TongQuan: summary,
    TheoNgay: byDay,
    TheoThang: byMonth,
    TheoPhim: films[0].map(row => ({ ...row, SoVe: Number(row.SoVe), DoanhThu: Number(row.DoanhThu) })),
    TheoCombo: combos[0].map(row => ({ ...row, SoLuong: Number(row.SoLuong), DoanhThu: Number(row.DoanhThu) }))
  });
});

module.exports = router;
