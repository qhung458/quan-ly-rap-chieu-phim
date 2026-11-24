'use strict';

const byId = id => document.getElementById(id);
const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 2 });
const statusLabels = { SapChieu: 'Sắp chiếu', DangChieu: 'Đang chiếu', KetThuc: 'Kết thúc', Huy: 'Hủy' };
const formatDate = date => date.split('-').reverse().join('/');
const normalize = text => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd');
let movies = [];
let rooms = [];

async function request(url, method = 'GET', data) {
  const response = await fetch(url, {
    method,
    ...(data && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  });
  if (response.status === 401) {
    location.replace('dang-nhap.html');
    throw new Error('Vui lòng đăng nhập.');
  }
  if (response.status === 204) return;
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Không thể xử lý yêu cầu.');
  return result;
}

function setOptions(select, entries) {
  const previous = select.value;
  select.replaceChildren(select.options[0], ...entries.map(([value, label]) => new Option(label, value)));
  select.value = entries.some(([value]) => value === previous) ? previous : '';
}

function syncMovies(rows) {
  movies = rows;
  const entries = rows.map(movie => [movie.MaPhim, movie.TenPhim + ' (' + movie.MaPhim + ')']);
  setOptions(byId('ShowMovie'), entries);
  setOptions(byId('movie-filter'), entries);
  const genres = [...new Set(rows.map(movie => movie.TheLoai))].sort((a, b) => a.localeCompare(b, 'vi'));
  setOptions(byId('genre-filter'), genres.map(genre => [genre, genre]));
}

function makeCatalog({ id, key, label, filters, matches, cells, onLoad }) {
  const section = byId(id);
  const form = section.querySelector('form');
  const fieldset = form.querySelector('fieldset');
  const table = section.querySelector('table');
  const body = table.tBodies[0];
  const count = section.querySelector('[data-count]');
  const save = form.querySelector('[data-save]');
  const remove = form.querySelector('[data-delete]');
  const code = form.elements.namedItem(key);
  const message = form.querySelector('.form-message');
  const endpoint = '/api/' + id;
  let rows = [];
  let selected = '';

  function showMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle('text-danger', error);
    message.classList.toggle('text-success', !error);
  }

  function emptyTable(text) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.textContent = text;
  }

  function render() {
    const visible = rows.filter(matches);
    count.textContent = visible.length + ' ' + label;
    body.replaceChildren();
    if (!visible.length) emptyTable('Không tìm thấy ' + label + '.');
    for (const item of visible) {
      const row = body.insertRow();
      row.classList.toggle('is-selected', item[key] === selected);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'customer-selector';
      button.textContent = item[key];
      button.addEventListener('click', () => {
        if (fieldset.disabled) return;
        select(item);
        button.focus();
      });
      row.insertCell().append(button);
      for (const value of cells(item)) row.insertCell().textContent = value;
    }
  }

  function select(item) {
    form.reset();
    selected = item?.[key] ?? '';
    if (item) {
      for (const input of form.querySelectorAll('[name]')) input.value = item[input.name] ?? '';
    }
    code.readOnly = Boolean(selected);
    remove.disabled = !selected;
    save.textContent = selected ? 'Lưu thay đổi' : 'Thêm';
    for (const row of body.rows) {
      const button = row.querySelector('button');
      row.classList.toggle('is-selected', Boolean(button && button.textContent === selected));
    }
    showMessage('');
  }

  async function load() {
    try {
      rows = await request(endpoint);
    } catch (error) {
      if (!rows.length) {
        body.replaceChildren();
        emptyTable('Không thể tải danh sách ' + label + '.');
      }
      throw error;
    }
    onLoad?.(rows);
    render();
  }

  async function mutate(method, values) {
    fieldset.disabled = true;
    showMessage('');
    try {
      const path = selected ? endpoint + '/' + encodeURIComponent(selected) : endpoint;
      const result = await request(path, method, values);
      const savedCode = values?.[key];
      select();
      try {
        await load();
        if (savedCode) select(rows.find(item => item[key] === savedCode));
        showMessage(result.message);
      } catch {
        showMessage(result.message + ' Tải lại trang để cập nhật danh sách.', true);
      }
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      fieldset.disabled = false;
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    for (const name of Object.keys(data)) data[name] = data[name].trim();
    mutate(selected ? 'PUT' : 'POST', data);
  });
  remove.addEventListener('click', () => {
    if (selected && confirm('Xóa ' + label + ' ' + selected + '?')) mutate('DELETE');
  });
  form.querySelector('[data-reset]').addEventListener('click', () => {
    select();
    code.focus();
  });
  for (const filter of filters) byId(filter).addEventListener('input', render);

  return { load, render, enable: () => { fieldset.disabled = false; } };
}

