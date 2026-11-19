-- Chi SELECT; chay sau khi nap du lieu va tao trigger.
-- Moi truy van bat thuong duoi day can tra 0 dong.
SELECT p.MaPhong,p.SoGhe,COUNT(g.MaGhe) AS SoGheThucTe
FROM PhongChieu p LEFT JOIN Ghe g ON g.MaPhong=p.MaPhong
GROUP BY p.MaPhong,p.SoGhe HAVING p.SoGhe <> COUNT(g.MaGhe);
SELECT v.MaVe FROM Ve v JOIN Ghe g ON g.MaGhe=v.MaGhe
JOIN SuatChieu s ON s.MaSuatChieu=v.MaSuatChieu WHERE g.MaPhong<>s.MaPhong;
SELECT MaSuatChieu,MaGhe,COUNT(*) AS SoVeHoatDong FROM Ve
WHERE TrangThai IN ('DaDat','DaSuDung') GROUP BY MaSuatChieu,MaGhe HAVING COUNT(*)>1;
SELECT v.MaVe
FROM Ve v JOIN GheBaoTri bt ON bt.MaGhe=v.MaGhe
JOIN SuatChieu s ON s.MaSuatChieu=v.MaSuatChieu
WHERE v.TrangThai IN ('DaDat','DaSuDung')
  AND s.TrangThai NOT IN ('Huy','KetThuc')
  AND TIMESTAMP(DATE_ADD(s.NgayChieu, INTERVAL (s.GioKetThuc < s.GioBatDau) DAY), s.GioKetThuc) > NOW();

SELECT a.MaSuatChieu AS SuatThuNhat, b.MaSuatChieu AS SuatThuHai
FROM SuatChieu a JOIN SuatChieu b
  ON a.MaPhong=b.MaPhong AND a.MaSuatChieu<b.MaSuatChieu
  AND b.NgayChieu BETWEEN DATE_SUB(a.NgayChieu, INTERVAL 1 DAY) AND DATE_ADD(a.NgayChieu, INTERVAL 1 DAY)
WHERE a.TrangThai<>'Huy' AND b.TrangThai<>'Huy'
  AND TIMESTAMP(a.NgayChieu, a.GioBatDau)
      < TIMESTAMP(DATE_ADD(b.NgayChieu, INTERVAL (b.GioKetThuc < b.GioBatDau) DAY), b.GioKetThuc)
  AND TIMESTAMP(b.NgayChieu, b.GioBatDau)
      < TIMESTAMP(DATE_ADD(a.NgayChieu, INTERVAL (a.GioKetThuc < a.GioBatDau) DAY), a.GioKetThuc);
-- Doi chieu T25 doc lap, chua can Function. SC047=17; T26: 19/0/18.
SELECT s.MaSuatChieu,COUNT(g.MaGhe) AS GheCoTheDung,
       SUM(CASE WHEN g.MaGhe IS NOT NULL AND EXISTS (
           SELECT 1 FROM Ve v WHERE v.MaSuatChieu=s.MaSuatChieu
             AND v.MaGhe=g.MaGhe AND v.TrangThai IN ('DaDat','DaSuDung')
       ) THEN 1 ELSE 0 END) AS GheDaChiem,
       SUM(CASE WHEN g.MaGhe IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM Ve v WHERE v.MaSuatChieu=s.MaSuatChieu
             AND v.MaGhe=g.MaGhe AND v.TrangThai IN ('DaDat','DaSuDung')
       ) THEN 1 ELSE 0 END) AS GheTrong
FROM SuatChieu s LEFT JOIN Ghe g ON g.MaPhong=s.MaPhong AND NOT EXISTS (
    SELECT 1 FROM GheBaoTri bt WHERE bt.MaGhe=g.MaGhe AND bt.MaPhong=g.MaPhong
)
WHERE s.MaSuatChieu IN ('SC047','T26_TRONG','T26_DAY','T26_HUY_BANLAI')
GROUP BY s.MaSuatChieu ORDER BY s.MaSuatChieu;
