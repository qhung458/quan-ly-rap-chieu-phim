DROP PROCEDURE IF EXISTS usp_TimSuatChieuTheoPhimVaNgay;

DELIMITER $$

CREATE PROCEDURE usp_TimSuatChieuTheoPhimVaNgay(
    IN p_MaPhim VARCHAR(15),
    IN p_Ngay DATE
)
BEGIN
    SELECT
        sc.MaSuatChieu,
        p.MaPhim,
        p.TenPhim,
        sc.NgayChieu,
        sc.GioBatDau,
        pc.MaPhong,
        pc.TenPhong,
        pc.LoaiPhong,
        sc.GiaVe,
        sc.TrangThai
    FROM SuatChieu AS sc
    INNER JOIN Phim AS p
        ON p.MaPhim = sc.MaPhim
    INNER JOIN PhongChieu AS pc
        ON pc.MaPhong = sc.MaPhong
    WHERE sc.MaPhim = p_MaPhim
      AND sc.NgayChieu = p_Ngay
    ORDER BY sc.GioBatDau ASC;
END $$
DELIMITER ;


