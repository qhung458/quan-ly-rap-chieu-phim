const express = require('express');
const db = require('./db.cjs');
const { requireLogin, requireAdmin } = require('./auth.cjs');
const { ListQueryError, parseListQuery } = require('./list-query.cjs');
const { withConsistentListRead } = require('./list-snapshots.cjs');
const transaction = require('./transaction.cjs');

const router = express.Router();
const maxSeats = 130;
const roomCodePattern = /^[A-Z0-9_-]{1,10}$/;
const seatCodeLock = 'rap_ghe';
const maxSeatCodeNumber = 9_999_999_999_999;
const seatCount = 'COUNT(g.MaGhe)';
const roomListQuery = {
  filters: {
    loaiPhong: { type: 'enum', values: ['2D', '3D'] },
    soGheMin: { type: 'integer', column: seatCount, operator: '>=' },
    soGheMax: { type: 'integer', column: seatCount, operator: '<=' }
  },
  ranges: [['soGheMin', 'soGheMax']],
  sort: { maPhong: 'p.MaPhong', soGhe: 'SoGhe' },
  defaultSort: 'maPhong:asc',
  tieBreakers: ['p.MaPhong']
};
const seatRowOrder = ['CHAR_LENGTH(g.SoHang)', 'g.SoHang'];
const seatListQuery = {
  filters: {
    maGhe: { type: 'exact', column: 'g.MaGhe', maxLength: 15 },
    soHang: { type: 'exact', column: 'g.SoHang', maxLength: 5 },
    soGhe: { type: 'integer', column: 'g.SoGhe', min: 1, max: 2147483647 },
    hang: { type: 'exact', column: 'g.SoHang', maxLength: 5, multiple: true, maxValues: maxSeats },
    loaiGhe: { type: 'enum', column: 'g.LoaiGhe', values: ['Thuong', 'VIP'], multiple: true }
  },
  sort: { viTri: [...seatRowOrder, 'g.SoGhe'] },
  defaultSort: 'viTri:asc',
  tieBreakers: ['g.MaGhe']
};

router.use(requireLogin);

