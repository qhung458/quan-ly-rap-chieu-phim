const express = require('express');
const db = require('./db.cjs');
const { hashPassword, verifyPassword } = require('./password.cjs');

const router = express.Router();
const usernamePattern = /^[a-zA-Z0-9_]{3,50}$/;

function validPassword(value) {
  return typeof value === 'string' &&
    value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 256;
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Vui lòng đăng nhập.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.user?.VaiTro !== 'QuanTriVien') {
    return res.status(403).json({ message: 'Cần quyền quản trị để thực hiện thao tác này.' });
  }
  next();
}

router.post('/register', async (req, res) => {
  const { TenDangNhap, HoTen, MatKhau, XacNhanMatKhau } = req.body ?? {};
  const username = typeof TenDangNhap === 'string' ? TenDangNhap.trim() : '';
  const fullName = typeof HoTen === 'string' ? HoTen.trim() : '';

  if (!usernamePattern.test(username) || !fullName || fullName.length > 100 ||
      !validPassword(MatKhau) || MatKhau !== XacNhanMatKhau) {
    return res.status(400).json({
      message: 'Tên đăng nhập cần 3–50 ký tự chữ, số hoặc gạch dưới. Mật khẩu cần ít nhất 12 ký tự, tối đa 256 byte và phải khớp.'
    });
  }

  try {
    const hash = await hashPassword(MatKhau);
    await db.execute(
      "INSERT INTO TaiKhoan (TenDangNhap, HoTen, MatKhauHash, VaiTro) VALUES (?, ?, ?, 'NhanVien')",
      [username, fullName, hash]
    );
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    return res.status(409).json({ message: 'Tên đăng nhập đã được sử dụng.' });
  }

  res.status(201).json({ message: 'Đăng ký thành công. Anh/chị có thể đăng nhập.' });
});

router.post('/login', async (req, res) => {
  const { TenDangNhap, MatKhau } = req.body ?? {};
  const username = typeof TenDangNhap === 'string' ? TenDangNhap.trim() : '';
  const invalid = { message: 'Tên đăng nhập hoặc mật khẩu không đúng.' };

  if (!usernamePattern.test(username) || !validPassword(MatKhau)) {
    return res.status(401).json(invalid);
  }

  const [[account]] = await db.execute(
    'SELECT MaTaiKhoan, TenDangNhap, HoTen, VaiTro, MatKhauHash FROM TaiKhoan WHERE TenDangNhap = ?',
    [username]
  );
  if (!account || !(await verifyPassword(MatKhau, account.MatKhauHash))) {
    return res.status(401).json(invalid);
  }

  await new Promise((resolve, reject) => {
    req.session.regenerate(error => error ? reject(error) : resolve());
  });

  const { MatKhauHash, ...user } = account;
  req.session.user = user;
  await new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });
  res.json(user);
});

router.get('/me', requireLogin, (req, res) => res.json(req.session.user));

router.post('/logout', (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('rap.sid', { path: '/' });
    res.sendStatus(204);
  });
});

module.exports = { router, requireLogin, requireAdmin };
