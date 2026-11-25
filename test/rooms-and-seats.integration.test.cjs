'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sql, withSchema, withApplication, json, signIn, signUp } = require('./fixtures/mysql-app.cjs');

const skip = process.env.MYSQL_INTEGRATION_TESTS !== '1' && 'Run with MYSQL_INTEGRATION_TESTS=1 for disposable schemas on the local MySQL server.';
const roomsPath = '/api/phong-chieu';
const seatsPath = code => roomsPath + '/' + code + '/ghe';
const staff = 'room_staff';
const manager = 'room_manager';
const roomCodes = items => items.map(item => item.MaPhong);
const seatCodes = items => items.map(item => item.MaGhe);

async function seed(db) {
  await db.query(sql('createTable.sql'));
  await db.query(sql('create_tai_khoan.sql'));
  const rooms = [
    ['PC01', 'Phòng 2D lớn', 1, '2D', 35],
    ['PC02', 'Phòng 3D nhỏ', 99, '3D', 18],
    ['PC03', 'Phòng 3D ghế mẫu', 1, '3D', 20],
    ['PC04', 'Phòng 3D thứ hai', 7, '3D', 20],
    ['PC05', 'Phòng 3D lớn', 3, '3D', 30],
    ['PC06', 'Phòng 2D trống', 7, '2D', 0]
  ];
  await db.query('INSERT INTO PhongChieu (MaPhong, TenPhong, SoGhe, LoaiPhong) VALUES ?', [
    rooms.map(([code, name, stored, type]) => [code, name, stored, type])
  ]);
  const special = [
    ['SEAT_A12', 'PC03', 'A', 12, 'VIP'],
    ['SEAT_A2', 'PC03', 'A', 2, 'Thuong'],
    ['SEAT_A13', 'PC03', 'A', 13, 'Thuong'],
    ['SEAT_A1_2', 'PC03', 'A1', 2, 'VIP'],
    ['SEAT_Z1', 'PC03', 'Z', 1, 'VIP'],
    ['SEAT_AA1', 'PC03', 'AA', 1, 'Thuong'],
    ['SEAT_OTHER_A12', 'PC04', 'A', 12, 'VIP']
  ];
  const remainder = rooms.flatMap(([code, , , , actual]) =>
    Array.from({ length: actual - special.filter(seat => seat[1] === code).length }, (_, index) => [
      code + '_S' + String(index + 1).padStart(2, '0'), code, 'B', index + 1, 'Thuong'
    ]));
  await db.query('INSERT INTO Ghe (MaGhe, MaPhong, SoHang, SoGhe, LoaiGhe) VALUES ?', [[...special, ...remainder]]);
}

