/* global jQuery */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  const money = new Intl.NumberFormat('vi-VN');
  const formatMoney = value => money.format(value) + ' ₫';
  const $message = $('#stats-message');
  const $submit = $('#stats-form button[type="submit"]');
  let data = null;
  let mode = 'day';
  let version = 0;

  const dateText = date => {
    const pad = number => String(number).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  };

  function showError(xhr) {
    if (xhr.status === 401) {
      location.assign('dang-nhap.html');
      return;
    }
    $message.addClass('text-danger').text(xhr.responseJSON?.message || 'Không kết nối được máy chủ.');
  }

  function emptyRow($body, columns, text) {
    $body.empty().append($('<tr>').append($('<td>', { colspan: columns, text })));
  }

  function tile(label, value, sub, total) {
    return $('<div class="stat-tile">').toggleClass('is-total', Boolean(total)).append(
      $('<p class="stat-label">').text(label),
      $('<p class="stat-value">').text(value),
      $('<p class="stat-sub">').text(sub)
    );
  }

  function renderTiles(summary) {
    $('#stat-tiles').empty().append(
      tile('Tổng doanh thu', formatMoney(summary.TongDoanhThu), 'Vé + bắp nước', true),
      tile('Doanh thu vé', formatMoney(summary.DoanhThuVe), summary.SoVe + ' vé'),
      tile('Doanh thu bắp nước', formatMoney(summary.DoanhThuBapNuoc), summary.SoHoaDon + ' hóa đơn')
    );
  }

  function renderPeriod() {
    const rows = mode === 'day' ? data.TheoNgay : data.TheoThang;
    $('#period-head').text(mode === 'day' ? 'Ngày' : 'Tháng');
    const $body = $('#period-rows');
    if (!rows.length) {
      emptyRow($body, 6, 'Không có doanh thu trong khoảng ngày này.');
      return;
    }
    $body.empty();
    for (const row of rows) {
      const label = mode === 'day'
        ? row.Ngay.split('-').reverse().join('/')
        : row.Thang.split('-').reverse().join('/');
      $body.append($('<tr>').append(
        $('<th scope="row" class="fw-normal">').text(label),
        $('<td class="money">').text(row.SoVe),
        $('<td class="money">').text(formatMoney(row.DoanhThuVe)),
        $('<td class="money">').text(row.SoHoaDon),
        $('<td class="money">').text(formatMoney(row.DoanhThuBapNuoc)),
        $('<td class="money fw-bold">').text(formatMoney(row.TongDoanhThu))
      ));
    }
  }

  function barRows($body, rows, nameField, countField, columns, emptyText) {
    if (!rows.length) {
      emptyRow($body, columns, emptyText);
      return;
    }
    const max = Math.max(...rows.map(row => row.DoanhThu), 1);
    $body.empty();
    for (const row of rows) {
      $body.append($('<tr>').append(
        $('<td>').text(row[nameField]),
        $('<td class="money">').text(row[countField]),
        $('<td class="bar-cell">').append(
          $('<div>').text(formatMoney(row.DoanhThu)),
          $('<div class="bar-track">').append($('<div class="bar-fill">').css('width', (row.DoanhThu / max * 100) + '%'))
        )
      ));
    }
  }

  function render() {
    renderTiles(data.TongQuan);
    renderPeriod();
    barRows($('#film-rows'), data.TheoPhim, 'TenPhim', 'SoVe', 3, 'Chưa có vé được bán.');
    barRows($('#combo-stat-rows'), data.TheoCombo, 'TenCombo', 'SoLuong', 3, 'Chưa có hóa đơn bắp nước.');
  }

  async function load() {
    const current = ++version;
    $message.removeClass('text-danger').empty();
    const from = $('#stats-from').val();
    const to = $('#stats-to').val();
    if (!from || !to || from > to) {
      $message.addClass('text-danger').text('Chọn khoảng ngày hợp lệ: từ ngày không được sau đến ngày.');
      return;
    }

    $submit.prop('disabled', true);
    try {
      const result = await $.getJSON('/api/thong-ke', { tuNgay: from, denNgay: to });
      if (current !== version) return;
      data = result;
      render();
    } catch (xhr) {
      if (current !== version) return;
      showError(xhr);
    } finally {
      if (current === version) $submit.prop('disabled', false);
    }
  }

  function setMode(next) {
    mode = next;
    $('#by-day').toggleClass('btn-dark', next === 'day').toggleClass('btn-outline-dark', next !== 'day')
      .attr('aria-pressed', String(next === 'day'));
    $('#by-month').toggleClass('btn-dark', next === 'month').toggleClass('btn-outline-dark', next !== 'month')
      .attr('aria-pressed', String(next === 'month'));
    if (data) renderPeriod();
  }

  $('#stats-form').on('submit', event => {
    event.preventDefault();
    load();
  });
  $('#by-day').on('click', () => setMode('day'));
  $('#by-month').on('click', () => setMode('month'));
  $('#logout-button').on('click', async () => {
    try {
      await $.ajax({ url: '/api/auth/logout', method: 'POST' });
      location.assign('dang-nhap.html');
    } catch (xhr) {
      showError(xhr);
    }
  });

  $.getJSON('/api/auth/me').done(user => {
    $('#account-name').text(user.HoTen + ' · ' +
      (user.VaiTro === 'QuanTriVien' ? 'Quản trị viên' : 'Nhân viên quầy'));
    $('#logout-button').prop('hidden', false);
    // Mặc định: 30 ngày gần nhất tính đến hôm nay.
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    $('#stats-from').val(dateText(start));
    $('#stats-to').val(dateText(today));
    $submit.prop('disabled', false);
    load();
  }).fail(showError);
})();
