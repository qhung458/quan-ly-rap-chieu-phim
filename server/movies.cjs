
const express = require('express');
const db = require('./db.cjs');
const { requireLogin, requireAdmin } = require('./auth.cjs');

const router = express.Router();
router.use(requireLogin);
// -------------------- KIỂM TRA DỮ LIỆU PHIM --------------------
class MovieError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function validateMovie(body) {
    const movie = {
        MaPhim: String(body.MaPhim ?? '').trim(),
        TenPhim: String(body.TenPhim ?? '').trim(),
        TheLoai: String(body.TheLoai ?? '').trim(),
        DaoDien: String(body.DaoDien ?? '').trim() || null,
        ThoiLuong: Number(body.ThoiLuong),
        NgayKhoiChieu: String(body.NgayKhoiChieu ?? ''),
        DoTuoiChoPhep: Number(body.DoTuoiChoPhep)
    };

    if (!movie.MaPhim || movie.MaPhim.length > 15) {
        throw new MovieError(400, 'Mã phim không được để trống và tối đa 15 ký tự.');
    }

    if (!movie.TenPhim || movie.TenPhim.length > 150) {
        throw new MovieError(400, 'Tên phim không được để trống và tối đa 150 ký tự.');
    }

    if (!movie.TheLoai || movie.TheLoai.length > 100) {
        throw new MovieError(400, 'Thể loại không được để trống và tối đa 100 ký tự.');
    }

    if (movie.DaoDien && movie.DaoDien.length > 100) {
        throw new MovieError(400, 'Tên đạo diễn tối đa 100 ký tự.');
    }

    if (!Number.isInteger(movie.ThoiLuong) || movie.ThoiLuong <= 0) {
        throw new MovieError(400, 'Thời lượng phim phải là số nguyên lớn hơn 0.');
    }

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const date = new Date(movie.NgayKhoiChieu + 'T00:00:00');

    if (
        !datePattern.test(movie.NgayKhoiChieu) ||
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== movie.NgayKhoiChieu
    ) {
        throw new MovieError(400, 'Ngày khởi chiếu không hợp lệ.');
    }

    if (!Number.isInteger(movie.DoTuoiChoPhep) || movie.DoTuoiChoPhep < 0) {
        throw new MovieError(400, 'Độ tuổi cho phép phải là số nguyên không âm.');
    }

    return movie;
}
// -------------------- LẤY DANH SÁCH PHIM --------------------
router.get('/', async (_req, res, next) => {
    try {
        const [rows] = await db.execute(`
            SELECT
                MaPhim,
                TenPhim,
                TheLoai,
                DaoDien,
                ThoiLuong,
                DATE_FORMAT(NgayKhoiChieu, '%Y-%m-%d') AS NgayKhoiChieu,
                DoTuoiChoPhep
            FROM Phim
            ORDER BY MaPhim
        `);

        res.json(rows);
    } catch (error) {
        next(error);
    }
});
// -------------------- THEM PHIM --------------------
router.post('/', async (req, res, next) => {
    try {
        const movie = validateMovie(req.body);

        await db.execute(`
            INSERT INTO Phim
                (MaPhim, TenPhim, TheLoai, DaoDien,
                 ThoiLuong, NgayKhoiChieu, DoTuoiChoPhep)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            movie.MaPhim,
            movie.TenPhim,
            movie.TheLoai,
            movie.DaoDien,
            movie.ThoiLuong,
            movie.NgayKhoiChieu,
            movie.DoTuoiChoPhep
        ]);

        res.status(201).json({
            message: 'Thêm phim thành công.'
        });
    } catch (error) {
        next(error);
    }
});
// -------------------- SỬA PHIM --------------------
router.put('/:maPhim', async (req, res, next) => {
    try {
        const maPhim = req.params.maPhim;
        const movie = validateMovie({
            ...req.body,
            MaPhim: maPhim
        });

        const [existing] = await db.execute(
            'SELECT MaPhim FROM Phim WHERE MaPhim = ?',
            [maPhim]
        );

        if (existing.length === 0) {
            throw new MovieError(404, 'Không tìm thấy phim cần sửa.');
        }

        await db.execute(`
            UPDATE Phim
            SET
                TenPhim = ?,
                TheLoai = ?,
                DaoDien = ?,
                ThoiLuong = ?,
                NgayKhoiChieu = ?,
                DoTuoiChoPhep = ?
            WHERE MaPhim = ?
        `, [
            movie.TenPhim,
            movie.TheLoai,
            movie.DaoDien,
            movie.ThoiLuong,
            movie.NgayKhoiChieu,
            movie.DoTuoiChoPhep,
            maPhim
        ]);

        res.json({
            message: 'Cập nhật phim thành công.'
        });
    } catch (error) {
        next(error);
    }
});
// -------------------- XÓA PHIM --------------------
// Chỉ quản trị viên được xóa phim.
router.delete('/:maPhim', requireAdmin, async (req, res, next) => {
    try {
        const maPhim = req.params.maPhim;

        const [result] = await db.execute(
            'DELETE FROM Phim WHERE MaPhim = ?',
            [maPhim]
        );

        if (result.affectedRows === 0) {
            throw new MovieError(404, 'Không tìm thấy phim cần xóa.');
        }

        res.json({
            message: 'Xóa phim thành công.'
        });
    } catch (error) {
        next(error);
    }
});
// -------------------- XỬ LÝ LỖI --------------------
router.use((error, _req, res, _next) => {
    if (error instanceof MovieError) {
        return res.status(error.status).json({
            message: error.message
        });
    }

    if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
            message: 'Mã phim đã tồn tại.'
        });
    }

    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({
            message: 'Phim đã có suất chiếu nên không thể xóa.'
        });
    }

    console.error(error.code || error.name);

    res.status(500).json({
        message: 'Máy chủ không xử lý được yêu cầu.'
    });
});
module.exports = router;
