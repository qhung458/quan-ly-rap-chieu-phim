/* global jQuery, ListQuery, ExcelExport */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  const api = '/api/khach-hang';
  const $rows = $('#customer-rows');
  const $tickets = $('#ticket-rows');
  const $form = $('#customer-form');
  const $message = $('#customer-message');
  const $clear = $('#clear-customer');
  const $delete = $('#delete-customer');
  const historyForm = document.getElementById('history-query');
  const movieFilter = document.getElementById('history-movie-filter');
  const ticketStatuses = { DaDat: 'Đã đặt', DaSuDung: 'Đã sử dụng', DaHuy: 'Đã hủy' };
  let user;
  let selected = null;
  let saving = false;
  let loadingMovies = false;

  const enableCustomerExport = ExcelExport.bindDownload('customers-export', () => ({
    filename: 'khach-hang', url: api + '/xuat', snapshotId: customers.getSnapshotId()
  }));

  function showError(xhr) {
    if (xhr.status === 401) {
      location.assign('dang-nhap.html');
      return;
    }
    $message.addClass('text-danger')
      .text(xhr.responseJSON?.message || 'Không kết nối được máy chủ.');
  }

  function emptyRow($body, message) {
    $body.empty().append($('<tr>').append($('<td>', { colspan: 4, text: message })));
  }

  function bindQueryPanel({ id, countId, $body, label, defaultSort, labels, load, renderRows, emptyText, onResult, onRefresh }) {
    const form = document.getElementById(id + '-query');
    const fieldset = form.querySelector('fieldset');
    const fields = Array.from(fieldset.querySelectorAll('[name]'));
    const chips = form.querySelector('[data-query-conditions]');
    const pagination = document.getElementById(id + '-pages');
    const previous = pagination.querySelector('[data-page-prev]');
    const next = pagination.querySelector('[data-page-next]');
    const position = pagination.querySelector('[data-page-position]');
    const count = document.getElementById(countId);
    const controller = ListQuery.create({ defaults: { sort: defaultSort }, load, onChange: render });

    function readDraft() {
      return Object.fromEntries(fields.map(field => [field.name, field.multiple
        ? Array.from(field.selectedOptions, option => option.value) : field.value.trim()]));
    }

    function writeDraft() {
      const draft = controller.getState().draft;
      for (const field of fields) {
        if (field.multiple) {
          for (const option of field.options) option.selected = draft[field.name]?.includes(option.value) ?? false;
        } else {
          field.value = draft[field.name] ?? (field.name === 'sort' ? defaultSort : '');
        }
      }
    }

    function renderConditions(applied) {
      chips.replaceChildren();
      for (const [name, values] of Object.entries(applied)) {
        if (!values || (name === 'sort' && values === defaultSort)) continue;
        const field = fields.find(input => input.name === name);
        for (const value of Array.isArray(values) ? values : [values]) {
          const display = field?.options ? Array.from(field.options).find(option => option.value === value)?.text : value;
          const description = `${labels[name]} · ${display ?? value}`;
          const button = document.createElement('button');
          button.className = 'btn btn-outline-secondary btn-sm';
          button.type = 'button';
          button.textContent = description + ' ×';
          button.setAttribute('aria-label', 'Bỏ điều kiện ' + description);
          button.addEventListener('click', () => {
            controller.setDraft(readDraft());
            controller.remove(name, value);
            writeDraft();
            form.querySelector('button[type="submit"]').focus();
          });
          const item = document.createElement('li');
          item.append(button);
          chips.append(item);
        }
      }
      chips.hidden = !chips.children.length;
    }

    function render(state) {
      const ready = state.status === 'ready';
      onResult?.(state);
      renderConditions(state.applied);
      count.textContent = ready || state.status === 'empty' ? `${state.total} ${label}` : '';
      $body.closest('table').attr('aria-busy', String(state.status === 'loading'));
      const pages = Math.ceil(state.total / state.pageSize);
      pagination.hidden = !ready || pages <= 1;
      previous.disabled = !ready || state.page <= 1;
      next.disabled = !ready || state.page >= pages;
      position.textContent = pages > 1 ? `Trang ${state.page} / ${pages}` : '';

      if (ready) renderRows(state.items);
      else if (state.status === 'loading') emptyRow($body, `Đang tải ${label}…`);
      else if (state.status === 'empty') emptyRow($body, emptyText(state));
      else if (state.status === 'error') {
        if (state.error.status === 401) location.assign('dang-nhap.html');
        emptyRow($body, state.error.message);
      } else if (id === 'history') emptyRow($body, 'Chọn một khách hàng để xem lịch sử.');
    }

    form.addEventListener('submit', event => {
      event.preventDefault();
      if (fieldset.disabled) return;
      controller.setDraft(readDraft());
      controller.apply();
    });
    form.querySelector('[data-query-reset]').addEventListener('click', () => {
      controller.reset();
      writeDraft();
    });
    form.querySelector('[data-query-refresh]').addEventListener('click', () => {
      controller.refresh();
      onRefresh?.();
    });
    previous.addEventListener('click', () => controller.goToPage(controller.getState().page - 1));
    next.addEventListener('click', () => controller.goToPage(controller.getState().page + 1));

    return {
      getSnapshotId: controller.getSnapshotId,
      refresh: controller.refresh,
      reset() { controller.reset(); writeDraft(); },
      clear() { controller.clear(); writeDraft(); },
      enable(enabled) { fieldset.disabled = !enabled; },
      refreshConditions() { renderConditions(controller.getState().applied); }
    };
  }

  const customers = bindQueryPanel({
    id: 'customers', countId: 'customer-count', $body: $rows, label: 'khách hàng', defaultSort: 'maKhachHang:asc',
    labels: { q: 'Từ khóa', maKhachHang: 'Mã khách', ten: 'Họ và tên', soDienThoai: 'Số điện thoại', email: 'Email',
      coEmail: 'Email trong hồ sơ', veTuNgay: 'Có vé từ ngày đặt', veDenNgay: 'Có vé đến ngày đặt', sort: 'Sắp xếp' },
    load: ListQuery.loadFrom(api), renderRows: renderCustomers,
    emptyText: () => 'Không tìm thấy khách hàng phù hợp.',
    onResult: state => enableCustomerExport(state.status === 'ready' && Boolean(state.snapshotId))
  });

  const history = bindQueryPanel({
    id: 'history', countId: 'history-count', $body: $tickets, label: 'vé', defaultSort: 'ngayDat:desc',
    labels: { q: 'Từ khóa', maVe: 'Mã vé', tenPhim: 'Tên phim', maPhim: 'Phim', tuNgay: 'Ngày đặt từ',
      denNgay: 'Ngày đặt đến', trangThai: 'Trạng thái', sort: 'Sắp xếp' },
    load: (params, context) => ListQuery.loadFrom(customerUrl(selected) + '/ve')(params, context),
    renderRows: renderTickets,
    emptyText: state => state.meta?.hasHistory === false
      ? 'Khách hàng chưa có lịch sử mua vé.' : 'Không tìm thấy vé phù hợp trong lịch sử.',
    onRefresh: loadMovieOptions
  });

  async function loadMovieOptions() {
    if (loadingMovies) return;
    loadingMovies = true;
    const notice = document.getElementById('history-movies-message');
    try {
      const { phim } = await $.getJSON('/api/phim/tuy-chon');
      const previous = new Set(Array.from(movieFilter.selectedOptions, option => option.value));
      movieFilter.replaceChildren(...phim.map(movie => new Option(
        `${movie.TenPhim} (${movie.MaPhim})`, movie.MaPhim, false, previous.has(movie.MaPhim)
      )));
      movieFilter.disabled = false;
      notice.hidden = true;
      history.refreshConditions();
    } catch (xhr) {
      if (xhr.status === 401) return location.assign('dang-nhap.html');
      notice.textContent = 'Không tải được tùy chọn phim. Bấm Tải lại để thử lại.';
      notice.hidden = false;
    } finally {
      loadingMovies = false;
    }
  }

  function customerUrl(customer) {
    return api + '/' + encodeURIComponent(customer.MaKhachHang);
  }

  function syncButtons() {
    $form.find('button[value="them"]').prop('disabled', !user || saving || Boolean(selected));
    $form.find('button[value="sua"]').prop('disabled', saving || !selected);
    $delete.prop('disabled', saving || !selected || user?.VaiTro !== 'QuanTriVien');
    $clear.prop('disabled', !user || saving);
  }

  function setCustomer(customer, refreshHistory = false) {
    const changed = selected?.MaKhachHang !== customer?.MaKhachHang;
    selected = customer;
    $form[0].reset();
    $('#customer-id').prop('readOnly', Boolean(customer));
    if (customer) {
      for (const field of ['MaKhachHang', 'TenKhachHang', 'SoDienThoai', 'Email']) {
        $form[0].elements.namedItem(field).value = customer[field] ?? '';
      }
    }

    $rows.find('.customer-selector').each(function () {
      const $button = $(this);
      const active = $button.data('customer').MaKhachHang === selected?.MaKhachHang;
      $button.attr('aria-pressed', String(active)).closest('tr').toggleClass('is-selected', active);
    });
    syncButtons();

    historyForm.hidden = !customer;
    history.enable(Boolean(customer));
    $('#history-customer').prop('hidden', !customer)
      .text(customer ? `${customer.MaKhachHang} · ${customer.TenKhachHang}` : '');
    if (!customer) history.clear();
    else if (changed) history.reset();
    else if (refreshHistory) history.refresh();
  }

  function renderCustomers(items) {
    $rows.empty();
    for (const customer of items) {
      const active = customer.MaKhachHang === selected?.MaKhachHang;
      const $button = $('<button>', {
        type: 'button', class: 'customer-selector', text: customer.MaKhachHang, 'aria-pressed': String(active)
      }).data('customer', customer);
      $rows.append($('<tr>').toggleClass('is-selected', active).append(
        $('<td>').append($button),
        $('<td>').text(customer.TenKhachHang),
        $('<td>').text(customer.SoDienThoai),
        $('<td>').text(customer.Email?.trim() ? customer.Email : '—')
      ));
    }
  }

  function renderTickets(items) {
    $tickets.empty();
    for (const ticket of items) {
      $tickets.append($('<tr>').append(
        $('<td>').text(ticket.MaVe),
        $('<td>').text(ticket.TenPhim),
        $('<td>').text(ticket.NgayDat),
        $('<td>').text(ticketStatuses[ticket.TrangThai] ?? ticket.TrangThai)
      ));
    }
  }

  async function saveCustomer(method, url, payload) {
    if (!user || saving) return;
    saving = true;
    syncButtons();
    $message.removeClass('text-danger').empty();

    try {
      const saved = await $.ajax({
        url, method, contentType: 'application/json', data: payload ? JSON.stringify(payload) : undefined
      });
      setCustomer(method === 'DELETE' ? null : saved, true);
      const actions = { POST: 'Đã thêm khách hàng.', PUT: 'Đã cập nhật khách hàng.', DELETE: 'Đã xóa khách hàng.' };
      $message.text(actions[method]);
      await customers.refresh();
    } catch (xhr) {
      showError(xhr);
    } finally {
      saving = false;
      syncButtons();
    }
  }

  $form.on('submit', event => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData($form[0]));
    saveCustomer(selected ? 'PUT' : 'POST', selected ? customerUrl(selected) : api, payload);
  });

  $rows.on('click', 'tr', function () {
    const customer = $(this).find('.customer-selector').data('customer');
    if (saving || !customer) return;
    $message.empty();
    setCustomer(customer);
  });

  $clear.on('click', () => {
    $message.empty();
    setCustomer(null);
    $('#customer-id').trigger('focus');
  });

  $delete.on('click', () => {
    if (selected && window.confirm('Xóa khách hàng ' + selected.MaKhachHang + '?')) {
      saveCustomer('DELETE', customerUrl(selected));
    }
  });

  $('#logout-button').on('click', async () => {
    try {
      await $.ajax({ url: '/api/auth/logout', method: 'POST' });
      location.assign('dang-nhap.html');
    } catch (xhr) {
      showError(xhr);
    }
  });

  $.getJSON('/api/auth/me').done(account => {
    user = account;
    $('#account-name').text(user.HoTen + ' · ' +
      (user.VaiTro === 'QuanTriVien' ? 'Quản trị viên' : 'Nhân viên quầy'));
    $('#logout-button').prop('hidden', false);
    customers.enable(true);
    syncButtons();
    customers.refresh();
    loadMovieOptions();
  }).fail(showError);
})();
