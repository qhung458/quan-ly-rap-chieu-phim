-- MySQL 8.0.16+. Nap du lieu lich su truoc khi cai trigger.
CREATE TABLE IF NOT EXISTS CauHinhHeThong (
    TenThamSo VARCHAR(50) PRIMARY KEY,
    GiaTri INT NOT NULL,
    MoTa VARCHAR(200),
    CHECK (GiaTri >= 0)
);
INSERT INTO CauHinhHeThong (TenThamSo, GiaTri, MoTa) VALUES
('PHUT_NGUNG_BAN', 5, 'Ngung ban ve khi con duoi 5 phut'),
('PHUT_NGUNG_HUY', 60, 'Ngung huy/doi ve khi con duoi 60 phut')
ON DUPLICATE KEY UPDATE TenThamSo = CauHinhHeThong.TenThamSo;

DELIMITER //
DROP TRIGGER IF EXISTS trg_Ve_BeforeInsert //
DROP TRIGGER IF EXISTS trg_Ve_BeforeUpdate //
DROP TRIGGER IF EXISTS trg_Ghe_BeforeUpdate //
DROP TRIGGER IF EXISTS trg_SuatChieu_BeforeInsert //
DROP TRIGGER IF EXISTS trg_SuatChieu_BeforeUpdate //
DROP PROCEDURE IF EXISTS usp_KiemTraDatVe //
DROP PROCEDURE IF EXISTS usp_KiemTraLichPhong //












