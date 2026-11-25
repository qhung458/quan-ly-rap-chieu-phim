
const express = require('express');
const db = require('./db.cjs');
const { requireLogin } = require('./auth.cjs');
const { normalizeSearchText, vietnameseSearchColumn } = require('./list-query.cjs');
const { createSnapshotList } = require('./snapshot-list.cjs');
const store = require('./snapshot-store.cjs');

const router = express.Router();
router.use(requireLogin);
// -------------------- KIỂM TRA DỮ LIỆU PHIM --------------------
class MovieError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function validateMovie(body = {}) {
    const movie = {
        MaPhim: String(body.MaPhim ?? '').trim(),
        TenPhim: String(body.TenPhim ?? '').trim(),
        TheLoai: String(body.TheLoai ?? '').trim(),
        DaoDien: String(body.DaoDien ?? '').trim() || null,
        ThoiLuong: Number(body.ThoiLuong),
        NgayKhoiChieu: String(body.NgayKhoiChieu ?? ''),
        DoTuoiChoPhep: Number(body.DoTuoiChoPhep ?? 0)
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

    if (!Number.isInteger(movie.ThoiLuong) || movie.ThoiLuong <= 0 || movie.ThoiLuong > 2147483647) {
        throw new MovieError(400, 'Thời lượng phim phải là số nguyên lớn hơn 0.');
    }

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const date = new Date(movie.NgayKhoiChieu + 'T00:00:00Z');

    if (
        !datePattern.test(movie.NgayKhoiChieu) ||
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== movie.NgayKhoiChieu
    ) {
        throw new MovieError(400, 'Ngày khởi chiếu không hợp lệ.');
    }

    if (!Number.isInteger(movie.DoTuoiChoPhep) || movie.DoTuoiChoPhep < 0 || movie.DoTuoiChoPhep > 2147483647) {
        throw new MovieError(400, 'Độ tuổi cho phép phải là số nguyên không âm.');
    }

    return movie;
}
const titleSearch = vietnameseSearchColumn('p.TenPhim');

function genreLabels(value) {
    return value.split(',').map(label => label.trim().replace(/\s+/gu, ' ')).filter(Boolean);
}

const movieList = createSnapshotList({
    store,
    pool: db,
    scope: 'phim',
    query: {
        accentInsensitive: true,
        searchColumns: [vietnameseSearchColumn('p.MaPhim'), titleSearch],
        filters: {
            maPhim: { type: 'exact', column: 'p.MaPhim', maxLength: 15 },
            tenPhim: { type: 'text', column: titleSearch, operator: 'contains', maxLength: 150 },
            daoDien: { type: 'text', column: vietnameseSearchColumn('p.DaoDien'), operator: 'contains', maxLength: 100 },
            theLoai: { type: 'text', multiple: true },
            tuNgay: { type: 'date', column: 'p.NgayKhoiChieu', operator: '>=' },
            denNgay: { type: 'date', column: 'p.NgayKhoiChieu', operator: '<=' },
            phutMin: { type: 'integer', column: 'p.ThoiLuong', operator: '>=', min: 1, max: 2147483647 },
            phutMax: { type: 'integer', column: 'p.ThoiLuong', operator: '<=', min: 1, max: 2147483647 },
            tuoiToiDa: { type: 'integer', column: 'p.DoTuoiChoPhep', operator: '<=', max: 2147483647 }
        },
        ranges: [['tuNgay', 'denNgay'], ['phutMin', 'phutMax']],
        sort: {
            maPhim: 'p.MaPhim',
            tenPhim: 'CONVERT(p.TenPhim USING utf8mb4) COLLATE utf8mb4_vi_0900_ai_ci',
            ngayKhoiChieu: 'p.NgayKhoiChieu',
            thoiLuong: 'p.ThoiLuong',
            doTuoi: 'p.DoTuoiChoPhep'
        },
        defaultSort: 'maPhim:asc',
        tieBreakers: ['p.MaPhim']
    },
    async load(connection, { filters, conditions, params, orderBy }) {
        const [items] = await connection.execute(`
            SELECT p.MaPhim, p.TenPhim, p.TheLoai, p.DaoDien, p.ThoiLuong,
                   DATE_FORMAT(p.NgayKhoiChieu, '%Y-%m-%d') AS NgayKhoiChieu, p.DoTuoiChoPhep
            FROM Phim p
            ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
            ORDER BY ${orderBy}
        `, params);
        if (!filters.theLoai) return { items };
        const selected = new Set(filters.theLoai);
        // Use the same label normalization as /tuy-chon before creating the snapshot.
        return { items: items.filter(movie => genreLabels(movie.TheLoai)
            .some(label => selected.has(normalizeSearchText(label)))) };
    },
    workbook({ items }) {
        const integer = '#,##0';
        return {
            filename: 'phim',
            sheets: [{
                name: 'Phim',
                columns: [['Mã phim', 16], ['Tên phim', 36], ['Thể loại', 20], ['Đạo diễn', 26],
                    ['Thời lượng (phút)', 20, integer], ['Ngày khởi chiếu', 19, 'dd/mm/yyyy'],
                    ['Độ tuổi tối thiểu', 19, integer]],
                rows: items.map(movie => [movie.MaPhim, movie.TenPhim, movie.TheLoai, movie.DaoDien,
                    movie.ThoiLuong, new Date(movie.NgayKhoiChieu + 'T00:00:00Z'), movie.DoTuoiChoPhep])
            }]
        };
    }
});

router.get('/', movieList.list);
router.get('/xuat', movieList.exportXlsx);

router.get('/tuy-chon', async (_req, res) => {
    const [rows] = await db.execute(`
        SELECT MaPhim, TenPhim, ThoiLuong, TheLoai
        FROM Phim
        ORDER BY MaPhim
    `);
    const genres = new Map();
    const phim = rows.map(({ TheLoai, ...movie }) => {
        for (const label of genreLabels(TheLoai)) {
            const value = normalizeSearchText(label);
            if (value && !genres.has(value)) genres.set(value, { value, label });
        }
        return movie;
    });
    const collator = new Intl.Collator('vi');
    const theLoai = Array.from(genres.values()).sort((a, b) => collator.compare(a.label, b.label));
    res.json({ phim, theLoai });
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
router.delete('/:maPhim', async (req, res, next) => {
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