class RoomError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSeatRows(value) {
  if (Array.isArray(value)) return value.map(normalizeSeatRows);
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

function readRoom(body) {
  const name = trimmed(body?.TenPhong);
  const type = body?.LoaiPhong;
  if (!name || name.length > 50 || !['2D', '3D'].includes(type)) {
    throw new RoomError(400, 'Nhập tên phòng (tối đa 50 ký tự) và chọn loại phòng 2D hoặc 3D.');
  }
  return { TenPhong: name, LoaiPhong: type };
}

function readSeat(body) {
  const row = trimmed(body?.SoHang).toUpperCase();
  const number = body?.SoGhe;
  const type = body?.LoaiGhe ?? 'Thuong';
  if (!row || row.length > 5 || !Number.isInteger(number) || number < 1 || number > 2147483647
      || !['Thuong', 'VIP'].includes(type)) {
    throw new RoomError(400, 'Nhập hàng ghế, số ghế nguyên dương và chọn loại ghế Thường hoặc VIP.');
  }
  return { SoHang: row, SoGhe: number, LoaiGhe: type };
}

function formatSeatCode(number) {
  return 'G' + String(number).padStart(3, '0');
}

function formatSeatRow(index) {
  let label = '';
  for (let row = index + 1; row > 0; row = Math.floor((row - 1) / 26)) {
    label = String.fromCharCode(65 + (row - 1) % 26) + label;
  }
  return label;
}

async function firstSeatCodeNumber(connection, count) {
  // Skip legacy random codes (G followed by 14 hex characters) and fixture IDs.
  const [[{ maxNumber }]] = await connection.query(`
    SELECT MAX(CAST(SUBSTRING(MaGhe, 2) AS UNSIGNED)) AS maxNumber
    FROM Ghe
    WHERE MaGhe REGEXP '^G[0-9]{3,13}$'
  `);
  const first = Number(maxNumber ?? 0) + 1;
  if (first + count - 1 > maxSeatCodeNumber) throw new RoomError(409, 'Đã hết mã ghế theo quy tắc hiện tại.');
  return first;
}

async function lockRoom(connection, code) {
  const [[room]] = await connection.execute('SELECT MaPhong FROM PhongChieu WHERE MaPhong = ? FOR UPDATE', [code]);
  if (!room) throw new RoomError(404, 'Không tìm thấy phòng chiếu.');
  return room.MaPhong;
}

async function lockSeat(connection, roomCode, seatCode) {
  const [[seat]] = await connection.execute(
    'SELECT MaGhe, SoHang, SoGhe FROM Ghe WHERE MaGhe = ? AND MaPhong = ? FOR UPDATE',
    [seatCode, roomCode]
  );
  if (!seat) throw new RoomError(404, 'Không tìm thấy ghế trong phòng này.');
  return seat;
}

async function countSeats(connection, roomCode) {
  const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM Ghe WHERE MaPhong = ?', [roomCode]);
  return total;
}

async function saveSeatCount(connection, roomCode, count) {
  await connection.execute('UPDATE PhongChieu SET SoGhe = ? WHERE MaPhong = ?', [count, roomCode]);
}

router.get('/', async (req, res) => {
  if (typeof req.query.sort === 'string' && req.query.sort.includes(',')) throw new ListQueryError('sort');
  const { conditions, params, filters, orderBy } = parseListQuery(req.query, roomListQuery);
  const type = filters.loaiPhong;
  const where = type ? 'WHERE p.LoaiPhong = ?' : '';
  const having = conditions.length ? 'HAVING ' + conditions.join(' AND ') : '';
  const [rooms] = await db.execute(`
    SELECT p.MaPhong, p.TenPhong, p.LoaiPhong, ${seatCount} AS SoGhe
    FROM PhongChieu p LEFT JOIN Ghe g ON g.MaPhong = p.MaPhong
    ${where}
    GROUP BY p.MaPhong, p.TenPhong, p.LoaiPhong
    ${having}
    ORDER BY ${orderBy}
  `, type ? [type, ...params] : params);
  res.json(rooms);
});

router.get('/tuy-chon', async (_req, res) => {
  const [rooms] = await db.execute('SELECT MaPhong, TenPhong FROM PhongChieu ORDER BY MaPhong');
  res.json(rooms);
});

router.post('/', async (req, res) => {
  const code = trimmed(req.body?.MaPhong).toUpperCase();
  const count = req.body?.SoGhe;
  const seatsPerRow = req.body?.SoGheMoiHang ?? count;
  const room = readRoom(req.body);
  if (!roomCodePattern.test(code) || !Number.isInteger(count) || count < 1 || count > maxSeats) {
    throw new RoomError(400, `Nhập mã phòng hợp lệ và số ghế ban đầu từ 1 đến ${maxSeats}.`);
  }
  if (!Number.isInteger(seatsPerRow) || seatsPerRow < 1 || seatsPerRow > count) {
    throw new RoomError(400, 'Số ghế mỗi hàng phải từ 1 đến tổng số ghế của phòng.');
  }

  await transaction(async connection => {
    await connection.execute(
      'INSERT INTO PhongChieu (MaPhong, TenPhong, LoaiPhong, SoGhe) VALUES (?, ?, ?, ?)',
      [code, room.TenPhong, room.LoaiPhong, count]
    );
    const first = await firstSeatCodeNumber(connection, count);
    const seats = Array.from({ length: count }, (_, index) => [
      formatSeatCode(first + index), code, formatSeatRow(Math.floor(index / seatsPerRow)), index % seatsPerRow + 1
    ]);
    const placeholders = seats.map(() => '(?, ?, ?, ?)').join(', ');
    await connection.execute(
      `INSERT INTO Ghe (MaGhe, MaPhong, SoHang, SoGhe) VALUES ${placeholders}`, seats.flat()
    );
  }, seatCodeLock);
  res.status(201).json({ MaPhong: code, ...room, SoGhe: count });
});

router.put('/:roomCode', async (req, res) => {
  const room = readRoom(req.body);
  const saved = await transaction(async connection => {
    const code = await lockRoom(connection, req.params.roomCode);
    await connection.execute('UPDATE PhongChieu SET TenPhong = ?, LoaiPhong = ? WHERE MaPhong = ?',
      [room.TenPhong, room.LoaiPhong, code]);
    return { MaPhong: code, ...room, SoGhe: await countSeats(connection, code) };
  });
  res.json(saved);
});

router.delete('/:roomCode', requireAdmin, async (req, res) => {
  await transaction(async connection => {
    const code = await lockRoom(connection, req.params.roomCode);
    const [[show]] = await connection.execute('SELECT 1 FROM SuatChieu WHERE MaPhong = ? LIMIT 1', [code]);
    if (show) throw new RoomError(409, 'Phòng đã có suất chiếu nên không thể xóa.');

    await connection.execute('DELETE FROM Ghe WHERE MaPhong = ?', [code]);
    await connection.execute('DELETE FROM PhongChieu WHERE MaPhong = ?', [code]);
  });
  res.sendStatus(204);
});

router.get('/:roomCode/ghe', async (req, res) => {
  if (req.query.sort !== undefined) throw new ListQueryError('sort');
  const query = {
    ...req.query,
    hang: normalizeSeatRows(req.query.hang),
    soHang: normalizeSeatRows(req.query.soHang)
  };
  const { conditions, params, orderBy } = parseListQuery(query, seatListQuery);
  const result = await withConsistentListRead(db, async connection => {
    const [[room]] = await connection.execute('SELECT MaPhong FROM PhongChieu WHERE MaPhong = ?', [req.params.roomCode]);
    if (!room) throw new RoomError(404, 'Không tìm thấy phòng chiếu.');

    const [rowCounts] = await connection.execute(`
      SELECT g.SoHang, COUNT(*) AS total FROM Ghe g WHERE g.MaPhong = ?
      GROUP BY g.SoHang ORDER BY ${seatRowOrder.join(', ')}
    `, [room.MaPhong]);
    const totalRoomSeats = rowCounts.reduce((sum, row) => sum + Number(row.total), 0);
    const rows = rowCounts.map(row => row.SoHang);
    if (!totalRoomSeats) return { items: [], total: 0, totalRoomSeats, rows };

    const [items] = await connection.execute(`
      SELECT g.MaGhe, ? AS MaPhong, g.SoHang, g.SoGhe, g.LoaiGhe
      FROM Ghe g
      WHERE ${['g.MaPhong = ?', ...conditions].join(' AND ')}
      ORDER BY ${orderBy}
    `, [room.MaPhong, room.MaPhong, ...params]);
    return { items, total: items.length, totalRoomSeats, rows };
  });
  res.json(result);
});

router.post('/:roomCode/ghe', async (req, res) => {
  const seat = readSeat(req.body);
  const saved = await transaction(async connection => {
    const code = await lockRoom(connection, req.params.roomCode);
    const count = await countSeats(connection, code);
    if (count >= maxSeats) throw new RoomError(409, `Mỗi phòng có tối đa ${maxSeats} ghế.`);

    const codeForSeat = formatSeatCode(await firstSeatCodeNumber(connection, 1));
    await connection.execute('INSERT INTO Ghe (MaGhe, MaPhong, SoHang, SoGhe, LoaiGhe) VALUES (?, ?, ?, ?, ?)',
      [codeForSeat, code, seat.SoHang, seat.SoGhe, seat.LoaiGhe]);
    await saveSeatCount(connection, code, count + 1);
    return { MaGhe: codeForSeat, MaPhong: code, ...seat };
  }, seatCodeLock);
  res.status(201).json(saved);
});

router.put('/:roomCode/ghe/:seatCode', async (req, res) => {
  const seat = readSeat(req.body);
  const saved = await transaction(async connection => {
    const code = await lockRoom(connection, req.params.roomCode);
    const old = await lockSeat(connection, code, req.params.seatCode);
    const positionChanged = old.SoHang !== seat.SoHang || old.SoGhe !== seat.SoGhe;
    if (positionChanged) {
      const [[ticket]] = await connection.execute('SELECT 1 FROM Ve WHERE MaGhe = ? LIMIT 1', [old.MaGhe]);
      if (ticket) throw new RoomError(409, 'Ghế đã có lịch sử vé nên không thể đổi vị trí.');
    }
    await connection.execute('UPDATE Ghe SET SoHang = ?, SoGhe = ?, LoaiGhe = ? WHERE MaGhe = ? AND MaPhong = ?',
      [seat.SoHang, seat.SoGhe, seat.LoaiGhe, old.MaGhe, code]);
    return { MaGhe: old.MaGhe, MaPhong: code, ...seat };
  });
  res.json(saved);
});

router.delete('/:roomCode/ghe/:seatCode', requireAdmin, async (req, res) => {
  await transaction(async connection => {
    const code = await lockRoom(connection, req.params.roomCode);
    const seat = await lockSeat(connection, code, req.params.seatCode);
    const count = await countSeats(connection, code);
    if (count <= 1) throw new RoomError(409, 'Phòng chiếu phải có ít nhất một ghế.');

    await connection.execute('DELETE FROM Ghe WHERE MaGhe = ? AND MaPhong = ?', [seat.MaGhe, code]);
    await saveSeatCount(connection, code, count - 1);
  });
  res.sendStatus(204);
});

router.use((error, req, res, next) => {
  if (error instanceof ListQueryError) return res.status(error.status).json({ code: error.code, message: error.message });
  if (error instanceof RoomError) return res.status(error.status).json({ message: error.message });
  const isSeat = req.route?.path.includes('/ghe');
  if (error.code === 'ER_DUP_ENTRY') {
    const message = isSeat ? 'Vị trí hàng và số ghế bị trùng trong phòng hoặc mã ghế đã tồn tại.'
      : 'Mã hoặc tên phòng đã được sử dụng.';
    return res.status(409).json({ message });
  }
  if (error.code === 'ER_ROW_IS_REFERENCED_2') {
    const message = isSeat ? 'Ghế đã có lịch sử vé nên không thể xóa.'
      : 'Phòng có suất chiếu hoặc ghế đã có vé nên không thể xóa.';
    return res.status(409).json({ message });
  }
  if (['APP_DB_LOCK_BUSY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
    return res.status(409).json({ message: 'Dữ liệu đang được cập nhật. Vui lòng thử lại.' });
  }
  next(error);
});

module.exports = router;
