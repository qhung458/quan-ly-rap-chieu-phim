const express = require('express');
const db = require('./db.cjs');
const { requireLogin } = require('./auth.cjs');
const transaction = require('./transaction.cjs');

const router = express.Router();
router.use(requireLogin);

const showQuery = `
  SELECT sc.MaSuatChieu, p.MaPhim, p.TenPhim, sc.MaPhong, pc.TenPhong, sc.GiaVe, sc.TrangThai,
         DATE_FORMAT(TIMESTAMP(sc.NgayChieu, sc.GioBatDau), '%d/%m/%Y %H:%i') AS BatDau,
         TIMESTAMPDIFF(SECOND, NOW(), TIMESTAMP(sc.NgayChieu, sc.GioBatDau)) AS GiayDenGioChieu,
         c.PhutNgungBan, c.PhutNgungHuy
  FROM SuatChieu sc
  JOIN Phim p ON p.MaPhim = sc.MaPhim
  JOIN PhongChieu pc ON pc.MaPhong = sc.MaPhong
  CROSS JOIN (
    SELECT COALESCE(MAX(CASE WHEN TenThamSo = 'PHUT_NGUNG_BAN' THEN GiaTri END), 5) AS PhutNgungBan,
           COALESCE(MAX(CASE WHEN TenThamSo = 'PHUT_NGUNG_HUY' THEN GiaTri END), 60) AS PhutNgungHuy
    FROM CauHinhHeThong
  ) c
`;

const ticketQuery = `
  SELECT v.MaVe, v.MaSuatChieu, v.MaKhachHang, kh.TenKhachHang, kh.SoDienThoai, v.MaGhe, g.SoHang, g.SoGhe,
         DATE_FORMAT(v.NgayDat, '%d/%m/%Y %H:%i') AS NgayDat, v.GiaVe, v.TrangThai
  FROM Ve v
  JOIN Ghe g ON g.MaGhe = v.MaGhe
  JOIN KhachHang kh ON kh.MaKhachHang = v.MaKhachHang
`;

const ticketKeyCondition = 'v.MaVe = ? AND v.MaSuatChieu = ? AND v.MaKhachHang = ? AND v.MaGhe = ?';
const ruleErrors = {
  'Suat chieu hoac ghe khong ton tai.': 'Suất chiếu hoặc ghế không còn tồn tại.',
  'Ghe khong thuoc phong cua suat chieu.': 'Ghế không thuộc phòng của suất chiếu.',
  'Suat chieu khong mo ban ve.': 'Suất chiếu không mở bán vé.',
  'Suat chieu da qua han ban ve.': 'Suất chiếu đã qua hạn bán vé.',
  'Suat hien tai da qua han huy/doi ve.': 'Vé đã qua thời hạn hủy hoặc đổi.',
  'Ve da su dung hoac da huy khong the doi trang thai hay cho ngoi.': 'Vé đã sử dụng hoặc đã hủy.'
};

class TicketError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readCode(value, limit) {
  const code = typeof value === 'string' ? value.trim() : '';
  if (!code || code.length > limit) throw new TicketError(400, 'Kiểm tra mã vé, suất chiếu, khách hàng và ghế.');
  return code;
}

function readTicketKey(ticket) {
  return [
    readCode(ticket?.MaVe, 15), readCode(ticket?.MaSuatChieu, 20),
    readCode(ticket?.MaKhachHang, 10), readCode(ticket?.MaGhe, 15)
  ];
}

function showPermissions(show) {
  const seconds = show.GiayDenGioChieu;
  return {
    ...show,
    CoTheBan: show.TrangThai === 'SapChieu' && seconds > 0 && seconds >= show.PhutNgungBan * 60,
    CoTheHuyDoi: seconds > 0 && seconds >= show.PhutNgungHuy * 60
  };
}

async function readDestination(connection, showCode, seatCode) {
  const [[destination]] = await connection.execute(`
    SELECT sc.MaSuatChieu, sc.GiaVe, g.MaGhe
    FROM SuatChieu sc JOIN Ghe g ON g.MaPhong = sc.MaPhong
    WHERE sc.MaSuatChieu = ? AND g.MaGhe = ? FOR SHARE
  `, [showCode, seatCode]);
  if (!destination) throw new TicketError(409, 'Suất chiếu hoặc ghế đã thay đổi, hoặc ghế không thuộc phòng của suất.');
  return destination;
}

async function nextTicketCode(connection) {
  const [[{ maxNumber }]] = await connection.query(`
    SELECT MAX(CAST(SUBSTRING(MaVe, 2) AS UNSIGNED)) AS maxNumber
    FROM Ve WHERE MaVe REGEXP '^V[0-9]{4,14}$'
  `);
  const number = Number(maxNumber ?? 0) + 1;
  if (number > 99_999_999_999_999) throw new TicketError(409, 'Đã hết mã vé theo quy tắc hiện tại.');
  return 'V' + String(number).padStart(4, '0');
}

async function lockBookedTicket(connection, key) {
  const [[ticket]] = await connection.execute(`
    SELECT v.MaVe, v.MaSuatChieu, v.MaKhachHang, v.MaGhe, v.TrangThai, v.GiaVe
    FROM Ve v WHERE ${ticketKeyCondition} FOR UPDATE
  `, key);
  if (!ticket) throw new TicketError(404, 'Không tìm thấy vé. Tải lại danh sách để kiểm tra.');
  if (ticket.TrangThai !== 'DaDat') throw new TicketError(409, 'Vé đã sử dụng hoặc đã hủy.');
  return ticket;
}

