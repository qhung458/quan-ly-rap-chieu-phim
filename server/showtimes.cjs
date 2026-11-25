
const express = require('express');
const db = require('./db.cjs');
const { requireLogin } = require('./auth.cjs');
const { vietnameseSearchColumn } = require('./list-query.cjs');
const { createSnapshotList } = require('./snapshot-list.cjs');
const snapshotStore = require('./snapshot-store.cjs');

const router = express.Router();
const statusLabels = { SapChieu: 'Sắp chiếu', DangChieu: 'Đang chiếu', KetThuc: 'Kết thúc', Huy: 'Hủy' };
const allowedStatuses = Object.keys(statusLabels);
router.use(requireLogin);
// -------------------- KIỂM TRA DỮ LIỆU --------------------
class ShowtimeError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function validateShowtime(body = {}, maSuatChieu = null) {
    const item = {
        MaSuatChieu: String(maSuatChieu ?? body.MaSuatChieu ?? '').trim(),
        MaPhim: String(body.MaPhim ?? '').trim(),
        MaPhong: String(body.MaPhong ?? '').trim(),
        NgayChieu: String(body.NgayChieu ?? ''),
        GioBatDau: String(body.GioBatDau ?? ''),
        GioKetThuc: String(body.GioKetThuc ?? ''),
        GiaVe: body.GiaVe == null || body.GiaVe === '' ? NaN : Number(body.GiaVe),
        TrangThai: String(body.TrangThai ?? 'SapChieu')
    };

    if (!item.MaSuatChieu || item.MaSuatChieu.length > 20) {
        throw new ShowtimeError(400, 'Mã suất chiếu không được để trống và tối đa 20 ký tự.');
    }

    if (!item.MaPhim || item.MaPhim.length > 15) {
        throw new ShowtimeError(400, 'Mã phim không hợp lệ.');
    }

    if (!item.MaPhong || item.MaPhong.length > 10) {
        throw new ShowtimeError(400, 'Mã phòng không hợp lệ.');
    }

    const dateMatch = item.NgayChieu.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
        throw new ShowtimeError(400, 'Ngày chiếu không hợp lệ.');
    }

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);

    const date = new Date(Date.UTC(year, month - 1, day));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        throw new ShowtimeError(400, 'Ngày chiếu không hợp lệ.');
    }

    const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

    if (!timePattern.test(item.GioBatDau) || !timePattern.test(item.GioKetThuc)) {
        throw new ShowtimeError(400, 'Giờ bắt đầu hoặc giờ kết thúc không hợp lệ.');
    }

    // Chuẩn hóa giờ về định dạng HH:mm:ss.
    if (item.GioBatDau.length === 5) item.GioBatDau += ':00';
    if (item.GioKetThuc.length === 5) item.GioKetThuc += ':00';

    if (item.GioBatDau === item.GioKetThuc) {
        throw new ShowtimeError(400, 'Giờ kết thúc phải khác giờ bắt đầu.');
    }

    if (!Number.isFinite(item.GiaVe) || item.GiaVe < 0 || item.GiaVe >= 1e16) {
        throw new ShowtimeError(400, 'Giá vé phải từ 0 và nằm trong giới hạn cho phép.');
    }

    if (!allowedStatuses.includes(item.TrangThai)) {
        throw new ShowtimeError(400, 'Trạng thái suất chiếu không hợp lệ.');
    }

    return item;
}
// -------------------- KIỂM TRA PHIM VÀ PHÒNG --------------------
async function checkMovieAndRoom(item) {
    const [movies] = await db.execute(
        'SELECT MaPhim FROM Phim WHERE MaPhim = ?',
        [item.MaPhim]
    );

    if (movies.length === 0) {
        throw new ShowtimeError(400, 'Mã phim không tồn tại.');
    }

    const [rooms] = await db.execute(
        'SELECT MaPhong FROM PhongChieu WHERE MaPhong = ?',
        [item.MaPhong]
    );

    if (rooms.length === 0) {
        throw new ShowtimeError(400, 'Mã phòng không tồn tại.');
    }
}
// ------------------- KIỂM TRA TRÙNG LỊCH PHÒNG --------------------
async function checkRoomConflict(item, excludeId = null) {
    // Suất chiếu đã hủy không chiếm lịch phòng.
    if (item.TrangThai === 'Huy') return;

    let sql = `
        SELECT MaSuatChieu
        FROM SuatChieu
        WHERE MaPhong = ?
          AND NgayChieu BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)
          AND TrangThai <> 'Huy'
          AND TIMESTAMP(NgayChieu, GioBatDau) < TIMESTAMP(DATE_ADD(?, INTERVAL ? DAY), ?)
          AND TIMESTAMP(DATE_ADD(NgayChieu, INTERVAL (GioKetThuc < GioBatDau) DAY), GioKetThuc)
              > TIMESTAMP(?, ?)
    `;

    const params = [
        item.MaPhong,
        item.NgayChieu,
        item.NgayChieu,
        item.NgayChieu,
        Number(item.GioKetThuc < item.GioBatDau),
        item.GioKetThuc,
        item.NgayChieu,
        item.GioBatDau
    ];

    // Khi sửa, không so sánh suất chiếu với chính nó.
    if (excludeId) {
        sql += ' AND MaSuatChieu <> ?';
        params.push(excludeId);
    }

    sql += ' LIMIT 1';

    const [conflicts] = await db.execute(sql, params);

    if (conflicts.length > 0) {
        throw new ShowtimeError(409, 'Phòng chiếu đã có suất chiếu trùng thời gian.');
    }
}
const movieNameSearch = vietnameseSearchColumn('p.TenPhim');
const roomNameSearch = vietnameseSearchColumn('r.TenPhong');

