'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ListQueryError, normalizeSearchText, parseListPagination, parseListQuery } = require('../server/list-query.cjs');

const options = {
  searchColumns: ['r.maTim', 'r.tenTim'],
  phoneColumn: 'r.dienThoai',
  filters: {
    ma: { type: 'exact', column: 'r.ma', maxLength: 15 },
    ten: { type: 'text', column: 'r.tenTim', operator: 'contains' },
    dienThoai: { type: 'phone', column: 'r.dienThoai' },
    trangThai: { type: 'enum', column: 'r.trangThai', multiple: true, values: ['DaDat', 'DaHuy'] },
    tuNgay: { type: 'date', column: 'r.ngay', operator: '>=' },
    denNgay: { type: 'date', column: 'r.ngay', operator: 'throughDate' },
    tuGio: { type: 'time' },
    denGio: { type: 'time' },
    giaMin: { type: 'decimal', column: 'r.gia', operator: '>=' },
    giaMax: { type: 'decimal', column: 'r.gia', operator: '<=' },
    soLuong: { type: 'integer', min: 1, max: 130 },
    coEmail: { type: 'boolean' }
  },
  ranges: [['tuNgay', 'denNgay'], ['tuGio', 'denGio'], ['giaMin', 'giaMax']],
  sort: { gia: 'r.gia', lich: ['r.ngay', 'r.gio'], ma: 'r.ma' },
  defaultSort: 'ma:asc',
  tieBreakers: ['r.ma', 'r.nhom']
};

test('normalizes Vietnamese text and binds one OR group per word with independent AND filters', () => {
  assert.equal(normalizeSearchText('  ĐẶNG\t THU\u0300Y  '), 'dang thuy');
  const result = parseListQuery({
    q: '  ĐẶNG\t THÙY ', ma: ' V001 ', ten: '  Đặng  Thùy  ',
    trangThai: ['DaDat', 'DaHuy', 'DaDat'], coEmail: 'false', soLuong: '5',
    denNgay: '2024-02-29', tuGio: '08:15', denGio: '17:25:17',
    giaMin: '00040.5', giaMax: '40.50', sort: 'gia:desc,lich:asc'
  }, options);

  assert.deepEqual(result.params, [
    'dang', 'dang', 'dang', 'thuy', 'thuy', 'thuy', 'V001', 'dang thuy',
    'DaDat', 'DaHuy', '2024-02-29', '40.50', '40.50'
  ]);
  assert.deepEqual(result.conditions.slice(2), [
    '(r.ma = ?)', '(LOCATE(CAST(? AS BINARY), CAST(r.tenTim AS BINARY)) > 0)',
    '(r.trangThai IN (?, ?))', '(r.ngay < DATE_ADD(?, INTERVAL 1 DAY))', '(r.gia >= ?)', '(r.gia <= ?)'
  ]);
  assert.equal(result.conditions.slice(0, 2).filter(clause => clause.split(' OR ').length === 3).length, 2);
  assert.equal(result.orderBy, 'r.gia DESC, r.ngay ASC, r.gio ASC, r.ma ASC, r.nhom ASC');
  assert.equal(result.filters.coEmail, false);
  assert.equal(result.filters.soLuong, 5);
  assert.equal(result.filters.tuGio, '08:15:00');
});

test('preserves leading zero on a domestic phone and keeps repeated numeric keywords on other lists', () => {
  const phone = parseListQuery({ q: '(0901) 234-567', dienThoai: '0901 234 567' }, options);
  assert.deepEqual(phone.params.slice(-2), ['0901234567', '0901234567']);
  assert.match(phone.conditions[0], /OR LOCATE\(CAST\(\? AS BINARY\), CAST\(r.dienThoai AS BINARY\)\) > 0\)$/);
  const year = parseListQuery({ q: '2024 2025' }, { ...options, phoneColumn: undefined });
  assert.deepEqual(year.params, ['2024', '2024', '2025', '2025']);
  assert.throws(() => parseListQuery({ dienThoai: '+84901234567' }, options), ListQueryError);
});

test('rejects invalid filters, repeated scalars, inverted ranges and unavailable sort fields', () => {
  for (const query of [
    { q: ['a', 'b'] }, { ma: ['V001', 'V002'] }, { noSuchFilter: '1' },
    { trangThai: 'Other' }, { soLuong: '131' }, { giaMin: '-1' }, { coEmail: '0' },
    { denNgay: '2026-02-29' }, { tuNgay: '2026-12-05', denNgay: '2026-12-01' },
    { tuGio: '18:00', denGio: '09:00' }, { denGio: '24:00' },
    { giaMin: '9007199254740992.02', giaMax: '9007199254740992.01' },
    { sort: 'unknown:asc' }, { sort: 'gia:down' }, { sort: 'gia:asc,gia:desc' },
    { sort: 'gia:asc,ma:asc,lich:asc' }
  ]) {
    assert.throws(() => parseListQuery(query, options), ListQueryError, JSON.stringify(query));
  }
  assert.equal(parseListQuery({ sort: 'ma:desc' }, options).orderBy, 'r.ma DESC, r.nhom ASC');
  assert.deepEqual(parseListQuery({ denNgay: '9999-12-31' }, options).conditions, ['(r.ngay IS NOT NULL)']);
});

test('accepts only positive bounded paging inputs', () => {
  assert.deepEqual(parseListPagination(), { page: 1, pageSize: 25 });
  assert.deepEqual(parseListPagination('2', '100'), { page: 2, pageSize: 100 });
  for (const [page, size] of [['0'], ['-1'], ['1', '101'], ['1', ''], [['1', '2']], ['9007199254740993']]) {
    assert.throws(() => parseListPagination(page, size), ListQueryError);
  }
});
