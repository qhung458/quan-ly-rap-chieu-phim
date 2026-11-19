-- t25
DROP FUNCTION IF EXISTS fn_SoGheTrong;

DELIMITER $$

CREATE FUNCTION fn_SoGheTrong(p_MaSuatChieu VARCHAR(20))
RETURNS INT
READS SQL DATA
BEGIN
    DECLARE v_MaPhong VARCHAR(10);
    DECLARE v_TrangThaiSuat VARCHAR(20);
    DECLARE v_SoGheTrong INT DEFAULT 0;

    SELECT sc.MaPhong, sc.TrangThai
    INTO v_MaPhong, v_TrangThaiSuat
    FROM SuatChieu sc
    WHERE sc.MaSuatChieu = p_MaSuatChieu;

    -- NULL: suất chiếu không tồn tại.
    IF v_MaPhong IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_TrangThaiSuat = 'Huy' THEN
        RETURN 0;
    END IF;

    SELECT COUNT(*)
    INTO v_SoGheTrong
    FROM Ghe g
    WHERE g.MaPhong = v_MaPhong
      AND NOT EXISTS (
          SELECT 1 FROM GheBaoTri bt
          WHERE bt.MaGhe = g.MaGhe AND bt.MaPhong = g.MaPhong
      )
      AND NOT EXISTS (
          SELECT 1
          FROM Ve v
          WHERE v.MaSuatChieu = p_MaSuatChieu
            AND v.MaGhe = g.MaGhe
            AND v.TrangThai IN ('DaDat', 'DaSuDung')
      );

    RETURN v_SoGheTrong;
END $$

DELIMITER ;

