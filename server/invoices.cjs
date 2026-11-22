const express = require('express');
const db = require('./db.cjs');
const { requireLogin, requireAdmin } = require('./auth.cjs');
const transaction = require('./transaction.cjs');

// Bảng HoaDon lưu mỗi combo của một hóa đơn thành một dòng (khóa chính gồm
// MaHoaDon, MaKhachHang, MaCombo). Một hóa đơn là nhóm các dòng cùng MaHoaDon.
const router = express.Router();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const maxLines = 10;
const maxQuantity = 50;
const notFound = { message: 'Không tìm thấy hóa đơn.' };

router.use(requireLogin);

class InvoiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readDate(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !datePattern.test(value) ||
      Number.isNaN(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    throw new InvoiceError(400, 'Ngày lọc không hợp lệ (định dạng năm-tháng-ngày).');
  }
  return value;
}

function readLines(body) {
  const customer = typeof body?.MaKhachHang === 'string' ? body.MaKhachHang.trim() : '';
  if (!customer || customer.length > 10 || !Array.isArray(body.ChiTiet) ||
      !body.ChiTiet.length || body.ChiTiet.length > maxLines) {
    throw new InvoiceError(400, 'Chọn khách hàng và 1–' + maxLines + ' combo cho hóa đơn.');
  }

  // Gộp các dòng trùng combo để không vi phạm khóa chính của HoaDon.
  const quantities = new Map();
  for (const line of body.ChiTiet) {
    const code = typeof line?.MaCombo === 'string' ? line.MaCombo.trim() : '';
    const quantity = line?.SoLuong;
    if (!code || code.length > 10 || !Number.isInteger(quantity) || quantity < 1) {
      throw new InvoiceError(400, 'Mỗi dòng cần mã combo và số lượng nguyên dương.');
    }
    quantities.set(code, (quantities.get(code) ?? 0) + quantity);
  }
  if ([...quantities.values()].some(quantity => quantity > maxQuantity)) {
    throw new InvoiceError(400, 'Mỗi combo tối đa ' + maxQuantity + ' phần trong một hóa đơn.');
  }
  return { customer, quantities };
}

async function readInvoice(executor, code) {
  const [rows] = await executor.execute(`
    SELECT h.MaHoaDon, h.MaKhachHang, kh.TenKhachHang, kh.SoDienThoai,
           DATE_FORMAT(h.NgayMua, '%d/%m/%Y %H:%i') AS NgayMua,
           h.MaCombo, b.TenCombo, b.GiaCombo, h.SoLuongCombo, h.TongTien
    FROM HoaDon h
    JOIN KhachHang kh ON kh.MaKhachHang = h.MaKhachHang
    JOIN BapNuoc b ON b.MaCombo = h.MaCombo
    WHERE h.MaHoaDon = ?
    ORDER BY h.MaCombo
  `, [code]);
  if (!rows.length) return null;

  const { MaHoaDon, MaKhachHang, TenKhachHang, SoDienThoai, NgayMua } = rows[0];
  const lines = rows.map(row => ({
    MaCombo: row.MaCombo,
    TenCombo: row.TenCombo,
    // Đơn giá lúc bán suy ra từ dòng hóa đơn, không phải giá hiện tại của combo.
    DonGia: Number(row.TongTien) / row.SoLuongCombo,
    SoLuong: row.SoLuongCombo,
    ThanhTien: Number(row.TongTien)
  }));
  return {
    MaHoaDon, MaKhachHang, TenKhachHang, SoDienThoai, NgayMua,
    SoLuong: lines.reduce((sum, line) => sum + line.SoLuong, 0),
    TongTien: lines.reduce((sum, line) => sum + line.ThanhTien, 0),
    ChiTiet: lines
  };
}

