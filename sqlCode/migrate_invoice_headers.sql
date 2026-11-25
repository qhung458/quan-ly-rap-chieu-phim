-- MySQL 8.0.16+. Dừng ứng dụng và chạy trên schema đang dùng.
-- Dừng ngay nếu có câu lệnh lỗi. Có thể chạy lại toàn bộ sau khi xử lý lỗi.

-- Khóa ngoại chuỗi phải khớp charset/collation của bảng cũ, kể cả khi mặc định
-- schema đã đổi sau lúc tạo HoaDon.
SELECT CONCAT('CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
INTO @invoice_code_charset
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'hoadon' AND COLUMN_NAME = 'MaHoaDon';

SELECT CONCAT('CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
INTO @invoice_customer_charset
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'hoadon' AND COLUMN_NAME = 'MaKhachHang';

SET @create_invoice_header_sql = CONCAT(
    'CREATE TABLE IF NOT EXISTS DauHoaDon (',
    'MaHoaDon VARCHAR(15) ', @invoice_code_charset, ' NOT NULL PRIMARY KEY, ',
    'MaKhachHang VARCHAR(10) ', @invoice_customer_charset, ' NOT NULL, ',
    'NgayMua DATETIME NOT NULL, ',
    'CONSTRAINT UQ_DauHoaDon_KhachHang UNIQUE (MaHoaDon, MaKhachHang), ',
    'CONSTRAINT FK_DauHoaDon_KhachHang FOREIGN KEY (MaKhachHang) REFERENCES KhachHang(MaKhachHang), ',
    'INDEX IX_DauHoaDon_NgayMua (NgayMua, MaHoaDon)) ENGINE=InnoDB'
);
PREPARE create_invoice_header FROM @create_invoice_header_sql;
EXECUTE create_invoice_header;
DEALLOCATE PREPARE create_invoice_header;

-- Ghép theo cả mã và khách để khóa chính báo lỗi nếu một mã thuộc hai khách.
INSERT INTO DauHoaDon (MaHoaDon, MaKhachHang, NgayMua)
SELECT h.MaHoaDon, h.MaKhachHang, MIN(h.NgayMua)
FROM HoaDon AS h
LEFT JOIN DauHoaDon AS d ON d.MaHoaDon = h.MaHoaDon AND d.MaKhachHang = h.MaKhachHang
WHERE d.MaHoaDon IS NULL
GROUP BY h.MaHoaDon, h.MaKhachHang;

-- Đồng bộ lại nếu dòng cũ được sửa giữa hai lần chạy migration.
UPDATE DauHoaDon AS d
JOIN (
    SELECT MaHoaDon, MaKhachHang, MIN(NgayMua) AS NgayMua
    FROM HoaDon
    GROUP BY MaHoaDon, MaKhachHang
) AS h ON h.MaHoaDon = d.MaHoaDon AND h.MaKhachHang = d.MaKhachHang
SET d.NgayMua = h.NgayMua
WHERE d.NgayMua <> h.NgayMua;

SET @add_invoice_header_fk_sql = IF(EXISTS (
    SELECT 1
    FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'hoadon'
      AND CONSTRAINT_NAME = 'FK_HoaDon_DauHoaDon'
), 'DO 0', 'ALTER TABLE HoaDon ADD CONSTRAINT FK_HoaDon_DauHoaDon FOREIGN KEY (MaHoaDon, MaKhachHang) REFERENCES DauHoaDon(MaHoaDon, MaKhachHang) ON DELETE CASCADE');
PREPARE add_invoice_header_fk FROM @add_invoice_header_fk_sql;
EXECUTE add_invoice_header_fk;
DEALLOCATE PREPARE add_invoice_header_fk;

CREATE TABLE IF NOT EXISTS DayMaHoaDon (
    Id     TINYINT         NOT NULL PRIMARY KEY CHECK (Id = 1),
    SoCuoi BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;
INSERT INTO DayMaHoaDon (Id, SoCuoi) VALUES (1, 0)
ON DUPLICATE KEY UPDATE Id = 1;

UPDATE DayMaHoaDon
SET SoCuoi = GREATEST(SoCuoi, (
    SELECT COALESCE(MAX(CAST(SUBSTRING(MaHoaDon, 3) AS UNSIGNED)), 0)
    FROM DauHoaDon WHERE MaHoaDon REGEXP '^HD[0-9]+$'
))
WHERE Id = 1;

DROP TRIGGER IF EXISTS BI_DauHoaDon_DayMa;
CREATE TRIGGER BI_DauHoaDon_DayMa BEFORE INSERT ON DauHoaDon
FOR EACH ROW
    UPDATE DayMaHoaDon
    SET SoCuoi = GREATEST(SoCuoi, CAST(SUBSTRING(NEW.MaHoaDon, 3) AS UNSIGNED))
    WHERE Id = 1 AND NEW.MaHoaDon REGEXP '^HD[0-9]+$';
