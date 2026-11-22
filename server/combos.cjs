const express = require('express');
const db = require('./db.cjs');
const { requireLogin, requireAdmin } = require('./auth.cjs');

const router = express.Router();
const codePattern = /^[A-Za-z0-9_-]{1,10}$/;
const maxPrice = 100000000;
const notFound = { message: 'Không tìm thấy combo.' };

router.use(requireLogin);

function readCombo(body) {
  const { TenCombo, GiaCombo, MoTa } = body ?? {};
  if (typeof TenCombo !== 'string' || (MoTa != null && typeof MoTa !== 'string')) return null;

  const name = TenCombo.trim();
  const description = MoTa?.trim() || null;
  const price = typeof GiaCombo === 'string' && GiaCombo.trim() !== '' ? Number(GiaCombo) : GiaCombo;
  if (!name || name.length > 100 || (description && description.length > 255) ||
      typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > maxPrice) {
    return null;
  }
  return { TenCombo: name, GiaCombo: price, MoTa: description };
}

function mapCombo(row) {
  return { ...row, GiaCombo: Number(row.GiaCombo), DaBan: Number(row.DaBan ?? 0) };
}

function handleDatabaseError(error, res) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'Mã combo hoặc tên combo đã tồn tại.' });
  }
  if (error.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ message: 'Combo đã có trong hóa đơn nên không thể xóa.' });
  }
  throw error;
}

router.get('/', async (req, res) => {
  const keyword = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const [rows] = await db.execute(
    `SELECT b.MaCombo, b.TenCombo, b.GiaCombo, b.MoTa,
            COALESCE(SUM(h.SoLuongCombo), 0) AS DaBan
     FROM BapNuoc b
     LEFT JOIN HoaDon h ON h.MaCombo = b.MaCombo
     WHERE LOCATE(?, b.MaCombo) > 0 OR LOCATE(?, b.TenCombo) > 0 OR LOCATE(?, b.MoTa) > 0
     GROUP BY b.MaCombo, b.TenCombo, b.GiaCombo, b.MoTa
     ORDER BY b.MaCombo`,
    [keyword, keyword, keyword]
  );
  res.json(rows.map(mapCombo));
});

router.post('/', async (req, res) => {
  const rawCode = req.body?.MaCombo;
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  const combo = readCombo(req.body);
  if (!codePattern.test(code) || !combo) {
    return res.status(400).json({
      message: 'Kiểm tra mã combo, tên, giá (số nguyên từ 0 đến 100.000.000 đồng) và mô tả.'
    });
  }

  try {
    await db.execute(
      'INSERT INTO BapNuoc (MaCombo, TenCombo, GiaCombo, MoTa) VALUES (?, ?, ?, ?)',
      [code, combo.TenCombo, combo.GiaCombo, combo.MoTa]
    );
  } catch (error) {
    return handleDatabaseError(error, res);
  }
  res.status(201).json({ MaCombo: code, ...combo, DaBan: 0 });
});

router.put('/:code', async (req, res) => {
  const combo = readCombo(req.body);
  if (!combo) {
    return res.status(400).json({
      message: 'Kiểm tra tên, giá (số nguyên từ 0 đến 100.000.000 đồng) và mô tả.'
    });
  }

  try {
    const [result] = await db.execute(
      'UPDATE BapNuoc SET TenCombo = ?, GiaCombo = ?, MoTa = ? WHERE MaCombo = ?',
      [combo.TenCombo, combo.GiaCombo, combo.MoTa, req.params.code]
    );
    if (!result.affectedRows) {
      const [[exists]] = await db.execute('SELECT 1 AS ok FROM BapNuoc WHERE MaCombo = ?', [req.params.code]);
      if (!exists) return res.status(404).json(notFound);
    }
  } catch (error) {
    return handleDatabaseError(error, res);
  }
  const [[row]] = await db.execute(
    `SELECT b.MaCombo, b.TenCombo, b.GiaCombo, b.MoTa,
            (SELECT COALESCE(SUM(SoLuongCombo), 0) FROM HoaDon WHERE MaCombo = b.MaCombo) AS DaBan
     FROM BapNuoc b WHERE b.MaCombo = ?`, [req.params.code]
  );
  res.json(mapCombo(row));
});

router.delete('/:code', requireAdmin, async (req, res) => {
  try {
    const [result] = await db.execute('DELETE FROM BapNuoc WHERE MaCombo = ?', [req.params.code]);
    if (!result.affectedRows) return res.status(404).json(notFound);
  } catch (error) {
    return handleDatabaseError(error, res);
  }
  res.sendStatus(204);
});

module.exports = router;
