
const express = require('express');
const db = require('./db.cjs');
const { requireLogin, requireAdmin } = require('./auth.cjs');

const router = express.Router();
router.use(requireLogin);
// -------------------- KIỂM TRA DỮ LIỆU --------------------
class ShowtimeError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function validateShowtime(body, maSuatChieu = null) {
    const item = {
        MaSuatChieu: String(maSuatChieu ?? body.MaSuatChieu ?? '').trim(),
        MaPhim: String(body.MaPhim ?? '').trim(),
        MaPhong: String(body.MaPhong ?? '').trim(),
        NgayChieu: String(body.NgayChieu ?? ''),
        GioBatDau: String(body.GioBatDau ?? ''),
        GioKetThuc: String(body.GioKetThuc ?? ''),
        GiaVe: Number(body.GiaVe),
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

   // Kiểm tra ngày chiếu theo định dạng YYYY-MM-DD.
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dateMatch = item.NgayChieu.match(datePattern);

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

    if (item.GioBatDau >= item.GioKetThuc) {
        throw new ShowtimeError(400, 'Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.');
    }

    if (!Number.isFinite(item.GiaVe) || item.GiaVe <= 0) {
        throw new ShowtimeError(400, 'Giá vé phải lớn hơn 0.');
    }

    const allowedStatuses = ['SapChieu', 'DangChieu', 'KetThuc', 'Huy'];

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
          AND NgayChieu = ?
          AND TrangThai <> 'Huy'
          AND GioBatDau < ?
          AND GioKetThuc > ?
    `;

    const params = [
        item.MaPhong,
        item.NgayChieu,
        item.GioKetThuc,
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
// -------------------- LẤY DANH SÁCH SUẤT CHIẾU --------------------
router.get('/', async (_req, res, next) => {
    try {
        const [rows] = await db.execute(`
            SELECT
                MaSuatChieu,
                MaPhim,
                MaPhong,
                DATE_FORMAT(NgayChieu, '%Y-%m-%d') AS NgayChieu,
                TIME_FORMAT(GioBatDau, '%H:%i') AS GioBatDau,
                TIME_FORMAT(GioKetThuc, '%H:%i') AS GioKetThuc,
                GiaVe,
                TrangThai
            FROM SuatChieu
            ORDER BY NgayChieu, GioBatDau
        `);

        res.json(rows);
    } catch (error) {
        next(error);
    }
});
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
// Chỉ quản trị viên được xóa suất chiếu.
router.delete('/:maSuatChieu', requireAdmin, async (req, res, next) => {
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

    console.error(error.code || error.name);

    res.status(500).json({
        message: 'Máy chủ không xử lý được yêu cầu.'
    });
});

module.exports = router;
