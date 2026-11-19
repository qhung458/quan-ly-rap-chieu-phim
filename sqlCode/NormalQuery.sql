-- Doanh thu ve theo ngay chieu. Loai ve huy va suat huy.

SET @TuNgay = '2026-11-05';
SET @DenNgay = '2026-11-06';

SELECT @TuNgay AS TuNgay, @DenNgay AS DenNgay;

SELECT
    p.MaPhim,
    p.TenPhim,
    COUNT(v.MaVe) AS TongSoVe,
    COALESCE(SUM(v.GiaVe), 0) AS TongDoanhThuVe
FROM Phim AS p
LEFT JOIN SuatChieu AS sc
    ON sc.MaPhim = p.MaPhim
    AND sc.TrangThai <> 'Huy'
    AND sc.NgayChieu >= @TuNgay
    AND sc.NgayChieu < DATE_ADD(@DenNgay, INTERVAL 1 DAY)
LEFT JOIN Ve AS v
    ON v.MaSuatChieu = sc.MaSuatChieu
    AND v.TrangThai IN ('DaDat', 'DaSuDung')
GROUP BY
    p.MaPhim,
    p.TenPhim
ORDER BY
    TongDoanhThuVe DESC,
    p.TenPhim ASC;
    
    
-- hưng: doanh thu theo từng ngày, tháng
SET @TuNgay = '2026-11-05';
SET @DenNgay = '2026-11-06';

-- 1. Thống kê theo từng ngày.
SELECT
    sc.NgayChieu,
    COUNT(v.MaVe) AS TongSoVe,
    COALESCE(SUM(v.GiaVe), 0) AS DoanhThuVe
FROM SuatChieu sc
LEFT JOIN Ve v
    ON v.MaSuatChieu = sc.MaSuatChieu
   AND v.TrangThai IN ('DaDat', 'DaSuDung')
WHERE sc.NgayChieu >= @TuNgay
  AND sc.TrangThai <> 'Huy'
  AND sc.NgayChieu < DATE_ADD(@DenNgay, INTERVAL 1 DAY)
GROUP BY sc.NgayChieu
ORDER BY sc.NgayChieu;


-- 2. Thống kê theo từng tháng trong khoảng ngày đã chọn.
SELECT
    YEAR(sc.NgayChieu) AS Nam,
    MONTH(sc.NgayChieu) AS Thang,
    COUNT(v.MaVe) AS TongSoVe,
    COALESCE(SUM(v.GiaVe), 0) AS DoanhThuVe
FROM SuatChieu sc
LEFT JOIN Ve v
    ON v.MaSuatChieu = sc.MaSuatChieu
   AND v.TrangThai IN ('DaDat', 'DaSuDung')
WHERE sc.NgayChieu >= @TuNgay
  AND sc.TrangThai <> 'Huy'
  AND sc.NgayChieu < DATE_ADD(@DenNgay, INTERVAL 1 DAY)
GROUP BY YEAR(sc.NgayChieu), MONTH(sc.NgayChieu)
ORDER BY Nam, Thang;


-- 3. Tổng cả khoảng ngày để đối chiếu.
SELECT
    @TuNgay AS TuNgay,
    @DenNgay AS DenNgay,
    COUNT(v.MaVe) AS TongSoVe,
    COALESCE(SUM(v.GiaVe), 0) AS TongDoanhThuVe
FROM SuatChieu sc
LEFT JOIN Ve v
    ON v.MaSuatChieu = sc.MaSuatChieu
   AND v.TrangThai IN ('DaDat', 'DaSuDung')
WHERE sc.NgayChieu >= @TuNgay
  AND sc.TrangThai <> 'Huy'
  AND sc.NgayChieu < DATE_ADD(@DenNgay, INTERVAL 1 DAY);