router.get('/', async (req, res) => {
  let from;
  let to;
  try {
    from = readDate(req.query.tuNgay);
    to = readDate(req.query.denNgay);
  } catch (error) {
    return res.status(error.status).json({ message: error.message });
  }
  const keyword = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';

  const [rows] = await db.execute(`
    SELECT h.MaHoaDon, h.MaKhachHang, kh.TenKhachHang,
           DATE_FORMAT(MIN(h.NgayMua), '%d/%m/%Y %H:%i') AS NgayMua,
           SUM(h.SoLuongCombo) AS SoLuong, SUM(h.TongTien) AS TongTien
    FROM HoaDon h
    JOIN KhachHang kh ON kh.MaKhachHang = h.MaKhachHang
    WHERE (LOCATE(?, h.MaHoaDon) > 0 OR LOCATE(?, h.MaKhachHang) > 0
           OR LOCATE(?, kh.TenKhachHang) > 0 OR LOCATE(?, kh.SoDienThoai) > 0)
      AND (? IS NULL OR h.NgayMua >= ?)
      AND (? IS NULL OR h.NgayMua < DATE_ADD(?, INTERVAL 1 DAY))
    GROUP BY h.MaHoaDon, h.MaKhachHang, kh.TenKhachHang
    ORDER BY MIN(h.NgayMua) DESC, h.MaHoaDon DESC
    LIMIT 200
  `, [keyword, keyword, keyword, keyword, from, from, to, to]);

  res.json(rows.map(row => ({
    ...row, SoLuong: Number(row.SoLuong), TongTien: Number(row.TongTien)
  })));
});

router.get('/:code', async (req, res) => {
  const invoice = await readInvoice(db, req.params.code);
  if (!invoice) return res.status(404).json(notFound);
  res.json(invoice);
});

router.post('/', async (req, res) => {
  try {
    const { customer, quantities } = readLines(req.body);

    const code = await transaction(async connection => {
      const [[found]] = await connection.execute(
        'SELECT MaKhachHang FROM KhachHang WHERE MaKhachHang = ? FOR SHARE', [customer]
      );
      if (!found) throw new InvoiceError(409, 'Khách hàng không còn tồn tại.');

      const codes = [...quantities.keys()];
      const [combos] = await connection.query(
        'SELECT MaCombo, GiaCombo FROM BapNuoc WHERE MaCombo IN (?) FOR SHARE', [codes]
      );
      if (combos.length !== codes.length) {
        throw new InvoiceError(409, 'Có combo không còn tồn tại. Tải lại danh sách rồi thử lại.');
      }

      // Mã hóa đơn tiếp theo: HD + số lớn nhất hiện có + 1. Khóa tên cho các giao dịch song song.
      const [[{ last }]] = await connection.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(MaHoaDon, 3) AS UNSIGNED)), 0) AS last
         FROM HoaDon WHERE MaHoaDon REGEXP '^HD[0-9]+$'`
      );
      const invoiceCode = 'HD' + String(Number(last) + 1).padStart(3, '0');
      const [[{ now }]] = await connection.query('SELECT NOW() AS now');

      for (const combo of combos) {
        const quantity = quantities.get(combo.MaCombo);
        // Tổng tiền luôn do máy chủ tính từ giá trong CSDL, không nhận từ client.
        await connection.execute(
          `INSERT INTO HoaDon (MaHoaDon, MaKhachHang, MaCombo, SoLuongCombo, NgayMua, TongTien)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [invoiceCode, customer, combo.MaCombo, quantity, now, Number(combo.GiaCombo) * quantity]
        );
      }
      return invoiceCode;
    }, 'hoa_don_ma');

    res.status(201).json(await readInvoice(db, code));
  } catch (error) {
    if (error instanceof InvoiceError) return res.status(error.status).json({ message: error.message });
    if (error.code === 'APP_DB_LOCK_BUSY') {
      return res.status(503).json({ message: 'Hệ thống đang bận tạo hóa đơn khác. Thử lại sau giây lát.' });
    }
    throw error;
  }
});

router.delete('/:code', requireAdmin, async (req, res) => {
  const [result] = await db.execute('DELETE FROM HoaDon WHERE MaHoaDon = ?', [req.params.code]);
  if (!result.affectedRows) return res.status(404).json(notFound);
  res.sendStatus(204);
});

module.exports = router;
