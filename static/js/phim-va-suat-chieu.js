'use strict';

const byId = id => document.getElementById(id);
const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 2 });
const statusLabels = { SapChieu: 'Sắp chiếu', DangChieu: 'Đang chiếu', KetThuc: 'Kết thúc', Huy: 'Hủy' };
const formatDate = date => date.split('-').reverse().join('/');
let movies = [];
let optionsVersion = 0;
let moviesLoaded = false;
let roomsLoaded = false;

async function request(url, method = 'GET', data) {
  const response = await fetch(url, {
    method,
    cache: 'no-store',
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
  const previous = new Set(Array.from(select.selectedOptions, option => option.value));
  const placeholder = select.multiple ? [] : [select.options[0]];
  select.replaceChildren(...placeholder, ...entries.map(([value, label]) =>
    new Option(label, value, false, previous.has(value))));
  if (!select.multiple && !entries.some(([value]) => previous.has(value))) select.value = '';
}

async function refreshOptions() {
  const version = ++optionsVersion;
  const [movieOptions, roomOptions] = await Promise.allSettled([
    request('/api/phim/tuy-chon'), request('/api/phong-chieu/tuy-chon')
  ]);
  if (version !== optionsVersion) return;

  if (movieOptions.status === 'fulfilled') {
    movies = movieOptions.value.phim;
    const entries = movies.map(movie => [movie.MaPhim, `${movie.TenPhim} (${movie.MaPhim})`]);
    setOptions(byId('ShowMovie'), entries);
    setOptions(byId('movie-filter'), entries);
    setOptions(byId('genre-filter'), movieOptions.value.theLoai.map(genre => [genre.value, genre.label]));
    moviesLoaded = true;
  }
  if (roomOptions.status === 'fulfilled') {
    const entries = roomOptions.value.map(room => [room.MaPhong, `${room.TenPhong} (${room.MaPhong})`]);
    setOptions(byId('MaPhong'), entries);
    setOptions(byId('room-filter'), entries);
    roomsLoaded = true;
  }
  if (moviesLoaded && roomsLoaded) showtimeCatalog.enableEditor();
  movieCatalog.refreshConditions();
  showtimeCatalog.refreshConditions();
  const failed = [movieOptions, roomOptions].some(result => result.status === 'rejected');
  byId('page-error').textContent = failed ? 'Không thể tải tất cả tùy chọn phim và phòng. Hãy bấm Tải lại để thử lại.' : '';
}

function makeCatalog({ id, key, label, defaultSort, labels, cells, onMutation }) {
  const section = byId(id);
  const filterForm = section.querySelector('[data-query-form]');
  const filters = Array.from(filterForm.querySelectorAll('[name]'));
  const mainSort = filterForm.querySelector('[data-sort-main]');
  const mainDirection = filterForm.querySelector('[data-sort-main-dir]');
  const extraSort = filterForm.querySelector('[data-sort-extra]');
  const extraDirection = filterForm.querySelector('[data-sort-extra-dir]');
  const chips = filterForm.querySelector('[data-query-conditions]');
  const pagination = section.querySelector('[data-query-pagination]');
  const next = pagination.querySelector('[data-page-next]');
  const previous = pagination.querySelector('[data-page-prev]');
  const pagePosition = pagination.querySelector('[data-page-position]');
  const form = section.querySelector('.form-stack');
  const fieldset = form.querySelector('fieldset');
  const table = section.querySelector('table');
  const body = table.tBodies[0];
  const count = section.querySelector('[data-count]');
  const save = form.querySelector('[data-save]');
  const remove = form.querySelector('[data-delete]');
  const code = form.elements.namedItem(key);
  const message = form.querySelector('.form-message');
  const endpoint = '/api/' + id;
  let selected = '';
  let saving = false;
  for (const option of mainSort.options) extraSort.append(option.cloneNode(true));

  const enableExport = ExcelExport.bindDownload(id + '-export', () => ({
    filename: id,
    url: endpoint + '/xuat',
    snapshotId: controller.getSnapshotId()
  }));
  const controller = ListQuery.create({
    defaults: { sort: defaultSort }, load: ListQuery.loadFrom(endpoint), onChange: render
  });

  function syncSortControls() {
    if (extraSort.value === mainSort.value) extraSort.value = '';
    for (const option of extraSort.options) option.disabled = option.value === mainSort.value;
    extraDirection.disabled = !extraSort.value;
  }

  function writeDraft(draft) {
    for (const field of filters) {
      const value = draft[field.name];
      if (field.multiple) {
        for (const option of field.options) option.selected = value?.includes(option.value) ?? false;
      } else {
        field.value = value ?? '';
      }
    }
    const [main, extra = ''] = (draft.sort || defaultSort).split(',');
    [mainSort.value, mainDirection.value] = main.split(':');
    [extraSort.value, extraDirection.value = 'asc'] = extra.split(':');
    syncSortControls();
  }

  function readDraft() {
    const values = Object.fromEntries(filters.map(field => [field.name, field.multiple
      ? Array.from(field.selectedOptions, option => option.value) : field.value.trim()]));
    const order = [`${mainSort.value}:${mainDirection.value}`];
    if (extraSort.value) order.push(`${extraSort.value}:${extraDirection.value}`);
    return { ...values, sort: order.join(',') };
  }

  function conditionLabel(name, value) {
    if (name === 'sort') {
      return 'Sắp xếp · ' + value.split(',').map(order => {
        const [field, direction] = order.split(':');
        const text = Array.from(mainSort.options).find(option => option.value === field)?.text ?? field;
        return text + (direction === 'asc' ? ' tăng' : ' giảm');
      }).join(', rồi ');
    }
    const field = filters.find(field => field.name === name);
    const text = field?.multiple
      ? Array.from(field.options).find(option => option.value === value)?.text ?? value : value;
    return `${labels[name]} · ${text}`;
  }

  function renderConditions(applied) {
    chips.replaceChildren();
    for (const [name, values] of Object.entries(applied)) {
      if (!values || (name === 'sort' && values === defaultSort)) continue;
      for (const value of Array.isArray(values) ? values : [values]) {
        const text = conditionLabel(name, value);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-outline-secondary btn-sm catalog-condition';
        button.textContent = text + ' ×';
        button.setAttribute('aria-label', 'Bỏ điều kiện ' + text);
        button.addEventListener('click', () => {
          controller.setDraft(readDraft());
          controller.remove(name, value);
          writeDraft(controller.getState().draft);
          filterForm.querySelector('button[type="submit"]').focus();
        });
        const item = document.createElement('li');
        item.append(button);
        chips.append(item);
      }
    }
    chips.hidden = !chips.children.length;
  }

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

  function render(state) {
    const ready = state.status === 'ready';
    enableExport(ready && Boolean(state.snapshotId));
    renderConditions(state.applied);
    count.textContent = ready || state.status === 'empty' ? `${state.total} ${label}` : '';
    table.setAttribute('aria-busy', String(state.status === 'loading'));
    const pages = Math.ceil(state.total / state.pageSize);
    pagination.hidden = pages <= 1;
    previous.disabled = !ready || state.page <= 1;
    next.disabled = !ready || state.page >= pages;
    pagePosition.textContent = pages > 1 ? `Trang ${state.page} / ${pages}` : '';

    body.replaceChildren();
    if (state.status === 'loading') emptyTable(`Đang tải ${label}…`);
    if (state.status === 'empty') emptyTable(`Không tìm thấy ${label} phù hợp.`);
    if (state.status === 'error') {
      if (state.error.status === 401) location.replace('dang-nhap.html');
      emptyTable(state.error.message);
    }
    if (!ready) return;

    for (const item of state.items) {
      const row = body.insertRow();
      row.classList.toggle('is-selected', item[key] === selected);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'customer-selector';
      button.textContent = item[key];
      button.setAttribute('aria-pressed', String(item[key] === selected));
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
      const active = Boolean(button && button.textContent === selected);
      row.classList.toggle('is-selected', active);
      button?.setAttribute('aria-pressed', String(active));
    }
    showMessage('');
  }

  async function mutate(method, values) {
    if (fieldset.disabled) return;
    saving = true;
    fieldset.disabled = true;
    showMessage('');
    try {
      const path = selected ? endpoint + '/' + encodeURIComponent(selected) : endpoint;
      const result = await request(path, method, values);
      select(values);
      const [state] = await Promise.all([controller.refresh(), onMutation?.()]);
      const refreshFailed = state?.status === 'error';
      showMessage(refreshFailed ? result.message + ' Hãy bấm Tải lại để cập nhật danh sách.' : result.message, refreshFailed);
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      saving = false;
      fieldset.disabled = false;
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (fieldset.disabled) return;
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
  mainSort.addEventListener('change', syncSortControls);
  extraSort.addEventListener('change', syncSortControls);
  filterForm.addEventListener('submit', event => {
    event.preventDefault();
    controller.setDraft(readDraft());
    controller.apply();
  });
  filterForm.querySelector('[data-query-reset]').addEventListener('click', () => {
    controller.reset();
    writeDraft(controller.getState().draft);
  });
  filterForm.querySelector('[data-query-refresh]').addEventListener('click', () => {
    controller.refresh();
    refreshOptions();
  });
  previous.addEventListener('click', () => controller.goToPage(controller.getState().page - 1));
  next.addEventListener('click', () => controller.goToPage(controller.getState().page + 1));
  writeDraft(controller.getState().draft);

  return {
    load: controller.refresh,
    enableQuery: () => { filterForm.querySelector('fieldset').disabled = false; },
    enableEditor: () => { if (!saving) fieldset.disabled = false; },
    refreshConditions: () => renderConditions(controller.getState().applied)
  };
}

const movieCatalog = makeCatalog({
  id: 'phim',
  key: 'MaPhim',
  label: 'phim',
  defaultSort: 'maPhim:asc',
  labels: { q: 'Từ khóa', maPhim: 'Mã phim', tenPhim: 'Tên phim', daoDien: 'Đạo diễn',
    theLoai: 'Thể loại', tuNgay: 'Khởi chiếu từ', denNgay: 'Khởi chiếu đến',
    phutMin: 'Số phút từ', phutMax: 'Số phút đến', tuoiToiDa: 'Độ tuổi tối thiểu không quá' },
  cells: movie => [movie.TenPhim, movie.TheLoai, movie.DaoDien || '—', movie.ThoiLuong + ' phút',
    formatDate(movie.NgayKhoiChieu), movie.DoTuoiChoPhep === 0 ? 'P' : 'T' + movie.DoTuoiChoPhep],
  onMutation: refreshOptions
});

function showtimeCatalogCells(show) {
  return [
    show.TenPhim ?? show.MaPhim,
    show.TenPhong ?? show.MaPhong,
    formatDate(show.NgayChieu), show.GioBatDau,
    show.GioKetThuc + (show.GioKetThuc < show.GioBatDau ? ' (+1 ngày)' : ''),
    money.format(show.GiaVe), statusLabels[show.TrangThai] ?? show.TrangThai
  ]
}

const showtimeCatalog = makeCatalog({
  id: 'suat-chieu',
  key: 'MaSuatChieu',
  label: 'suất chiếu',
  defaultSort: 'lich:asc',
  labels: { q: 'Từ khóa', maSuatChieu: 'Mã suất', tenPhim: 'Tên phim', tenPhong: 'Tên phòng',
    maPhim: 'Phim', maPhong: 'Phòng', trangThai: 'Trạng thái', tuNgay: 'Chiếu từ', denNgay: 'Chiếu đến',
    gioTu: 'Bắt đầu từ giờ', gioDen: 'Bắt đầu đến giờ', giaMin: 'Giá vé từ', giaMax: 'Giá vé đến' },
  cells: showtimeCatalogCells
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
    movieCatalog.enableQuery();
    movieCatalog.enableEditor();
    showtimeCatalog.enableQuery();
    await Promise.all([
      movieCatalog.load(),
      showtimeCatalog.load(),
      refreshOptions()
    ]);
  } catch (error) {
    byId('page-error').textContent = error.message;
  }
}

initialize();
