const express = require('express');
const db = require('./db.cjs');
const { requireLogin, requireAdmin } = require('./auth.cjs');
const { vietnameseSearchColumn } = require('./list-query.cjs');
const { SnapshotError } = require('./list-snapshots.cjs');
const { createSnapshotList } = require('./snapshot-list.cjs');
const snapshotStore = require('./snapshot-store.cjs');
const transaction = require('./transaction.cjs');

const router = express.Router();
router.use(requireLogin);
const maxSeatsPerSale = 130;
const statusLabels = { DaDat: 'Đã đặt', DaSuDung: 'Đã sử dụng', DaHuy: 'Đã hủy' };

const showQuery = (includeSeatCount = false) => `
  SELECT sc.MaSuatChieu, p.MaPhim, p.TenPhim, sc.MaPhong, pc.TenPhong, sc.GiaVe, sc.TrangThai,
         DATE_FORMAT(TIMESTAMP(sc.NgayChieu, sc.GioBatDau), '%d/%m/%Y %H:%i') AS BatDau,
         TIMESTAMPDIFF(SECOND, NOW(), TIMESTAMP(sc.NgayChieu, sc.GioBatDau)) AS GiayDenGioChieu,
         c.PhutNgungBan, c.PhutNgungHuy${includeSeatCount ? ', fn_SoGheTrong(sc.MaSuatChieu) AS SoGheTrong' : ''}
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

function addCodeCondition(conditions, params, column, code, mode) {
  if (!code) return;
  conditions.push(mode === 'exact' ? `${column} = ?` :
    `LOCATE(CAST(LOWER(?) AS BINARY), CAST(LOWER(${column}) AS BINARY)) > 0`);
  params.push(code);
}

function excelDate(value) {
  const [date, time] = value.split(' ');
  return new Date(`${date.split('/').reverse().join('-')}T${time}:00Z`);
}

const ticketList = createSnapshotList({
  store: snapshotStore,
  pool: db,
  scope: req => 'ban-ve:suat-chieu:ve:' + readCode(req.params.showCode, 20),
  query: {
    accentInsensitive: true,
    searchColumns: ['v.MaVe', 'v.MaKhachHang', 'kh.TenKhachHang'].map(vietnameseSearchColumn),
    phoneColumn: 'kh.SoDienThoai',
    filters: {
      maVe: { type: 'exact', maxLength: 15 },
      maVeMode: { type: 'enum', values: ['exact', 'contains'] },
      maKhachHang: { type: 'exact', maxLength: 10 },
      maKhachHangMode: { type: 'enum', values: ['exact', 'contains'] },
      soDienThoai: { type: 'phone', column: 'kh.SoDienThoai' },
      hang: { type: 'exact', column: 'g.SoHang', maxLength: 5 },
      soGhe: { type: 'integer', column: 'g.SoGhe', min: 1, max: 2147483647 },
      tuNgay: { type: 'date', column: 'v.NgayDat', operator: '>=' },
      denNgay: { type: 'date', column: 'v.NgayDat', operator: 'throughDate' },
      trangThai: { type: 'enum', column: 'v.TrangThai', multiple: true, values: Object.keys(statusLabels) }
    },
    ranges: [['tuNgay', 'denNgay']],
    sort: { ngayDat: 'v.NgayDat', viTri: ['CHAR_LENGTH(g.SoHang)', 'g.SoHang', 'g.SoGhe'], maVe: 'v.MaVe' },
    defaultSort: 'ngayDat:desc',
    tieBreakers: ['v.MaVe', 'v.MaSuatChieu', 'v.MaKhachHang', 'v.MaGhe']
  },
  async load(connection, { conditions, params, orderBy, filters }, req) {
    const showCode = readCode(req.params.showCode, 20);
    const [[show]] = await connection.execute(`
      SELECT s.MaSuatChieu, EXISTS (SELECT 1 FROM Ve v WHERE v.MaSuatChieu = s.MaSuatChieu) AS hasTickets
      FROM SuatChieu s WHERE s.MaSuatChieu = ?
    `, [showCode]);
    if (!show) throw new SnapshotError(404, 'SHOW_NOT_FOUND', 'Không tìm thấy suất chiếu.');
    const meta = { hasTickets: Boolean(show.hasTickets) };
    if (!meta.hasTickets) return { items: [], meta };

    addCodeCondition(conditions, params, 'v.MaVe', filters.maVe, filters.maVeMode);
    addCodeCondition(conditions, params, 'v.MaKhachHang', filters.maKhachHang, filters.maKhachHangMode);
    const [items] = await connection.execute(`
      ${ticketQuery}
      WHERE ${['v.MaSuatChieu = ?', ...conditions].join(' AND ')}
      ORDER BY ${orderBy}
    `, [show.MaSuatChieu, ...params]);
    return { items, meta };
  },
  workbook: ({ items }) => ({
    filename: 've-theo-suat',
    sheets: [{
      name: 'Vé theo suất',
      columns: [['Mã vé', 18], ['Mã suất chiếu', 22], ['Ghế', 14], ['Ngày đặt', 22, 'dd/mm/yyyy hh:mm'],
        ['Giá', 18, '#,##0.##" ₫"'], ['Trạng thái', 18], ['Mã khách', 16]],
      rows: items.map(ticket => [ticket.MaVe, ticket.MaSuatChieu, `${ticket.SoHang}-${ticket.SoGhe}`,
        excelDate(ticket.NgayDat), Number(ticket.GiaVe), statusLabels[ticket.TrangThai], ticket.MaKhachHang])
    }]
  })
});

router.get('/suat-chieu', async (_req, res) => {
  const [rows] = await db.query(`${showQuery()} ORDER BY sc.NgayChieu, sc.GioBatDau, sc.MaSuatChieu`);
  res.json(rows.map(showPermissions).filter(show => show.CoTheBan));
});

router.get('/suat-chieu/:showCode', async (req, res) => {
  const code = readCode(req.params.showCode, 20);
  const detail = await transaction(async connection => {
    const [[show]] = await connection.execute(`${showQuery(true)} WHERE sc.MaSuatChieu = ?`, [code]);
    if (!show) throw new TicketError(404, 'Không tìm thấy suất chiếu.');
    const [seats] = await connection.execute(`
      SELECT g.MaGhe, g.SoHang, g.SoGhe, g.LoaiGhe, v.MaGheChiemCho IS NOT NULL AS DaCoVe
      FROM Ghe g
      LEFT JOIN Ve v ON v.MaSuatChieu = ? AND v.MaGheChiemCho = g.MaGhe
      WHERE g.MaPhong = ? ORDER BY CHAR_LENGTH(g.SoHang), g.SoHang, g.SoGhe, g.MaGhe
    `, [show.MaSuatChieu, show.MaPhong]);
    return { suatChieu: showPermissions(show), ghe: seats };
  });
  res.json(detail);
});

router.get('/suat-chieu/:showCode/ve', ticketList.list);
router.get('/suat-chieu/:showCode/ve/xuat', requireAdmin, ticketList.exportXlsx);
router.get('/suat-chieu/:showCode/ve/chi-tiet', async (req, res) => {
  const key = readTicketKey({
    MaVe: req.query.maVe, MaSuatChieu: req.params.showCode,
    MaKhachHang: req.query.maKhachHang, MaGhe: req.query.maGhe
  });
  const ticket = await readTicket(db, key);
  if (!ticket) throw new TicketError(404, 'Không tìm thấy vé. Tải lại danh sách để kiểm tra.');
  res.json(ticket);
});

router.get('/khach-hang', async (_req, res) => {
  const [customers] = await db.query('SELECT MaKhachHang, TenKhachHang, SoDienThoai FROM KhachHang ORDER BY MaKhachHang');
  res.json(customers);
});

router.post('/', async (req, res) => {
  const showCode = readCode(req.body?.MaSuatChieu, 20);
  const multipleSeats = Array.isArray(req.body?.MaGhes);
  const seatCodes = multipleSeats
    ? req.body.MaGhes.map(code => readCode(code, 15))
    : [readCode(req.body?.MaGhe, 15)];
  if (!seatCodes.length || seatCodes.length > maxSeatsPerSale) {
    throw new TicketError(400, `Chọn từ 1 đến ${maxSeatsPerSale} ghế cho một lần bán.`);
  }
  if (new Set(seatCodes).size !== seatCodes.length) {
    throw new TicketError(400, 'Không thể chọn trùng một ghế trong cùng lần bán.');
  }
  const customerCode = readCode(req.body?.MaKhachHang, 10);
  const tickets = await transaction(async connection => {
    const [[customer]] = await connection.execute(
      'SELECT MaKhachHang FROM KhachHang WHERE MaKhachHang = ? FOR SHARE', [customerCode]
    );
    if (!customer) throw new TicketError(409, 'Khách hàng không còn tồn tại.');

    const created = [];
    for (const seatCode of seatCodes) {
      const destination = await readDestination(connection, showCode, seatCode);
      const code = await nextTicketCode(connection);
      const key = [code, destination.MaSuatChieu, customer.MaKhachHang, destination.MaGhe];
      await connection.execute(`
        INSERT INTO Ve (MaVe, MaSuatChieu, MaKhachHang, MaGhe, NgayDat, GiaVe)
        VALUES (?, ?, ?, ?, NOW(), ?)
      `, [...key, destination.GiaVe]);
      created.push(await readTicket(connection, key));
    }
    return created;
  }, 'rap_ve');
  res.status(201).json(multipleSeats ? tickets : tickets[0]);
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
    // đỏi vé
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
