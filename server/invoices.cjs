const express = require('express');
const db = require('./db.cjs');
const { requireLogin, requireAdmin } = require('./auth.cjs');
const { vietnameseSearchColumn } = require('./list-query.cjs');
const { createSnapshotList } = require('./snapshot-list.cjs');
const snapshotStore = require('./snapshot-store.cjs');
const transaction = require('./transaction.cjs');

const router = express.Router();
const maxLines = 10;
const maxQuantity = 50;
const notFound = { message: 'Không tìm thấy hóa đơn.' };
const detailBatchSize = 100;
const moneyFormat = '#,##0.##" ₫"';
const integerFormat = '#,##0';

router.use(requireLogin);

class InvoiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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

function invoiceLine(row) {
  const amount = Number(row.TongTien);
  return {
    MaCombo: row.MaCombo,
    TenCombo: row.TenCombo,
    // Giá hiện tại của combo có thể đã đổi sau khi phát hành hóa đơn.
    DonGia: amount / row.SoLuongCombo,
    SoLuong: row.SoLuongCombo,
    ThanhTien: amount
  };
}

async function readInvoice(executor, code) {
  const [rows] = await executor.execute(`
    SELECT d.MaHoaDon, d.MaKhachHang, kh.TenKhachHang, kh.SoDienThoai,
           DATE_FORMAT(d.NgayMua, '%d/%m/%Y %H:%i') AS NgayMua,
           h.MaCombo, b.TenCombo, h.SoLuongCombo, h.TongTien
    FROM DauHoaDon d
    JOIN KhachHang kh ON kh.MaKhachHang = d.MaKhachHang
    JOIN HoaDon h ON h.MaHoaDon = d.MaHoaDon
    JOIN BapNuoc b ON b.MaCombo = h.MaCombo
    WHERE d.MaHoaDon = ?
    ORDER BY h.MaCombo
  `, [code]);
  if (!rows.length) return null;

  const { MaHoaDon, MaKhachHang, TenKhachHang, SoDienThoai, NgayMua } = rows[0];
  const lines = rows.map(invoiceLine);
  return {
    MaHoaDon, MaKhachHang, TenKhachHang, SoDienThoai, NgayMua,
    SoLuong: lines.reduce((sum, line) => sum + line.SoLuong, 0),
    TongTien: lines.reduce((sum, line) => sum + line.ThanhTien, 0),
    ChiTiet: lines
  };
}

const customerSearch = vietnameseSearchColumn('kh.TenKhachHang');
const invoiceQuery = {
  searchColumns: ['LOWER(d.MaHoaDon)', 'LOWER(d.MaKhachHang)', customerSearch],
  phoneColumn: 'kh.SoDienThoai',
  filters: {
    maHoaDon: { type: 'exact', column: 'd.MaHoaDon', maxLength: 15 },
    maKhachHang: { type: 'exact', column: 'd.MaKhachHang', maxLength: 10 },
    tenKhachHang: { type: 'text', column: customerSearch, operator: 'contains' },
    soDienThoai: { type: 'phone', column: 'kh.SoDienThoai' },
    tuNgay: { type: 'date', column: 'd.NgayMua', operator: '>=' },
    denNgay: { type: 'date', column: 'd.NgayMua', operator: 'throughDate' },
    tongMin: { type: 'decimal' },
    tongMax: { type: 'decimal' },
    maCombo: { type: 'exact', maxLength: 10, multiple: true }
  },
  ranges: [['tuNgay', 'denNgay'], ['tongMin', 'tongMax']],
  sort: {
    ngayMua: 'd.NgayMua', tongTien: 'SUM(h.TongTien)',
    soLuong: 'SUM(h.SoLuongCombo)', maHoaDon: 'd.MaHoaDon'
  },
  defaultSort: 'ngayMua:desc,maHoaDon:desc',
  tieBreakers: ['d.MaHoaDon']
};