test('Room and seat lists preserve actual capacity, room scope and physical seat order on MySQL', { skip }, async t => {
  await withSchema(async (db, schema) => {
    await seed(db);
    await withApplication(schema, async request => {
      await signUp(request, staff);
      await signUp(request, manager);
      await db.execute('UPDATE TaiKhoan SET VaiTro = ? WHERE TenDangNhap = ?', ['QuanTriVien', manager]);
      const cookie = await signIn(request, staff);
      const admin = await signIn(request, manager);
      const listRooms = query => json(request, roomsPath, { cookie, query });
      const listSeats = (code, query) => json(request, seatsPath(code), { cookie, query });

      await t.test('applies capacity bounds to real counts and resolves ties by room code before returning the whole list', async () => {
        const query = { loaiPhong: '3D', soGheMin: 20, sort: 'soGhe:asc' };
        const result = await listRooms(query);
        assert.deepEqual(result.map(item => [item.MaPhong, item.SoGhe]), [['PC03', 20], ['PC04', 20], ['PC05', 30]]);
        assert.deepEqual(roomCodes(await listRooms({ ...query, sort: 'soGhe:desc' })), ['PC05', 'PC03', 'PC04']);
        assert.deepEqual(roomCodes(await listRooms({ ...query, soGheMax: 20 })), ['PC03', 'PC04']);
        assert.deepEqual(roomCodes(await listRooms({ sort: 'maPhong:desc' })), ['PC06', 'PC05', 'PC04', 'PC03', 'PC02', 'PC01']);
        assert.deepEqual(roomCodes(await listRooms()), ['PC01', 'PC02', 'PC03', 'PC04', 'PC05', 'PC06']);
        assert.deepEqual(roomCodes(await listRooms({ soGheMin: 0, soGheMax: 0 })), ['PC06']);
        assert.deepEqual(await listRooms({ loaiPhong: '3D', soGheMin: 31 }), []);
        const options = await json(request, roomsPath + '/tuy-chon', { cookie });
        assert.deepEqual(roomCodes(options), ['PC01', 'PC02', 'PC03', 'PC04', 'PC05', 'PC06']);
        assert.deepEqual(Object.keys(options[0]).sort(), ['MaPhong', 'TenPhong']);
      });

      await t.test('finds the exact seat and intersects row membership, position and seat type inside one room', async () => {
        const position = await listSeats('PC03', { hang: ' a ', soGhe: 12, loaiGhe: 'VIP' });
        assert.deepEqual(seatCodes(position.items), ['SEAT_A12']);
        assert.equal(position.total, 1);
        assert.equal(position.totalRoomSeats, 20);
        assert.deepEqual(position.rows, ['A', 'B', 'Z', 'A1', 'AA']);
        const byCoordinates = await listSeats('PC03', { soHang: ' a1 ', soGhe: 2 });
        assert.deepEqual(seatCodes(byCoordinates.items), ['SEAT_A1_2']);
        assert.deepEqual(seatCodes((await listSeats('PC03', { hang: 'A', soGhe: 2 })).items), ['SEAT_A2']);
        assert.deepEqual(seatCodes((await listSeats('PC04', { hang: 'A', soGhe: 12, loaiGhe: 'VIP' })).items), ['SEAT_OTHER_A12']);
        assert.deepEqual(seatCodes((await listSeats('PC03', { maGhe: ' SEAT_A12 ' })).items), ['SEAT_A12']);
        assert.deepEqual((await listSeats('PC03', { maGhe: 'SEAT_A1' })).items, []);
        assert.deepEqual((await listSeats('PC03', { maGhe: 'SEAT_OTHER_A12' })).items, []);
        const many = await listSeats('PC03', { hang: ['AA', ' A ', 'Z', 'a'], loaiGhe: 'VIP' });
        assert.deepEqual(seatCodes(many.items), ['SEAT_A12', 'SEAT_Z1']);
        const crossed = await listSeats('PC03', { soHang: 'A1', hang: ['A', 'Z'], soGhe: 2 });
        assert.equal(crossed.total, 0);
        assert.equal(crossed.totalRoomSeats, 20);
      });

      await t.test('distinguishes no match, an empty room and a missing room; reset restores numeric and physical order', async () => {
        const noMatch = await listSeats('PC03', { hang: 'A', soGhe: 12, loaiGhe: 'Thuong' });
        assert.deepEqual(noMatch, { items: [], total: 0, totalRoomSeats: 20, rows: ['A', 'B', 'Z', 'A1', 'AA'] });
        assert.deepEqual(await listSeats('PC06'), { items: [], total: 0, totalRoomSeats: 0, rows: [] });
        await json(request, seatsPath('MISSING'), { cookie }, 404);
        const all = await listSeats('PC03');
        assert.equal(all.total, 20);
        assert.equal(all.totalRoomSeats, 20);
        assert.deepEqual(seatCodes(all.items).slice(0, 3), ['SEAT_A2', 'SEAT_A12', 'SEAT_A13']);
        assert.deepEqual(seatCodes(all.items).slice(-3), ['SEAT_Z1', 'SEAT_A1_2', 'SEAT_AA1']);
      });

      await t.test('validates queries, requires login and preserves CRUD and live counts under active filters', async () => {
        await json(request, roomsPath, {}, 401);
        await json(request, seatsPath('PC03'), {}, 401);
        for (const query of [
          { loaiPhong: '4D' }, { soGheMin: -1 }, { soGheMin: 20, soGheMax: 19 }, { sort: 'tenPhong:asc' },
          { soGheMin: [0, 10] }, { page: 1 }
        ]) await json(request, roomsPath, { cookie, query }, 400);
        for (const query of [{ soGhe: 0 }, { hang: 'ABCDEF' }, { loaiGhe: 'VVIP' }, { sort: 'maGhe:desc' }]) {
          await json(request, seatsPath('PC03'), { cookie, query }, 400);
        }

        const exactTwenty = { loaiPhong: '3D', soGheMin: 20, soGheMax: 20 };
        const seatRoute = seatsPath('PC03');
        const created = await json(request, seatRoute, {
          cookie, method: 'POST', data: { SoHang: 'C', SoGhe: 1, LoaiGhe: 'Thuong' }
        }, 201);
        assert.deepEqual(roomCodes(await listRooms(exactTwenty)), ['PC04']);
        assert.equal((await listSeats('PC03', { hang: 'A', soGhe: 12, loaiGhe: 'VIP' })).totalRoomSeats, 21);
        await json(request, seatRoute + '/' + created.MaGhe, {
          cookie, method: 'PUT', data: { SoHang: 'C', SoGhe: 1, LoaiGhe: 'VIP' }
        });
        assert.deepEqual(seatCodes((await listSeats('PC03', { hang: 'C', loaiGhe: 'VIP' })).items), [created.MaGhe]);
        await json(request, seatRoute + '/' + created.MaGhe, { cookie, method: 'DELETE' }, 403);
        assert.equal((await request(seatRoute + '/' + created.MaGhe, { cookie: admin, method: 'DELETE' })).status, 204);
        assert.deepEqual(roomCodes(await listRooms(exactTwenty)), ['PC03', 'PC04']);
        assert.equal((await listSeats('PC03', { hang: 'C' })).totalRoomSeats, 20);

        const newRoom = await json(request, roomsPath, {
          cookie, method: 'POST', data: { MaPhong: 'PC07', TenPhong: 'Phòng mới', LoaiPhong: '2D', SoGhe: 2 }
        }, 201);
        assert.equal(newRoom.SoGhe, 2);
        assert.ok(roomCodes(await json(request, roomsPath + '/tuy-chon', { cookie })).includes('PC07'));
        assert.ok(!roomCodes(await listRooms(exactTwenty)).includes('PC07'));
      });

      await t.test('allows selecting every row in a room with 130 one-seat rows', async () => {
        await json(request, roomsPath, {
          cookie, method: 'POST', data: { MaPhong: 'PC08', TenPhong: 'Phòng nhiều hàng', LoaiPhong: '2D',
            SoGhe: 130, SoGheMoiHang: 1 }
        }, 201);
        const all = await listSeats('PC08');
        assert.equal(all.rows.length, 130);
        const filtered = await listSeats('PC08', { hang: all.rows, loaiGhe: 'Thuong' });
        assert.equal(filtered.totalRoomSeats, 130);
        assert.equal(filtered.total, 130);
        assert.deepEqual(seatCodes(filtered.items), seatCodes(all.items));
        await json(request, seatsPath('PC08'), { cookie, query: { hang: [...all.rows, 'ZZ'] } }, 400);
      });
    });
  });
});