CREATE PROCEDURE usp_KiemTraDatVe(
    IN p_MaSuatChieu VARCHAR(20),
    IN p_MaGhe VARCHAR(15)
)
BEGIN
    DECLARE v_PhongSuat VARCHAR(10);
    DECLARE v_PhongGhe VARCHAR(10);
    DECLARE v_TrangThaiSuat VARCHAR(20);
    DECLARE v_BatDau DATETIME;
    DECLARE v_PhutBan INT;

    SELECT MaPhong, TrangThai, TIMESTAMP(NgayChieu, GioBatDau)
      INTO v_PhongSuat, v_TrangThaiSuat, v_BatDau
      FROM SuatChieu WHERE MaSuatChieu = p_MaSuatChieu FOR SHARE;
    SELECT MaPhong INTO v_PhongGhe
      FROM Ghe WHERE MaGhe = p_MaGhe FOR SHARE;

    IF v_PhongSuat IS NULL OR v_PhongGhe IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Suat chieu hoac ghe khong ton tai.';
    END IF;
    IF v_PhongSuat <> v_PhongGhe THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ghe khong thuoc phong cua suat chieu.';
    END IF;
    IF v_TrangThaiSuat <> 'SapChieu' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Suat chieu khong mo ban ve.';
    END IF;
    SELECT COALESCE(MAX(GiaTri), 5) INTO v_PhutBan
      FROM CauHinhHeThong WHERE TenThamSo = 'PHUT_NGUNG_BAN';
    IF v_BatDau <= NOW() OR v_BatDau < DATE_ADD(NOW(), INTERVAL v_PhutBan MINUTE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Suat chieu da qua han ban ve.';
    END IF;
END //















CREATE TRIGGER trg_Ve_BeforeInsert
BEFORE INSERT ON Ve FOR EACH ROW
BEGIN
    IF NEW.TrangThai <> 'DaDat' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ve moi phai co trang thai DaDat.';
    END IF;
    CALL usp_KiemTraDatVe(NEW.MaSuatChieu, NEW.MaGhe);
END //

CREATE TRIGGER trg_Ve_BeforeUpdate
BEFORE UPDATE ON Ve FOR EACH ROW
BEGIN
    DECLARE v_DoiCho BOOLEAN;
    DECLARE v_BatDauCu DATETIME;
    DECLARE v_TrangThaiSuatCu VARCHAR(20);
    DECLARE v_PhutHuy INT;

    SET v_DoiCho = NEW.MaSuatChieu <> OLD.MaSuatChieu OR NEW.MaGhe <> OLD.MaGhe;

    IF OLD.TrangThai <> 'DaDat' AND (v_DoiCho OR NEW.TrangThai <> OLD.TrangThai) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ve da su dung hoac da huy khong the doi trang thai hay cho ngoi.';
    END IF;
    IF v_DoiCho AND NEW.TrangThai <> 'DaDat' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Doi ve phai giu trang thai DaDat.';
    END IF;

    IF v_DoiCho OR NEW.TrangThai <> OLD.TrangThai THEN
        SELECT TIMESTAMP(NgayChieu, GioBatDau), TrangThai
          INTO v_BatDauCu, v_TrangThaiSuatCu
          FROM SuatChieu WHERE MaSuatChieu = OLD.MaSuatChieu FOR SHARE;
    END IF;

    IF v_DoiCho OR (OLD.TrangThai = 'DaDat' AND NEW.TrangThai = 'DaHuy') THEN
        SELECT COALESCE(MAX(GiaTri), 60) INTO v_PhutHuy
          FROM CauHinhHeThong WHERE TenThamSo = 'PHUT_NGUNG_HUY';
        IF v_BatDauCu <= NOW() OR v_BatDauCu < DATE_ADD(NOW(), INTERVAL v_PhutHuy MINUTE) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Suat hien tai da qua han huy/doi ve.';
        END IF;
    END IF;

    IF v_DoiCho THEN
        CALL usp_KiemTraDatVe(NEW.MaSuatChieu, NEW.MaGhe);
    ELSEIF NEW.TrangThai = 'DaSuDung' AND OLD.TrangThai = 'DaDat' AND v_TrangThaiSuatCu = 'Huy' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Khong the su dung ve cua suat da huy.';
    END IF;
END //

CREATE TRIGGER trg_Ghe_BeforeUpdate
BEFORE UPDATE ON Ghe FOR EACH ROW
BEGIN
    IF NEW.MaPhong <> OLD.MaPhong AND EXISTS (
        SELECT 1 FROM Ve WHERE MaGhe = OLD.MaGhe FOR SHARE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Khong the chuyen phong cua ghe da co ve.';
    END IF;
END //

CREATE PROCEDURE usp_KiemTraLichPhong(
    IN p_MaPhong VARCHAR(10),
    IN p_Ngay DATE,
    IN p_BatDau TIME,
    IN p_KetThuc TIME,
    IN p_SuatCu VARCHAR(20)
)
BEGIN
    DECLARE v_Phong VARCHAR(10);
    DECLARE v_BatDau DATETIME;
    DECLARE v_KetThuc DATETIME;
    SET v_BatDau = TIMESTAMP(p_Ngay, p_BatDau);
    SET v_KetThuc = TIMESTAMP(DATE_ADD(p_Ngay, INTERVAL (p_KetThuc < p_BatDau) DAY), p_KetThuc);

    -- Cac giao dich xep lich cung phong phai lay khoa tren cung mot dong.
    SELECT MaPhong INTO v_Phong
      FROM PhongChieu WHERE MaPhong = p_MaPhong FOR UPDATE;
    IF EXISTS (
        SELECT 1 FROM SuatChieu sc
        WHERE sc.MaPhong = p_MaPhong
          AND sc.NgayChieu BETWEEN DATE_SUB(p_Ngay, INTERVAL 1 DAY) AND DATE_ADD(p_Ngay, INTERVAL 1 DAY)
          AND sc.TrangThai <> 'Huy'
          AND (p_SuatCu IS NULL OR sc.MaSuatChieu <> p_SuatCu)
          AND TIMESTAMP(sc.NgayChieu, sc.GioBatDau) < v_KetThuc
          AND TIMESTAMP(
              DATE_ADD(sc.NgayChieu, INTERVAL (sc.GioKetThuc < sc.GioBatDau) DAY),
              sc.GioKetThuc
          ) > v_BatDau
        FOR SHARE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Suat chieu chong gio voi suat khac trong cung phong.';
    END IF;
END //

CREATE TRIGGER trg_SuatChieu_BeforeInsert
BEFORE INSERT ON SuatChieu FOR EACH ROW
BEGIN
    IF NEW.TrangThai <> 'Huy' THEN
        CALL usp_KiemTraLichPhong(NEW.MaPhong, NEW.NgayChieu, NEW.GioBatDau, NEW.GioKetThuc, NULL);
    END IF;
END //

CREATE TRIGGER trg_SuatChieu_BeforeUpdate
BEFORE UPDATE ON SuatChieu FOR EACH ROW
BEGIN
    IF NEW.MaPhong <> OLD.MaPhong AND EXISTS (
        SELECT 1 FROM Ve WHERE MaSuatChieu = OLD.MaSuatChieu FOR SHARE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Khong the doi phong cua suat da co ve.';
    END IF;

    IF NEW.TrangThai <> 'Huy' AND (
        OLD.TrangThai = 'Huy' OR NEW.MaPhong <> OLD.MaPhong OR NEW.NgayChieu <> OLD.NgayChieu
        OR NEW.GioBatDau <> OLD.GioBatDau OR NEW.GioKetThuc <> OLD.GioKetThuc
    ) THEN
        CALL usp_KiemTraLichPhong(NEW.MaPhong, NEW.NgayChieu, NEW.GioBatDau, NEW.GioKetThuc, OLD.MaSuatChieu);
    END IF;
END //
DELIMITER ;