async function readTicket(connection, key) {
  const [[ticket]] = await connection.execute(`${ticketQuery} WHERE ${ticketKeyCondition}`, key);
  return ticket;
}

router.get('/suat-chieu', async (_req, res) => {
  const [rows] = await db.query(`${showQuery} ORDER BY sc.NgayChieu, sc.GioBatDau, sc.MaSuatChieu`);
  res.json(rows.map(showPermissions).filter(show => show.CoTheBan));
});

router.get('/suat-chieu/:showCode', async (req, res) => {
  const code = readCode(req.params.showCode, 20);
  const detail = await transaction(async connection => {
    const [[show]] = await connection.execute(`${showQuery} WHERE sc.MaSuatChieu = ?`, [code]);
    if (!show) throw new TicketError(404, 'Không tìm thấy suất chiếu.');
    const [seats] = await connection.execute(`
      SELECT g.MaGhe, g.SoHang, g.SoGhe, g.LoaiGhe, v.MaGheChiemCho IS NOT NULL AS DaCoVe
      FROM Ghe g
      LEFT JOIN Ve v ON v.MaSuatChieu = ? AND v.MaGheChiemCho = g.MaGhe
      WHERE g.MaPhong = ? ORDER BY CHAR_LENGTH(g.SoHang), g.SoHang, g.SoGhe, g.MaGhe
    `, [show.MaSuatChieu, show.MaPhong]);
    const [tickets] = await connection.execute(`
      ${ticketQuery} WHERE v.MaSuatChieu = ? ORDER BY v.NgayDat DESC, v.MaVe, v.MaKhachHang, v.MaGhe
    `, [show.MaSuatChieu]);
    return { suatChieu: showPermissions(show), ghe: seats, ve: tickets };
  });
  res.json(detail);
});

router.get('/khach-hang', async (_req, res) => {
  const [customers] = await db.query('SELECT MaKhachHang, TenKhachHang, SoDienThoai FROM KhachHang ORDER BY MaKhachHang');
  res.json(customers);
});

router.post('/', async (req, res) => {
  const showCode = readCode(req.body?.MaSuatChieu, 20);
  const seatCode = readCode(req.body?.MaGhe, 15);
  const customerCode = readCode(req.body?.MaKhachHang, 10);
  const ticket = await transaction(async connection => {
    const destination = await readDestination(connection, showCode, seatCode);
    const [[customer]] = await connection.execute(
      'SELECT MaKhachHang FROM KhachHang WHERE MaKhachHang = ? FOR SHARE', [customerCode]
    );
    if (!customer) throw new TicketError(409, 'Khách hàng không còn tồn tại.');
    const code = await nextTicketCode(connection);
    const key = [code, destination.MaSuatChieu, customer.MaKhachHang, destination.MaGhe];
    await connection.execute(`
      INSERT INTO Ve (MaVe, MaSuatChieu, MaKhachHang, MaGhe, NgayDat, GiaVe)
      VALUES (?, ?, ?, ?, NOW(), ?)
    `, [...key, destination.GiaVe]);
    return readTicket(connection, key);
  }, 'rap_ve');
  res.status(201).json(ticket);
});

router.put('/doi', async (req, res) => {
  const key = readTicketKey(req.body?.Ve);
  const showCode = readCode(req.body?.MaSuatChieu, 20);
  const seatCode = readCode(req.body?.MaGhe, 15);
  const ticket = await transaction(async connection => {
    const old = await lockBookedTicket(connection, key);
    const destination = await readDestination(connection, showCode, seatCode);
    const sameShow = old.MaSuatChieu === destination.MaSuatChieu;
    if (sameShow && old.MaGhe === destination.MaGhe) throw new TicketError(400, 'Chọn ghế hoặc suất chiếu mới.');

    await connection.execute(`
      UPDATE Ve v SET MaSuatChieu = ?, MaGhe = ?, GiaVe = ? WHERE ${ticketKeyCondition}
    `, [destination.MaSuatChieu, destination.MaGhe, sameShow ? old.GiaVe : destination.GiaVe, ...key]);
    return readTicket(connection, [old.MaVe, destination.MaSuatChieu, old.MaKhachHang, destination.MaGhe]);
  });
  res.json(ticket);
});

router.put('/huy', async (req, res) => {
  const key = readTicketKey(req.body?.Ve);
  const ticket = await transaction(async connection => {
    await lockBookedTicket(connection, key);
    await connection.execute(`UPDATE Ve v SET TrangThai = 'DaHuy' WHERE ${ticketKeyCondition}`, key);
    return readTicket(connection, key);
  });
  res.json(ticket);
});

router.use((error, _req, res, next) => {
  if (error instanceof TicketError) return res.status(error.status).json({ message: error.message });
  if (error.code === 'ER_SIGNAL_EXCEPTION') {
    return res.status(409).json({ message: ruleErrors[error.sqlMessage] || 'Thao tác không phù hợp với quy tắc bán vé.' });
  }
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'Ghế đã có vé trong suất chiếu này hoặc bản ghi vé bị trùng.' });
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(409).json({ message: 'Suất chiếu, khách hàng hoặc ghế không còn tồn tại.' });
  }
  if (['APP_DB_LOCK_BUSY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
    return res.status(409).json({ message: 'Dữ liệu đang được cập nhật. Vui lòng thử lại.' });
  }
  next(error);
});

module.exports = router;
