-- MySQL 8.0.16+. Nap seed lich su truoc file nay.
-- Ve DaDat/DaSuDung chiem ghe; DaHuy khong chiem ghe.
CREATE TABLE IF NOT EXISTS CauHinhHeThong (
    TenThamSo VARCHAR(50) PRIMARY KEY,
    GiaTri INT NOT NULL,
    MoTa VARCHAR(200),
    CHECK (GiaTri >= 0)
);
INSERT INTO CauHinhHeThong (TenThamSo, GiaTri, MoTa) VALUES
('PHUT_NGUNG_BAN', 5, 'Ngung ban/doi ve khi con duoi 5 phut'),
('PHUT_NGUNG_HUY', 60, 'Ngung huy ve khi con duoi 60 phut')
ON DUPLICATE KEY UPDATE GiaTri = VALUES(GiaTri), MoTa = VALUES(MoTa);

DELIMITER //
DROP TRIGGER IF EXISTS trg_Ve_BeforeInsert //
CREATE TRIGGER trg_Ve_BeforeInsert
BEFORE INSERT ON Ve FOR EACH ROW
BEGIN
    DECLARE v_PhutBan INT DEFAULT 5;
    DECLARE v_NgayGioChieu DATETIME;
    DECLARE v_PhongSuat VARCHAR(10);
    DECLARE v_PhongGhe VARCHAR(10);
    DECLARE v_TrangThaiGhe VARCHAR(20);
    SELECT MAX(MaPhong), MAX(TIMESTAMP(NgayChieu, GioBatDau))
      INTO v_PhongSuat, v_NgayGioChieu
      FROM SuatChieu WHERE MaSuatChieu = NEW.MaSuatChieu;
    SELECT MAX(MaPhong), MAX(TrangThai) INTO v_PhongGhe, v_TrangThaiGhe
      FROM Ghe WHERE MaGhe = NEW.MaGhe;
    IF v_PhongSuat IS NULL OR v_PhongGhe IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Suat chieu hoac ghe khong ton tai.';
    END IF;
    IF v_PhongSuat <> v_PhongGhe THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ghe khong thuoc phong cua suat chieu.';
    END IF;
    IF NEW.TrangThai IN ('DaDat', 'DaSuDung') THEN
        IF v_TrangThaiGhe = 'BaoTri' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Khong the ban ve cho ghe bao tri.';
        END IF;
        SELECT COALESCE(MAX(GiaTri), 5) INTO v_PhutBan
          FROM CauHinhHeThong WHERE TenThamSo = 'PHUT_NGUNG_BAN';
        IF v_NgayGioChieu < DATE_ADD(NOW(), INTERVAL v_PhutBan MINUTE) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Khong the dat ve: suat chieu da ngung ban.';
        END IF;
    END IF;
END //

DROP TRIGGER IF EXISTS trg_Ve_BeforeUpdate //
CREATE TRIGGER trg_Ve_BeforeUpdate
BEFORE UPDATE ON Ve FOR EACH ROW
BEGIN
    DECLARE v_PhutBan INT DEFAULT 5;
    DECLARE v_PhutHuy INT DEFAULT 60;
    DECLARE v_NgayGioChieu DATETIME;
    DECLARE v_NgayGioCu DATETIME;
    DECLARE v_PhongSuat VARCHAR(10);
    DECLARE v_PhongGhe VARCHAR(10);
    DECLARE v_TrangThaiGhe VARCHAR(20);
    SELECT MAX(MaPhong), MAX(TIMESTAMP(NgayChieu, GioBatDau))
      INTO v_PhongSuat, v_NgayGioChieu
      FROM SuatChieu WHERE MaSuatChieu = NEW.MaSuatChieu;
    SELECT MAX(MaPhong), MAX(TrangThai) INTO v_PhongGhe, v_TrangThaiGhe
      FROM Ghe WHERE MaGhe = NEW.MaGhe;
    IF v_PhongSuat IS NULL OR v_PhongGhe IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Suat chieu hoac ghe khong ton tai.';
    END IF;
    IF v_PhongSuat <> v_PhongGhe THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ghe khong thuoc phong cua suat chieu.';
    END IF;
    -- Chi kiem tra bao tri/thoi han ban khi chiem cho moi, doi ghe/suat,
    -- hoac kich hoat lai ve da huy. Khong can kiem tra khi huy ve cu.
    IF NEW.TrangThai IN ('DaDat', 'DaSuDung') AND (
        OLD.TrangThai = 'DaHuy' OR NEW.MaSuatChieu <> OLD.MaSuatChieu
        OR NEW.MaGhe <> OLD.MaGhe
    ) THEN
        IF v_TrangThaiGhe = 'BaoTri' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Khong the ban ve cho ghe bao tri.';
        END IF;
        SELECT COALESCE(MAX(GiaTri), 5) INTO v_PhutBan
          FROM CauHinhHeThong WHERE TenThamSo = 'PHUT_NGUNG_BAN';
        IF v_NgayGioChieu < DATE_ADD(NOW(), INTERVAL v_PhutBan MINUTE) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Khong the doi/kich hoat ve: suat chieu da ngung ban.';
        END IF;
    END IF;
    IF NEW.TrangThai = 'DaHuy' AND OLD.TrangThai <> 'DaHuy' THEN
        SELECT COALESCE(MAX(GiaTri), 60) INTO v_PhutHuy
          FROM CauHinhHeThong WHERE TenThamSo = 'PHUT_NGUNG_HUY';
        -- Huy phai xet suat CU, tranh doi sang suat xa hon de vuot nguong.
        SELECT MAX(TIMESTAMP(NgayChieu, GioBatDau)) INTO v_NgayGioCu
          FROM SuatChieu WHERE MaSuatChieu = OLD.MaSuatChieu;
        IF v_NgayGioCu < DATE_ADD(NOW(), INTERVAL v_PhutHuy MINUTE) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Khong the huy ve: da qua thoi gian cho phep huy.';
        END IF;
    END IF;
END //
DELIMITER ;
