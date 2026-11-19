const express = require('express');
const db = require('./db.cjs');
const { requireLogin, requireAdmin } = require('./auth.cjs');

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

router.get('/', async (req, res) => {
  const keyword = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const [rows] = await db.execute(
    `SELECT ${fields}
     FROM KhachHang
     WHERE LOCATE(?, MaKhachHang) > 0 OR LOCATE(?, TenKhachHang) > 0
        OR LOCATE(?, SoDienThoai) > 0 OR LOCATE(?, Email) > 0
     ORDER BY MaKhachHang`,
    [keyword, keyword, keyword, keyword]
  );
  res.json(rows);
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

router.get('/:code/ve', async (req, res) => {
  const [rows] = await db.execute(`
    SELECT v.MaVe, p.TenPhim,
           DATE_FORMAT(v.NgayDat, '%d/%m/%Y %H:%i') AS NgayDat,
           v.TrangThai
    FROM KhachHang kh
    LEFT JOIN Ve v ON v.MaKhachHang = kh.MaKhachHang
    LEFT JOIN SuatChieu sc ON sc.MaSuatChieu = v.MaSuatChieu
    LEFT JOIN Phim p ON p.MaPhim = sc.MaPhim
    WHERE kh.MaKhachHang = ?
    ORDER BY v.NgayDat DESC, v.MaVe, v.MaSuatChieu, v.MaGhe
  `, [req.params.code]);
  if (!rows.length) return res.status(404).json(notFound);
  res.json(rows[0].MaVe === null ? [] : rows);
});

module.exports = router;
