SELECT
    k.MaSuatChieu,
    k.MongDoi,
    k.ThucTe,
    CASE
        WHEN k.ThucTe <=> k.MongDoi THEN 'DAT'
        ELSE 'KHONG DAT'
    END AS KetQua
FROM (
    SELECT
        'SC047' AS MaSuatChieu,
        18 AS MongDoi,
        fn_SoGheTrong('SC047') AS ThucTe

    UNION ALL

    SELECT
        'T26_TRONG', 20,
        fn_SoGheTrong('T26_TRONG')

    UNION ALL

    SELECT
        'T26_DAY', 0,
        fn_SoGheTrong('T26_DAY')

    UNION ALL

    SELECT
        'T26_HUY_BANLAI', 19,
        fn_SoGheTrong('T26_HUY_BANLAI')

    UNION ALL

    SELECT
        'KHONG_TON_TAI', NULL,
        fn_SoGheTrong('KHONG_TON_TAI')
) AS k;