const showtimeList = createSnapshotList({
    store: snapshotStore,
    pool: db,
    scope: 'suat-chieu',
    query: {
        accentInsensitive: true,
        searchColumns: [vietnameseSearchColumn('s.MaSuatChieu'), movieNameSearch, roomNameSearch],
        filters: {
            maSuatChieu: { type: 'exact', column: 's.MaSuatChieu', maxLength: 20 },
            tenPhim: { type: 'text', column: movieNameSearch, operator: 'contains', maxLength: 150 },
            tenPhong: { type: 'text', column: roomNameSearch, operator: 'contains', maxLength: 50 },
            maPhim: { type: 'exact', column: 's.MaPhim', maxLength: 15, multiple: true },
            maPhong: { type: 'exact', column: 's.MaPhong', maxLength: 10, multiple: true },
            trangThai: { type: 'enum', column: 's.TrangThai', values: allowedStatuses, multiple: true },
            tuNgay: { type: 'date', column: 's.NgayChieu', operator: '>=' },
            denNgay: { type: 'date', column: 's.NgayChieu', operator: '<=' },
            gioTu: { type: 'time', column: 's.GioBatDau', operator: '>=' },
            gioDen: { type: 'time', column: 's.GioBatDau', operator: '<=' },
            giaMin: { type: 'decimal' },
            giaMax: { type: 'decimal' }
        },
        ranges: [['tuNgay', 'denNgay'], ['gioTu', 'gioDen'], ['giaMin', 'giaMax']],
        sort: {
            lich: ['s.NgayChieu', 's.GioBatDau'],
            phong: 'CONVERT(r.TenPhong USING utf8mb4) COLLATE utf8mb4_vi_0900_ai_ci',
            phim: 'CONVERT(p.TenPhim USING utf8mb4) COLLATE utf8mb4_vi_0900_ai_ci',
            giaVe: 's.GiaVe',
            maSuatChieu: 's.MaSuatChieu'
        },
        defaultSort: 'lich:asc',
        tieBreakers: ['s.MaSuatChieu']
    },
    async load(connection, { filters, conditions, params, orderBy }) {
        if (filters.giaMin !== undefined) {
            conditions.push('s.GiaVe >= CAST(? AS DECIMAL(18,2))');
            params.push(filters.giaMin);
        }
        if (filters.giaMax !== undefined) {
            conditions.push('s.GiaVe <= CAST(? AS DECIMAL(18,2))');
            params.push(filters.giaMax);
        }
        const [items] = await connection.execute(`
            SELECT s.MaSuatChieu, s.MaPhim, p.TenPhim, s.MaPhong, r.TenPhong,
                DATE_FORMAT(s.NgayChieu, '%Y-%m-%d') AS NgayChieu,
                TIME_FORMAT(s.GioBatDau, '%H:%i:%s') AS GioBatDau,
                TIME_FORMAT(s.GioKetThuc, '%H:%i:%s') AS GioKetThuc,
                s.GiaVe, s.TrangThai
            FROM SuatChieu s
            JOIN Phim p ON p.MaPhim = s.MaPhim
            JOIN PhongChieu r ON r.MaPhong = s.MaPhong
            ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
            ORDER BY ${orderBy}
        `, params);
        return { items };
    },
    workbook: ({ items }) => ({
        filename: 'suat-chieu',
        sheets: [{
            name: 'Suất chiếu',
            columns: [['Mã suất', 18], ['Phim', 36], ['Phòng', 24], ['Ngày chiếu', 17, 'dd/mm/yyyy'],
                ['Bắt đầu', 14], ['Kết thúc', 23], ['Giá vé', 18, '#,##0.##" ₫"'], ['Trạng thái', 18]],
            rows: items.map(show => [
                show.MaSuatChieu, show.TenPhim, show.TenPhong, new Date(show.NgayChieu + 'T00:00:00Z'),
                show.GioBatDau, show.GioKetThuc + (show.GioKetThuc < show.GioBatDau ? ' (+1 ngày)' : ''),
                Number(show.GiaVe), statusLabels[show.TrangThai] ?? show.TrangThai
            ])
        }]
    })
});
router.get('/', showtimeList.list);
router.get('/xuat', showtimeList.exportXlsx);
// -------------------- THÊM SUẤT CHIẾU --------------------
router.post('/', async (req, res, next) => {
    try {
        const item = validateShowtime(req.body);

        await checkMovieAndRoom(item);
        await checkRoomConflict(item);

        await db.execute(`
            INSERT INTO SuatChieu
                (MaSuatChieu, MaPhim, MaPhong, NgayChieu,
                 GioBatDau, GioKetThuc, GiaVe, TrangThai)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            item.MaSuatChieu,
            item.MaPhim,
            item.MaPhong,
            item.NgayChieu,
            item.GioBatDau,
            item.GioKetThuc,
            item.GiaVe,
            item.TrangThai
        ]);

        res.status(201).json({
            message: 'Thêm suất chiếu thành công.'
        });
    } catch (error) {
        next(error);
    }
});
// -------------------- SỬA SUẤT CHIẾU --------------------
router.put('/:maSuatChieu', async (req, res, next) => {
    try {
        const maSuatChieu = req.params.maSuatChieu;
        const item = validateShowtime(req.body, maSuatChieu);

        const [existing] = await db.execute(
            'SELECT MaSuatChieu FROM SuatChieu WHERE MaSuatChieu = ?',
            [maSuatChieu]
        );

        if (existing.length === 0) {
            throw new ShowtimeError(404, 'Không tìm thấy suất chiếu cần sửa.');
        }

        await checkMovieAndRoom(item);
        await checkRoomConflict(item, maSuatChieu);

        await db.execute(`
            UPDATE SuatChieu
            SET
                MaPhim = ?,
                MaPhong = ?,
                NgayChieu = ?,
                GioBatDau = ?,
                GioKetThuc = ?,
                GiaVe = ?,
                TrangThai = ?
            WHERE MaSuatChieu = ?
        `, [
            item.MaPhim,
            item.MaPhong,
            item.NgayChieu,
            item.GioBatDau,
            item.GioKetThuc,
            item.GiaVe,
            item.TrangThai,
            maSuatChieu
        ]);

        res.json({
            message: 'Cập nhật suất chiếu thành công.'
        });
    } catch (error) {
        next(error);
    }
});
// -------------------- XÓA SUẤT CHIẾU --------------------
router.delete('/:maSuatChieu', async (req, res, next) => {
    try {
        const maSuatChieu = req.params.maSuatChieu;

        const [result] = await db.execute(
            'DELETE FROM SuatChieu WHERE MaSuatChieu = ?',
            [maSuatChieu]
        );

        if (result.affectedRows === 0) {
            throw new ShowtimeError(404, 'Không tìm thấy suất chiếu cần xóa.');
        }

        res.json({
            message: 'Xóa suất chiếu thành công.'
        });
    } catch (error) {
        next(error);
    }
});
// -------------------- XỬ LÝ LỖI --------------------
router.use((error, _req, res, _next) => {
    if (error instanceof ShowtimeError) {
        return res.status(error.status).json({
            message: error.message
        });
    }

    if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
            message: 'Mã suất chiếu đã tồn tại.'
        });
    }

    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({
            message: 'Suất chiếu đã có vé hoặc dữ liệu liên quan nên không thể xóa.'
        });
    }

    if (error.code === 'ER_SIGNAL_EXCEPTION') {
        return res.status(409).json({ message: 'Lịch chiếu xung đột hoặc thay đổi vi phạm quy tắc của suất đã có vé.' });
    }
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(409).json({ message: 'Phim hoặc phòng chiếu không còn tồn tại.' });
    }

    console.error(error.code || error.name);

    res.status(500).json({
        message: 'Máy chủ không xử lý được yêu cầu.'
    });
});

module.exports = router;
