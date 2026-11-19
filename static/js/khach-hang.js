/* global jQuery */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  const api = '/api/khach-hang';
  const $rows = $('#customer-rows');
  const $tickets = $('#ticket-rows');
  const $form = $('#customer-form');
  const $message = $('#customer-message');
  const $search = $('#customer-search');
  const $clear = $('#clear-customer');
  const $delete = $('#delete-customer');
  let user;
  let selected = null;
  let saving = false;
  let listVersion = 0;
  let historyVersion = 0;
  let searchTimer;

  function showError(xhr) {
    if (xhr.status === 401) {
      location.assign('dang-nhap.html');
      return;
    }
    $message.addClass('text-danger')
      .text(xhr.responseJSON?.message || 'Không kết nối được máy chủ.');
  }

  function emptyRow($body, columns, message) {
    $body.empty().append($('<tr>').append($('<td>', { colspan: columns, text: message })));
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

  function setCustomer(customer) {
    selected = customer;
    $form[0].reset();
    $('#customer-id').prop('readOnly', Boolean(customer));

    if (customer) {
      for (const [field, value] of Object.entries(customer)) {
        $form[0].elements.namedItem(field).value = value ?? '';
      }
    }

    $rows.find('.customer-selector').each(function () {
      const $button = $(this);
      const active = $button.data('customer').MaKhachHang === selected?.MaKhachHang;
      $button.attr('aria-pressed', String(active)).closest('tr').toggleClass('is-selected', active);
    });
    syncButtons();
    loadTickets();
  }

  function renderCustomers(customers) {
    $rows.empty();
    $('#customer-count').text(customers.length + ' khách hàng');
    if (!customers.length) emptyRow($rows, 4, 'Không tìm thấy khách hàng.');

    for (const customer of customers) {
      const active = customer.MaKhachHang === selected?.MaKhachHang;
      const $button = $('<button>', {
        type: 'button',
        class: 'customer-selector',
        text: customer.MaKhachHang,
        'aria-pressed': String(active)
      }).data('customer', customer);
      $rows.append($('<tr>').toggleClass('is-selected', active).append(
        $('<td>').append($button),
        $('<td>').text(customer.TenKhachHang),
        $('<td>').text(customer.SoDienThoai),
        $('<td>').text(customer.Email ?? '—')
      ));
    }
  }

  async function loadCustomers() {
    const version = ++listVersion;
    try {
      const rows = await $.getJSON(api, { q: $search.val() });
      if (version === listVersion) renderCustomers(rows);
    } catch (xhr) {
      if (version !== listVersion) return;
      emptyRow($rows, 4, 'Không tải được danh sách khách hàng.');
      $('#customer-count').empty();
      showError(xhr);
    }
  }

  async function loadTickets() {
    const version = ++historyVersion;
    if (!selected) {
      emptyRow($tickets, 4, 'Chọn một khách hàng để xem lịch sử.');
      return;
    }

    emptyRow($tickets, 4, 'Đang tải lịch sử…');
    try {
      const tickets = await $.getJSON(customerUrl(selected) + '/ve');
      if (version !== historyVersion) return;

      $tickets.empty();
      if (!tickets.length) emptyRow($tickets, 4, 'Khách hàng chưa có lịch sử mua vé.');
      const statuses = { DaDat: 'Đã đặt', DaSuDung: 'Đã sử dụng', DaHuy: 'Đã hủy' };
      for (const ticket of tickets) {
        $tickets.append($('<tr>').append(
          $('<td>').text(ticket.MaVe),
          $('<td>').text(ticket.TenPhim),
          $('<td>').text(ticket.NgayDat),
          $('<td>').text(statuses[ticket.TrangThai] ?? ticket.TrangThai)
        ));
      }
    } catch (xhr) {
      if (version !== historyVersion) return;
      emptyRow($tickets, 4, 'Không tải được lịch sử.');
      showError(xhr);
    }
  }

  async function saveCustomer(method, url, payload) {
    if (!user || saving) return;
    saving = true;
    syncButtons();
    $message.removeClass('text-danger').empty();

    try {
      const saved = await $.ajax({
        url,
        method,
        contentType: 'application/json',
        data: payload ? JSON.stringify(payload) : undefined
      });
      setCustomer(method === 'DELETE' ? null : saved);
      const actions = { POST: 'Đã thêm khách hàng.', PUT: 'Đã cập nhật khách hàng.', DELETE: 'Đã xóa khách hàng.' };
      $message.text(actions[method]);
      await loadCustomers();
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

  $search.on('input', () => {
    listVersion++;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadCustomers, 250);
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
    $search.prop('disabled', false);
    syncButtons();
    loadCustomers();
  }).fail(showError);
})();
