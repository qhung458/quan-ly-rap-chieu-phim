-- Chay trong schema kiem thu sau seed_T26.sql. Cac thay doi du lieu se rollback.
DROP PROCEDURE IF EXISTS test_LenhBiTuChoi;
DROP PROCEDURE IF EXISTS test_QuyTacRap;
DELIMITER //

CREATE PROCEDURE test_LenhBiTuChoi(IN p_Lenh TEXT, IN p_ThongBao VARCHAR(128))
BEGIN
    DECLARE v_ThongBao TEXT;
    SET @LenhKiemThu = p_Lenh;
    PREPARE lenh FROM @LenhKiemThu;
    BEGIN
        DECLARE CONTINUE HANDLER FOR SQLEXCEPTION
            GET DIAGNOSTICS CONDITION 1 v_ThongBao = MESSAGE_TEXT;
        EXECUTE lenh;
    END;
    DEALLOCATE PREPARE lenh;

    IF v_ThongBao IS NULL OR LOCATE(p_ThongBao, v_ThongBao) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = p_ThongBao;
    END IF;
END //

CREATE PROCEDURE test_QuyTacRap()usp_KiemTraDatVe
BEGIN
    DECLARE v_SuatGan DATETIME DEFAULT DATE_ADD(NOW(), INTERVAL 20 MINUTE);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    UPDATE CauHinhHeThong SET GiaTri = 5 WHERE TenThamSo = 'PHUT_NGUNG_BAN';
    UPDATE CauHinhHeThong SET GiaTri = 60 WHERE TenThamSo = 'PHUT_NGUNG_HUY';

    IF NOT (fn_SoGheTrong('SC047') <=> 18
        AND fn_SoGheTrong('T26_TRONG') <=> 20
        AND fn_SoGheTrong('T26_DAY') <=> 0
        AND fn_SoGheTrong('T26_HUY_BANLAI') <=> 19
        AND fn_SoGheTrong('KHONG_TON_TAI') IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ket qua dem ghe khac mong doi.';
    END IF;

    CALL test_LenhBiTuChoi(
        "UPDATE Ve SET TrangThai='DaDat' WHERE MaVe='T26F_001'", 'Ve da su dung');
    CALL test_LenhBiTuChoi(
        "UPDATE Ve SET MaSuatChieu='T26_TRONG' WHERE MaVe='T26F_001'", 'Ve da su dung');
    CALL test_LenhBiTuChoi(
        "UPDATE Ve SET MaSuatChieu='T26_TRONG' WHERE MaVe='V0001'", 'Suat hien tai da qua han');
    CALL test_LenhBiTuChoi(
        "UPDATE SuatChieu SET MaPhong='PC06' WHERE MaSuatChieu='T26_DAY'", 'Khong the doi phong');
    CALL test_LenhBiTuChoi(
        "UPDATE Ghe SET MaPhong='PC06' WHERE MaGhe='T26_G001'", 'Khong the chuyen phong');
    CALL test_LenhBiTuChoi(
        "UPDATE Ve SET MaGhe='G001' WHERE MaVe='T26_BANLAI'", 'Ghe khong thuoc phong');
    CALL test_LenhBiTuChoi(
        "INSERT INTO Ve (MaVe,MaSuatChieu,MaKhachHang,MaGhe,NgayDat)
         VALUES ('T26_DUP','T26_DAY','KH002','T26_G001',NOW())", 'Duplicate entry');

    CALL test_LenhBiTuChoi(
        "INSERT INTO SuatChieu (MaSuatChieu,MaPhim,MaPhong,NgayChieu,GioBatDau,GioKetThuc)
         VALUES ('T26_TRUNG','P001','PC_T26','2099-06-01','09:00:00','10:00:00')", 'Suat chieu chong gio');
    CALL test_LenhBiTuChoi(
        "UPDATE SuatChieu SET GioBatDau='10:00:00' WHERE MaSuatChieu='T26_DAY'", 'Suat chieu chong gio');

    INSERT INTO SuatChieu (MaSuatChieu,MaPhim,MaPhong,NgayChieu,GioBatDau,GioKetThuc)
    VALUES ('T26_DEM','P001','PC_T26','2099-06-01','23:00:00','01:00:00'),
           ('T26_SANG','P001','PC_T26','2099-06-02','01:00:00','02:00:00');
    CALL test_LenhBiTuChoi(
        "UPDATE SuatChieu SET GioBatDau='00:30:00' WHERE MaSuatChieu='T26_SANG'", 'Suat chieu chong gio');

    INSERT INTO SuatChieu (MaSuatChieu,MaPhim,MaPhong,NgayChieu,GioBatDau,GioKetThuc)
    VALUES ('T26_GAN','P001','PC_T26',DATE(v_SuatGan),TIME(v_SuatGan),TIME(v_SuatGan + INTERVAL 30 MINUTE));
    UPDATE Ve SET MaSuatChieu = 'T26_GAN' WHERE MaVe = 'T26_BANLAI';
    CALL test_LenhBiTuChoi(
        "UPDATE Ve SET MaSuatChieu='T26_TRONG' WHERE MaVe='T26_BANLAI'", 'Suat hien tai da qua han');
    CALL test_LenhBiTuChoi(
        "UPDATE Ve SET TrangThai='DaHuy' WHERE MaVe='T26_BANLAI'", 'Suat hien tai da qua han');

    UPDATE SuatChieu SET TrangThai = 'Huy' WHERE MaSuatChieu = 'T26_TRONG';
    CALL test_LenhBiTuChoi(
        "INSERT INTO Ve (MaVe,MaSuatChieu,MaKhachHang,MaGhe,NgayDat)
         VALUES ('T26_HUYMOI','T26_TRONG','KH002','T26_G001',NOW())", 'Suat chieu khong mo ban');
    CALL test_LenhBiTuChoi(
        "UPDATE Ve SET MaSuatChieu='T26_TRONG' WHERE MaVe='T26F_002'", 'Suat chieu khong mo ban');

    IF NOT (fn_SoGheTrong('T26_TRONG') <=> 0) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Suat huy phai co 0 ghe co the dat.';
    END IF;

    ROLLBACK;
    SELECT 'DAT' AS KetQua;
END //
DELIMITER ;

CALL test_QuyTacRap();
DROP PROCEDURE test_QuyTacRap;
DROP PROCEDURE test_LenhBiTuChoi;
