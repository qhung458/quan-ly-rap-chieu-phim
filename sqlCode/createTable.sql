-- MySQL 8.0.16+; chay tren schema moi, khong phai migration.

-- create table

-- BANG 1: PHIM
CREATE TABLE Phim (
    MaPhim VARCHAR(15) PRIMARY KEY,
    TenPhim NVARCHAR(150) NOT NULL,
    TheLoai NVARCHAR(100) NOT NULL,
    DaoDien NVARCHAR(100) NULL,
    ThoiLuong INT NOT NULL,
    NgayKhoiChieu DATE NOT NULL,
    DoTuoiChoPhep INT NOT NULL DEFAULT 0,

    CHECK (ThoiLuong > 0),
    CHECK (DoTuoiChoPhep >= 0)
);


-- BANG 2: PHONG CHIEU
CREATE TABLE PhongChieu (
    MaPhong VARCHAR(10) PRIMARY KEY,
    TenPhong NVARCHAR(50) NOT NULL UNIQUE,
    SoGhe INT NOT NULL,
    LoaiPhong VARCHAR(20) NOT NULL DEFAULT '2D',

    CHECK (SoGhe > 0),
    CHECK (LoaiPhong IN ('2D', '3D'))
);


-- BANG 3: KHACH HANG
CREATE TABLE KhachHang (
    MaKhachHang VARCHAR(10) PRIMARY KEY,
    TenKhachHang NVARCHAR(100) NOT NULL,
    SoDienThoai VARCHAR(15) NOT NULL UNIQUE,
    Email VARCHAR(100) NULL UNIQUE
);


-- BANG 4: BAP NUOC
CREATE TABLE BapNuoc (
    MaCombo VARCHAR(10) PRIMARY KEY,
    TenCombo NVARCHAR(100) NOT NULL UNIQUE,
    GiaCombo DECIMAL(18,2) NOT NULL DEFAULT 0,
    MoTa NVARCHAR(255) NULL,

    CHECK (GiaCombo >= 0)
);

-- BẢNG GHE (Ghế)
CREATE TABLE Ghe (
    MaGhe       VARCHAR(15) NOT NULL,
    MaPhong     VARCHAR(10) NOT NULL,            
    SoHang        VARCHAR(5)  NOT NULL,            
    SoGhe       INT         NOT NULL,           
    LoaiGhe     VARCHAR(20) NOT NULL DEFAULT 'Thuong',
    PRIMARY KEY (MaGhe, MaPhong),
    UNIQUE (MaGhe),
    CHECK (SoGhe > 0),
    CONSTRAINT FK_Ghe_PhongChieu 
        FOREIGN KEY (MaPhong) REFERENCES PhongChieu(MaPhong),
    CONSTRAINT UQ_Ghe_ViTri 
        UNIQUE (MaPhong, SoHang, SoGhe)
);

-- BẢNG SUATCHIEU (Suất chiếu)
CREATE TABLE SuatChieu (
    MaSuatChieu VARCHAR(20) NOT NULL,
    MaPhim      VARCHAR(15) NOT NULL,             
    MaPhong     VARCHAR(10) NOT NULL,            
    NgayChieu   DATE        NOT NULL,            
    GioBatDau   TIME        NOT NULL,             
    GioKetThuc  TIME        NOT NULL,
    GiaVe       DECIMAL(18,2) NOT NULL DEFAULT 0, 
    TrangThai   VARCHAR(20) NOT NULL DEFAULT 'SapChieu', 
    PRIMARY KEY (MaSuatChieu, MaPhim, MaPhong),
    UNIQUE (MaSuatChieu),
    CHECK (GioBatDau >= '00:00:00' AND GioBatDau < '24:00:00'),
    CHECK (GioKetThuc >= '00:00:00' AND GioKetThuc < '24:00:00'),
    CHECK (GioBatDau <> GioKetThuc),
    CHECK (GiaVe >= 0),
    CHECK (TrangThai IN ('SapChieu', 'DangChieu', 'KetThuc', 'Huy')),
    CONSTRAINT FK_SuatChieu_Phim 
        FOREIGN KEY (MaPhim) REFERENCES Phim(MaPhim),
    CONSTRAINT FK_SuatChieu_PhongChieu 
        FOREIGN KEY (MaPhong) REFERENCES PhongChieu(MaPhong),
    INDEX IX_SuatChieu_LichPhong (MaPhong, NgayChieu, GioBatDau)
);
-- TAO BANG HOADON VA VE (chay sau Phim, PhongChieu, KhachHang, BapNuoc, Ghe, SuatChieu)
-- BANG HOADON
CREATE TABLE HoaDon (
    MaHoaDon     VARCHAR(15)   NOT NULL,
    MaKhachHang  VARCHAR(10)   NOT NULL,
    MaCombo      VARCHAR(10)   NOT NULL,
    SoLuongCombo INT           NOT NULL DEFAULT 1,
    NgayMua      DATETIME      NOT NULL,
    TongTien     DECIMAL(18,2) NOT NULL DEFAULT 0,
    PRIMARY KEY (MaHoaDon, MaKhachHang, MaCombo),
    CHECK (SoLuongCombo > 0),
    CHECK (TongTien >= 0),
    CONSTRAINT FK_HoaDon_KhachHang
        FOREIGN KEY (MaKhachHang) REFERENCES KhachHang(MaKhachHang),
    CONSTRAINT FK_HoaDon_BapNuoc
        FOREIGN KEY (MaCombo) REFERENCES BapNuoc(MaCombo)
);

-- BANG VE
CREATE TABLE Ve (
    MaVe        VARCHAR(15)   NOT NULL,
    MaSuatChieu VARCHAR(20)   NOT NULL,
    MaKhachHang VARCHAR(10)   NOT NULL,
    MaGhe       VARCHAR(15)   NOT NULL,
    NgayDat     DATETIME      NOT NULL,
    GiaVe       DECIMAL(18,2) NOT NULL DEFAULT 0,
    TrangThai   VARCHAR(20)   NOT NULL DEFAULT 'DaDat',
    -- NULL cho ve huy: giu lich su, cho phep ban lai ghe cung suat.
    MaGheChiemCho VARCHAR(15) GENERATED ALWAYS AS (
        CASE WHEN TrangThai IN ('DaDat', 'DaSuDung') THEN MaGhe ELSE NULL END
    ) STORED,
    PRIMARY KEY (MaVe, MaSuatChieu, MaKhachHang, MaGhe),
    CHECK (GiaVe >= 0),
    CHECK (TrangThai IN ('DaDat', 'DaSuDung', 'DaHuy')),
    CONSTRAINT FK_Ve_SuatChieu
        FOREIGN KEY (MaSuatChieu) REFERENCES SuatChieu(MaSuatChieu),
    CONSTRAINT FK_Ve_KhachHang
        FOREIGN KEY (MaKhachHang) REFERENCES KhachHang(MaKhachHang),
    CONSTRAINT FK_Ve_Ghe
        FOREIGN KEY (MaGhe) REFERENCES Ghe(MaGhe),
    CONSTRAINT UQ_Ve_SuatChieu_Ghe
        UNIQUE (MaSuatChieu, MaGheChiemCho)
);
