-- Du lieu kiem thu rieng. Chay sau addSample.sql (va co the chay sau create_trigger.sql).
-- Dung phong T26 de cach ly lich kiem thu khoi lich mau.
START TRANSACTION;
SET @NgayTest = '2099-06-01';

INSERT INTO PhongChieu (MaPhong, TenPhong, SoGhe, LoaiPhong)
VALUES ('PC_T26', 'Phong kiem thu T26', 20, '2D');
INSERT INTO Ghe (MaGhe, MaPhong, SoHang, SoGhe, LoaiGhe)
SELECT CONCAT('T26_', MaGhe), 'PC_T26', SoHang, SoGhe, LoaiGhe
FROM Ghe WHERE MaPhong = 'PC01';

INSERT INTO SuatChieu
    (MaSuatChieu, MaPhim, MaPhong, NgayChieu, GioBatDau, GioKetThuc, GiaVe)
VALUES
    ('T26_TRONG', 'P001', 'PC_T26', @NgayTest, '08:00:00', '10:11:00', 85000),
    ('T26_DAY', 'P001', 'PC_T26', @NgayTest, '11:00:00', '13:11:00', 85000),
    ('T26_HUY_BANLAI', 'P001', 'PC_T26', @NgayTest, '14:00:00', '16:11:00', 85000);

INSERT INTO Ve (MaVe, MaSuatChieu, MaKhachHang, MaGhe, NgayDat, GiaVe)
SELECT CONCAT('T26F_', RIGHT(g.MaGhe, 3)), 'T26_DAY', 'KH001', g.MaGhe, NOW(), 85000
FROM Ghe g
WHERE g.MaPhong = 'PC_T26';

UPDATE Ve SET TrangThai = 'DaSuDung' WHERE MaVe = 'T26F_001';

INSERT INTO Ve (MaVe, MaSuatChieu, MaKhachHang, MaGhe, NgayDat, GiaVe)
VALUES ('T26_HUY', 'T26_HUY_BANLAI', 'KH001', 'T26_G001', NOW(), 85000);
UPDATE Ve SET TrangThai = 'DaHuy' WHERE MaVe = 'T26_HUY';
INSERT INTO Ve (MaVe, MaSuatChieu, MaKhachHang, MaGhe, NgayDat, GiaVe)
VALUES ('T26_BANLAI', 'T26_HUY_BANLAI', 'KH002', 'T26_G001', NOW(), 85000);
COMMIT;
