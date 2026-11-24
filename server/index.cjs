const express = require('express');
const session = require('express-session');
const path = require('node:path');
const db = require('./db.cjs');
const { router: auth } = require('./auth.cjs');
const customers = require('./customers.cjs');
const rooms = require('./rooms.cjs');
const tickets = require('./tickets.cjs');
const movies = require('./movies.cjs');
const showtimes = require('./showtimes.cjs');
const combos = require('./combos.cjs');
const invoices = require('./invoices.cjs');
const stats = require('./stats.cjs');

const app = express();
const port = Number(process.env.PORT || 3000);
const secret = process.env.SESSION_SECRET;
const staticDirectory = path.join(__dirname, '../static');

if (!process.env.DB_NAME || !process.env.DB_USER || !secret || secret.length < 32) {
  throw new Error('Điền DB_NAME, DB_USER và SESSION_SECRET (ít nhất 32 ký tự) trong .env.');
}

app.disable('x-powered-by');
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    const localOrigins = ['http://127.0.0.1:' + port, 'http://localhost:' + port];
    if (!localOrigins.includes(origin)) {
      return res.status(403).json({ message: 'Yêu cầu phải đến từ trang web của dự án.' });
    }
  }
  next();
});

app.use('/api', express.json({ limit: '16kb' }));
app.use(session({
  name: 'rap.sid',
  secret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 2 * 60 * 60 * 1000 }
}));

app.get('/api/health', async (_req, res) => {
  await db.execute('SELECT 1');
  res.json({ ok: true });
});
app.use('/api/auth', auth);
app.use('/api/khach-hang', customers);
app.use('/api/phong-chieu', rooms);
app.use('/api/ban-ve', tickets);
app.use('/api/phim', movies);
app.use('/api/suat-chieu', showtimes);
app.use('/api/bap-nuoc', combos);
app.use('/api/hoa-don', invoices);
app.use('/api/thong-ke', stats);
app.use('/api', (_req, res) => res.status(404).json({ message: 'Không tìm thấy API.' }));

app.get('/', (_req, res) => res.redirect('/html/dang-nhap.html'));
app.get([
  '/html/khach-hang.html', '/html/phong-chieu-va-ghe.html', '/html/ban-ve.html',
    '/html/bap-nuoc-va-hoa-don.html', '/html/thong-ke.html', '/html/phim-va-suatchieu.html'
], (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!req.session.user) return res.redirect('/html/dang-nhap.html');
  next();
});
app.use(express.static(staticDirectory));

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'Mã khách hàng, số điện thoại hoặc email đã tồn tại.' });
  }
  if (error.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ message: 'Khách hàng đã có vé hoặc hóa đơn nên không thể xóa.' });
  }
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return res.status(error.status).json({ message: 'Dữ liệu gửi lên không hợp lệ.' });
  }
  console.error(error.code || error.name);
  res.status(500).json({ message: 'Máy chủ không xử lý được yêu cầu. Kiểm tra MySQL và cấu hình.' });
});

app.listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port));
