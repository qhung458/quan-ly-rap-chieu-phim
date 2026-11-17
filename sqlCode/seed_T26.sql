-- DU LIEU TEST RIENG: chay mot lan sau addSample.sql, TRUOC create_trigger.sql.
-- Khong thay doi cac suat SC001-SC060; cac suat T26 o ngay mai.
START TRANSACTION;
SET @NgayTest = DATE_ADD(CURDATE(), INTERVAL 1 DAY);
INSERT INTO SuatChieu
(MaSuatChieu, MaPhim, MaPhong, NgayChieu, GioBatDau, GioKetThuc, GiaVe, TrangThai)
VALUES
('T26_TRONG','P001','PC01',@NgayTest,'08:00:00','10:11:00',85000,'SapChieu'),
('T26_DAY','P001','PC01',@NgayTest,'11:00:00','13:11:00',85000,'SapChieu'),
('T26_HUY_BANLAI','P001','PC01',@NgayTest,'14:00:00','16:11:00',85000,'SapChieu');
-- 19 ghe dung duoc, bo G010 bao tri; 1 ve DaSuDung de test tinh chiem cho.
INSERT INTO Ve (MaVe,MaSuatChieu,MaKhachHang,MaGhe,NgayDat,GiaVe,TrangThai)
SELECT CONCAT('T26F_',MaGhe),'T26_DAY','KH001',MaGhe,NOW(),85000,
       CASE WHEN MaGhe = 'G001' THEN 'DaSuDung' ELSE 'DaDat' END
FROM Ghe WHERE MaPhong = 'PC01' AND TrangThai <> 'BaoTri';
-- Luu ve huy va ve ban lai cung ghe/suat (duoc phep voi UNIQUE moi).
INSERT INTO Ve (MaVe,MaSuatChieu,MaKhachHang,MaGhe,NgayDat,GiaVe,TrangThai) VALUES
('T26_HUY','T26_HUY_BANLAI','KH001','G001',NOW(),85000,'DaHuy'),
('T26_BANLAI','T26_HUY_BANLAI','KH002','G001',NOW(),85000,'DaDat');
COMMIT;
-- Ket qua T25 mong doi: T26_TRONG=19, T26_DAY=0, T26_HUY_BANLAI=18.
-- Ma suat KHONG_TON_TAI: can quy uoc tra NULL/bao loi, khong nham voi het ghe.