async function readReportLines(connection, items) {
  const linesByInvoice = new Map(items.map(item => [item.MaHoaDon, []]));
  for (let start = 0; start < items.length; start += detailBatchSize) {
    const codes = items.slice(start, start + detailBatchSize).map(item => item.MaHoaDon);
    const [rows] = await connection.query(`
      SELECT d.MaHoaDon, h.MaCombo, b.TenCombo, h.SoLuongCombo, h.TongTien
      FROM DauHoaDon d
      JOIN HoaDon h ON h.MaHoaDon = d.MaHoaDon
      JOIN BapNuoc b ON b.MaCombo = h.MaCombo
      WHERE d.MaHoaDon IN (?)
      ORDER BY d.MaHoaDon, h.MaCombo
    `, [codes]);
    for (const row of rows) {
      const line = invoiceLine(row);
      linesByInvoice.get(row.MaHoaDon).push([
        row.MaHoaDon, line.MaCombo, line.TenCombo, line.SoLuong, line.DonGia, line.ThanhTien
      ]);
    }
  }
  return Array.from(linesByInvoice.values()).flat();
}

async function loadInvoiceList(connection, selection) {
  const { filters, conditions, params, orderBy } = selection;
  if (filters.maCombo) {
    const placeholders = filters.maCombo.map(() => '?').join(', ');
    conditions.push(`EXISTS (SELECT 1 FROM HoaDon c WHERE c.MaHoaDon = d.MaHoaDon AND c.MaCombo IN (${placeholders}))`);
    params.push(...filters.maCombo);
  }
  const totalConditions = [];
  if (filters.tongMin !== undefined) {
    totalConditions.push('SUM(h.TongTien) >= CAST(? AS DECIMAL(18,2))');
    params.push(filters.tongMin);
  }
  if (filters.tongMax !== undefined) {
    totalConditions.push('SUM(h.TongTien) <= CAST(? AS DECIMAL(18,2))');
    params.push(filters.tongMax);
  }
  const [rows] = await connection.execute(`
    SELECT d.MaHoaDon, d.MaKhachHang, kh.TenKhachHang,
           DATE_FORMAT(d.NgayMua, '%d/%m/%Y %H:%i') AS NgayMua,
           SUM(h.SoLuongCombo) AS SoLuong, SUM(h.TongTien) AS TongTien
    FROM DauHoaDon d
    JOIN KhachHang kh ON kh.MaKhachHang = d.MaKhachHang
    JOIN HoaDon h ON h.MaHoaDon = d.MaHoaDon
    ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
    GROUP BY d.MaHoaDon, d.MaKhachHang, kh.TenKhachHang, d.NgayMua
    ${totalConditions.length ? 'HAVING ' + totalConditions.join(' AND ') : ''}
    ORDER BY ${orderBy}
  `, params);

  const items = rows.map(row => ({
    ...row, SoLuong: Number(row.SoLuong), TongTien: Number(row.TongTien)
  }));
  return { items, report: await readReportLines(connection, items) };
}

function excelDate(value) {
  const [date, time] = value.split(' ');
  return new Date(date.split('/').reverse().join('-') + 'T' + time + ':00Z');
}

const invoiceList = createSnapshotList({
  store: snapshotStore, pool: db, scope: 'hoa-don', query: invoiceQuery, load: loadInvoiceList,
  workbook: ({ items, report }) => ({
    filename: 'hoa-don',
    sheets: [
      {
        name: 'Hóa đơn',
        columns: [['Mã hóa đơn', 18], ['Mã khách', 16], ['Khách hàng', 30],
          ['Ngày mua', 22, 'dd/mm/yyyy hh:mm'], ['Số lượng', 14, integerFormat], ['Tổng tiền', 20, moneyFormat]],
        rows: items.map(row => [row.MaHoaDon, row.MaKhachHang, row.TenKhachHang,
          excelDate(row.NgayMua), row.SoLuong, row.TongTien])
      },
      {
        name: 'Chi tiết combo',
        columns: [['Mã hóa đơn', 18], ['Mã combo', 16], ['Combo', 32],
          ['Số lượng', 14, integerFormat], ['Đơn giá', 18, moneyFormat], ['Thành tiền', 20, moneyFormat]],
        rows: report
      }
    ]
  })
});
router.get('/', invoiceList.list);
router.get('/xuat', invoiceList.exportXlsx);