const movieCatalog = makeCatalog({
  id: 'phim',
  key: 'MaPhim',
  label: 'phim',
  filters: ['movie-search', 'genre-filter'],
  matches: movie => normalize(movie.MaPhim + ' ' + movie.TenPhim).includes(normalize(byId('movie-search').value.trim()))
    && (!byId('genre-filter').value || movie.TheLoai === byId('genre-filter').value),
  cells: movie => [movie.TenPhim, movie.TheLoai, movie.DaoDien || '—', movie.ThoiLuong + ' phút',
    formatDate(movie.NgayKhoiChieu), movie.DoTuoiChoPhep === 0 ? 'P' : 'T' + movie.DoTuoiChoPhep],
  onLoad: rows => {
    syncMovies(rows);
    showtimeCatalog.render();
  }
});

const showtimeCatalog = makeCatalog({
  id: 'suat-chieu',
  key: 'MaSuatChieu',
  label: 'suất chiếu',
  filters: ['movie-filter', 'date-filter'],
  matches: show => (!byId('movie-filter').value || show.MaPhim === byId('movie-filter').value)
    && (!byId('date-filter').value || show.NgayChieu === byId('date-filter').value),
  cells: show => [
    movies.find(movie => movie.MaPhim === show.MaPhim)?.TenPhim ?? show.MaPhim,
    rooms.find(room => room.MaPhong === show.MaPhong)?.TenPhong ?? show.MaPhong,
    formatDate(show.NgayChieu), show.GioBatDau,
    show.GioKetThuc + (show.GioKetThuc < show.GioBatDau ? ' (+1 ngày)' : ''),
    money.format(show.GiaVe), statusLabels[show.TrangThai] ?? show.TrangThai
  ]
});

function suggestEnd() {
  const movie = movies.find(item => item.MaPhim === byId('ShowMovie').value);
  const start = byId('GioBatDau').value;
  if (!movie || !start) return;
  const [hour, minute, second = 0] = start.split(':').map(Number);
  const end = (hour * 60 + minute + movie.ThoiLuong) % 1440;
  byId('GioKetThuc').value = [Math.floor(end / 60), end % 60, second]
    .map(part => String(part).padStart(2, '0')).join(':');
}

function showPage() {
  const active = ['#suat-chieu', '#showtimesPage'].includes(location.hash) ? 'suat-chieu' : 'phim';
  for (const id of ['phim', 'suat-chieu']) {
    byId(id).hidden = id !== active;
    const link = document.querySelector('a[href="#' + id + '"]');
    if (id === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

byId('ShowMovie').addEventListener('change', suggestEnd);
byId('GioBatDau').addEventListener('change', suggestEnd);
window.addEventListener('hashchange', showPage);
showPage();

byId('logout-button').addEventListener('click', async () => {
  try {
    await request('/api/auth/logout', 'POST');
    location.replace('dang-nhap.html');
  } catch (error) {
    byId('page-error').textContent = error.message;
  }
});

async function initialize() {
  try {
    const account = await request('/api/auth/me');
    window.authToast.showPending();
    byId('account-name').textContent = account.HoTen || account.TenDangNhap;
    byId('logout-button').hidden = false;
    const results = await Promise.allSettled([
      movieCatalog.load().then(movieCatalog.enable),
      showtimeCatalog.load(),
      request('/api/phong-chieu').then(result => {
        rooms = result;
        setOptions(byId('MaPhong'), rooms.map(room => [room.MaPhong, room.TenPhong + ' (' + room.MaPhong + ')']));
      })
    ]);
    if (results.every(result => result.status === 'fulfilled')) {
      showtimeCatalog.render();
      showtimeCatalog.enable();
    } else {
      const error = results.find(result => result.status === 'rejected');
      byId('page-error').textContent = error.reason.message;
    }
  } catch (error) {
    byId('page-error').textContent = error.message;
  }
}

initialize();