router.get('/:code', async (req, res) => {
  const invoice = await readInvoice(db, req.params.code);
  if (!invoice) return res.status(404).json(notFound);
  res.json(invoice);
});

router.post('/', async (req, res) => {
  try {
    const { customer, quantities } = readLines(req.body);

    const invoice = await transaction(async connection => {
      const [[found]] = await connection.execute(
        'SELECT MaKhachHang FROM KhachHang WHERE MaKhachHang = ? FOR SHARE', [customer]
      );
      if (!found) throw new InvoiceError(409, 'Khách hàng không còn tồn tại.');

      const codes = [...quantities.keys()];
      const [combos] = await connection.query(
        'SELECT MaCombo FROM BapNuoc WHERE MaCombo IN (?) FOR SHARE', [codes]
      );
      if (combos.length !== codes.length) {
        throw new InvoiceError(409, 'Có combo không còn tồn tại. Tải lại danh sách rồi thử lại.');
      }

      // Bộ đếm giữ mã đã cấp sau khi hóa đơn bị xóa. MAX bao gồm dữ liệu nhập ngoài.
      const [[{ SoCuoi }]] = await connection.execute('SELECT SoCuoi FROM DayMaHoaDon WHERE Id = 1 FOR UPDATE');
      const [[{ last }]] = await connection.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(MaHoaDon, 3) AS UNSIGNED)), 0) AS last
         FROM DauHoaDon WHERE MaHoaDon REGEXP '^HD[0-9]+$'`
      );
      const nextNumber = Math.max(Number(SoCuoi), Number(last)) + 1;
      const invoiceCode = 'HD' + String(nextNumber).padStart(3, '0');
      if (invoiceCode.length > 15) throw new InvoiceError(409, 'Đã hết dãy mã hóa đơn.');
      await connection.execute('UPDATE DayMaHoaDon SET SoCuoi = ? WHERE Id = 1', [nextNumber]);
      await connection.execute('INSERT INTO DauHoaDon (MaHoaDon, MaKhachHang, NgayMua) VALUES (?, ?, NOW())',
        [invoiceCode, found.MaKhachHang]);

      for (const combo of combos) {
        const requestedCode = codes.find(code => code === combo.MaCombo) ??
          codes.find(code => code.toUpperCase() === combo.MaCombo.toUpperCase());
        const quantity = quantities.get(requestedCode);
        await connection.execute(
          `INSERT INTO HoaDon (MaHoaDon, MaKhachHang, MaCombo, SoLuongCombo, NgayMua, TongTien)
           SELECT d.MaHoaDon, d.MaKhachHang, b.MaCombo, ?, d.NgayMua, b.GiaCombo * CAST(? AS UNSIGNED)
           FROM DauHoaDon d JOIN BapNuoc b ON b.MaCombo = ?
           WHERE d.MaHoaDon = ?`,
          [quantity, quantity, combo.MaCombo, invoiceCode]
        );
      }
      return readInvoice(connection, invoiceCode);
    }, 'rap_hd');

    res.status(201).json(invoice);
  } catch (error) {
    if (error instanceof InvoiceError) return res.status(error.status).json({ message: error.message });
    if (error.code === 'APP_DB_LOCK_BUSY') {
      return res.status(503).json({ message: 'Hệ thống đang bận tạo hóa đơn khác. Thử lại sau giây lát.' });
    }
    throw error;
  }
});

router.delete('/:code', requireAdmin, async (req, res) => {
  const [result] = await transaction(connection =>
    connection.execute('DELETE FROM DauHoaDon WHERE MaHoaDon = ?', [req.params.code]));
  if (!result.affectedRows) return res.status(404).json(notFound);
  res.sendStatus(204);
});

module.exports = router;
