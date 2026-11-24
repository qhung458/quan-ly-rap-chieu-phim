/* global jQuery */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  const comboApi = '/api/bap-nuoc';
  const invoiceApi = '/api/hoa-don';
  const money = new Intl.NumberFormat('vi-VN');
  const formatMoney = value => money.format(value) + ' ₫';
  const $comboRows = $('#combo-rows');
  const $invoiceRows = $('#invoice-rows');
  const $comboForm = $('#combo-form');
  const $comboMessage = $('#combo-message');
  const $invoiceForm = $('#invoice-form');
  const $invoiceMessage = $('#invoice-message');
  const $customer = $('#invoice-customer');
  const $lines = $('#invoice-lines');
  const $deleteCombo = $('#delete-combo');
  const $deleteInvoice = $('#delete-invoice');
  let user;
  let combos = [];
  let selectedCombo = null;
  let selectedInvoice = null;
  let saving = false;
  let comboVersion = 0;
  let invoiceVersion = 0;
  let customerVersion = 0;
  let detailVersion = 0;
  let comboTimer;
  let invoiceTimer;
  let customerTimer;

  function showError($message, xhr) {
    if (xhr.status === 401) {
      location.assign('dang-nhap.html');
      return;
    }
    $message.addClass('text-danger').text(xhr.responseJSON?.message || 'Không kết nối được máy chủ.');
  }

  function emptyRow($body, columns, message) {
    $body.empty().append($('<tr>').append($('<td>', { colspan: columns, text: message })));
  }

  function syncButtons() {
    const admin = user?.VaiTro === 'QuanTriVien';
    $comboForm.find('button[value="them"]').prop('disabled', !user || saving || Boolean(selectedCombo));
    $comboForm.find('button[value="sua"]').prop('disabled', saving || !selectedCombo);
    $deleteCombo.prop('disabled', saving || !selectedCombo || !admin);
    $('#clear-combo').prop('disabled', !user || saving);
    $('#add-line').prop('disabled', !user || saving || !combos.length);
    $('#invoice-submit').prop('disabled', !user || saving || !$customer.val() ||
      !$lines.children().length || $lines.find('.line-combo').toArray().some(select => !select.value));
    $deleteInvoice.prop('hidden', !selectedInvoice || !admin).prop('disabled', saving);
  }

  /* ---------- Combo ---------- */

  function setCombo(combo) {
    selectedCombo = combo;
    $comboForm[0].reset();
    $('#combo-id').prop('readOnly', Boolean(combo));
    if (combo) {
      for (const field of ['MaCombo', 'TenCombo', 'GiaCombo', 'MoTa']) {
        $comboForm[0].elements.namedItem(field).value = combo[field] ?? '';
      }
    }
    $comboRows.find('tr').each(function () {
      const active = $(this).data('combo')?.MaCombo === combo?.MaCombo;
      $(this).toggleClass('is-selected', active);
      $(this).find('.customer-selector').attr('aria-pressed', String(active));
    });
    syncButtons();
  }

  function renderCombos(rows) {
    $comboRows.empty();
    $('#combo-count').text(rows.length + ' combo');
    if (!rows.length) emptyRow($comboRows, 4, 'Không tìm thấy combo.');
    for (const combo of rows) {
      const active = combo.MaCombo === selectedCombo?.MaCombo;
      $comboRows.append($('<tr>').data('combo', combo).toggleClass('is-selected', active).append(
        $('<td>').append($('<button>', {
          type: 'button', class: 'customer-selector', text: combo.MaCombo, 'aria-pressed': String(active)
        })),
        $('<td>').append($('<div>').text(combo.TenCombo), $('<div class="small text-secondary">').text(combo.MoTa ?? '')),
        $('<td class="money">').text(formatMoney(combo.GiaCombo)),
        $('<td class="money">').text(combo.DaBan)
      ));
    }
  }

  async function loadComboRows() {
    const version = ++comboVersion;
    const keyword = $('#combo-search').val().trim();
    try {
      const rows = keyword ? await $.getJSON(comboApi, { q: keyword }) : combos;
      if (version === comboVersion) renderCombos(rows);
    } catch (xhr) {
      if (version !== comboVersion) return;
      emptyRow($comboRows, 4, 'Không tải được danh mục combo.');
      $('#combo-count').empty();
      showError($comboMessage, xhr);
    }
  }

  async function loadCombos() {
    try {
      combos = await $.getJSON(comboApi);
      refreshLineOptions();
      if (!$lines.children().length) addLine();
      syncButtons();
      await loadComboRows();
    } catch (xhr) {
      emptyRow($comboRows, 4, 'Không tải được danh mục combo.');
      $('#combo-count').empty();
      showError($comboMessage, xhr);
    }
  }

  async function saveCombo(method, url, payload) {
    if (!user || saving) return;
    saving = true;
    syncButtons();
    $comboMessage.removeClass('text-danger').empty();
    try {
      const saved = await $.ajax({
        url, method, contentType: 'application/json',
        data: payload ? JSON.stringify(payload) : undefined
      });
      setCombo(method === 'DELETE' ? null : saved);
      $comboMessage.text({ POST: 'Đã thêm combo.', PUT: 'Đã cập nhật combo.', DELETE: 'Đã xóa combo.' }[method]);
      await loadCombos();
      await loadInvoices();
    } catch (xhr) {
      showError($comboMessage, xhr);
    } finally {
      saving = false;
      syncButtons();
    }
  }

  $comboForm.on('submit', event => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData($comboForm[0]));
    payload.GiaCombo = payload.GiaCombo === '' ? '' : Number(payload.GiaCombo);
    saveCombo(selectedCombo ? 'PUT' : 'POST',
      selectedCombo ? comboApi + '/' + encodeURIComponent(selectedCombo.MaCombo) : comboApi, payload);
  });

  $comboRows.on('click', 'tr', function () {
    const combo = $(this).data('combo');
    if (saving || !combo) return;
    $comboMessage.empty();
    setCombo(combo);
  });

  $('#clear-combo').on('click', () => {
    $comboMessage.empty();
    setCombo(null);
    $('#combo-id').trigger('focus');
  });

  $deleteCombo.on('click', () => {
    if (selectedCombo && window.confirm('Xóa combo ' + selectedCombo.MaCombo + '?')) {
      saveCombo('DELETE', comboApi + '/' + encodeURIComponent(selectedCombo.MaCombo));
    }
  });

  $('#combo-search').on('input', () => {
    comboVersion++;
    clearTimeout(comboTimer);
    comboTimer = setTimeout(loadComboRows, 250);
  });

  /* ---------- Lập hóa đơn ---------- */

  async function loadCustomers() {
    const version = ++customerVersion;
    const keep = $customer.val();
    try {
      const rows = await $.getJSON('/api/khach-hang', { q: $('#customer-search').val() });
      if (version !== customerVersion) return;
      $customer.empty();
      if (!rows.length) {
        $customer.append($('<option>', { value: '', text: 'Không tìm thấy khách hàng' }));
      } else {
        $customer.append($('<option>', { value: '', text: 'Chọn khách hàng…' }));
        for (const row of rows) {
          $customer.append($('<option>', {
            value: row.MaKhachHang,
            text: row.MaKhachHang + ' · ' + row.TenKhachHang + ' · ' + row.SoDienThoai
          }));
        }
        if (rows.some(row => row.MaKhachHang === keep)) $customer.val(keep);
      }
      syncButtons();
    } catch (xhr) {
      if (version === customerVersion) showError($invoiceMessage, xhr);
    }
  }

  function comboOptions(selected) {
    return combos.map(combo => $('<option>', {
      value: combo.MaCombo,
      text: combo.TenCombo + ' — ' + formatMoney(combo.GiaCombo),
      selected: combo.MaCombo === selected
    }));
  }

  function refreshLineOptions() {
    $lines.find('.line-combo').each(function () {
      const current = $(this).val();
      $(this).empty().append($('<option>', { value: '', text: 'Chọn combo…' }), comboOptions(current));
    });
    updateTotal();
  }

  function addLine() {
    if (!combos.length || $lines.children().length >= 10) return;
    const $select = $('<select>', { class: 'form-select line-combo', 'aria-label': 'Combo' }).append(comboOptions());
    const $quantity = $('<input>', {
      class: 'form-control line-quantity', type: 'number', min: 1, max: 50, value: 1, 'aria-label': 'Số lượng'
    });
    const $remove = $('<button>', {
      type: 'button', class: 'btn btn-outline-secondary btn-sm line-remove', text: 'Bỏ', 'aria-label': 'Bỏ dòng này'
    });
    $lines.append($('<div class="invoice-line">').append($select, $quantity, $remove));
    updateTotal();
    syncButtons();
  }

  function readLines() {
    return $lines.children().map(function () {
      return {
        MaCombo: $(this).find('.line-combo').val(),
        SoLuong: Number($(this).find('.line-quantity').val())
      };
    }).get();
  }

  function updateTotal() {
    const prices = new Map(combos.map(combo => [combo.MaCombo, combo.GiaCombo]));
    const total = readLines().reduce((sum, line) =>
      sum + (Number.isInteger(line.SoLuong) && line.SoLuong > 0 ? (prices.get(line.MaCombo) ?? 0) * line.SoLuong : 0), 0);
    $('#invoice-total').text(formatMoney(total));
  }

  $('#add-line').on('click', addLine);
  $lines.on('change input', '.line-combo, .line-quantity', () => {
    updateTotal();
    syncButtons();
  });
  $lines.on('click', '.line-remove', function () {
    if ($lines.children().length > 1) $(this).closest('.invoice-line').remove();
    updateTotal();
    syncButtons();
  });
  $customer.on('change', syncButtons);
  $('#customer-search').on('input', () => {
    customerVersion++;
    clearTimeout(customerTimer);
    customerTimer = setTimeout(loadCustomers, 250);
  });

  $invoiceForm.on('submit', async event => {
    event.preventDefault();
    if (!user || saving) return;
    const lines = readLines();
    $invoiceMessage.removeClass('text-danger').empty();
    if (!$customer.val()) {
      $invoiceMessage.addClass('text-danger').text('Chọn khách hàng.');
      return;
    }
    if (!lines.length || lines.some(line => !line.MaCombo)) {
      $invoiceMessage.addClass('text-danger').text('Chọn combo cho từng dòng hóa đơn.');
      return;
    }
    if (lines.some(line => !Number.isInteger(line.SoLuong) || line.SoLuong < 1 || line.SoLuong > 50)) {
      $invoiceMessage.addClass('text-danger').text('Số lượng mỗi combo là số nguyên từ 1 đến 50.');
      return;
    }

    saving = true;
    syncButtons();
    try {
      const invoice = await $.ajax({
        url: invoiceApi, method: 'POST', contentType: 'application/json',
        data: JSON.stringify({ MaKhachHang: $customer.val(), ChiTiet: lines })
      });
      $invoiceMessage.text('Đã lưu hóa đơn ' + invoice.MaHoaDon + ' — ' + formatMoney(invoice.TongTien) + '.');
      $lines.empty();
      addLine();
      await loadCombos();
      await loadInvoices();
      renderDetail(invoice);
    } catch (xhr) {
      showError($invoiceMessage, xhr);
    } finally {
      saving = false;
      syncButtons();
    }
  });

  /* ---------- Danh sách và chi tiết hóa đơn ---------- */

  function renderInvoices(rows) {
    $invoiceRows.empty();
    $('#invoice-count').text(rows.length + ' hóa đơn');
    if (!rows.length) emptyRow($invoiceRows, 4, 'Không tìm thấy hóa đơn.');
    for (const row of rows) {
      const active = row.MaHoaDon === selectedInvoice;
      $invoiceRows.append($('<tr>').data('code', row.MaHoaDon).toggleClass('is-selected', active).append(
        $('<td>').append($('<button>', {
          type: 'button', class: 'customer-selector', text: row.MaHoaDon, 'aria-pressed': String(active)
        })),
        $('<td>').text(row.TenKhachHang),
        $('<td>').text(row.NgayMua),
        $('<td class="money">').text(formatMoney(row.TongTien))
      ));
    }
  }

  async function loadInvoices() {
    const version = ++invoiceVersion;
    const params = { q: $('#invoice-search').val(), tuNgay: $('#invoice-from').val(), denNgay: $('#invoice-to').val() };
    try {
      const rows = await $.getJSON(invoiceApi, params);
      if (version === invoiceVersion) renderInvoices(rows);
    } catch (xhr) {
      if (version !== invoiceVersion) return;
      emptyRow($invoiceRows, 4, 'Không tải được hóa đơn.');
      $('#invoice-count').empty();
      showError($invoiceMessage, xhr);
    }
  }

  function renderDetail(invoice) {
    selectedInvoice = invoice?.MaHoaDon ?? null;
    const $detail = $('#invoice-detail').empty();
    $invoiceRows.find('tr').each(function () {
      const active = $(this).data('code') === selectedInvoice;
      $(this).toggleClass('is-selected', active).find('.customer-selector').attr('aria-pressed', String(active));
    });
    syncButtons();
    if (!invoice) {
      $detail.append($('<p class="text-secondary mb-0">').text('Chọn một hóa đơn để xem chi tiết.'));
      return;
    }

    const $meta = $('<dl class="invoice-meta">').append(
      $('<dt>').text('Mã hóa đơn'), $('<dd>').text(invoice.MaHoaDon),
      $('<dt>').text('Khách hàng'), $('<dd>').text(invoice.MaKhachHang + ' · ' + invoice.TenKhachHang),
      $('<dt>').text('Số điện thoại'), $('<dd>').text(invoice.SoDienThoai),
      $('<dt>').text('Ngày mua'), $('<dd>').text(invoice.NgayMua)
    );
    const $body = $('<tbody>');
    for (const line of invoice.ChiTiet) {
      $body.append($('<tr>').append(
        $('<td>').text(line.TenCombo),
        $('<td class="money">').text(formatMoney(line.DonGia)),
        $('<td class="money">').text(line.SoLuong),
        $('<td class="money">').text(formatMoney(line.ThanhTien))
      ));
    }
    const $table = $('<table class="table align-middle mb-0">').append(
      $('<thead>').append($('<tr>').append(
        $('<th scope="col">').text('Combo'),
        $('<th scope="col" class="text-end">').text('Đơn giá'),
        $('<th scope="col" class="text-end">').text('SL'),
        $('<th scope="col" class="text-end">').text('Thành tiền')
      )),
      $body,
      $('<tfoot>').append($('<tr>').append(
        $('<th scope="row" colspan="3">').text('Tổng thanh toán'),
        $('<th class="money">').text(formatMoney(invoice.TongTien))
      ))
    );
    $detail.append($meta, $('<div class="table-responsive">').append($table));
  }

  async function openInvoice(code) {
    const version = ++detailVersion;
    try {
      const invoice = await $.getJSON(invoiceApi + '/' + encodeURIComponent(code));
      if (version === detailVersion) renderDetail(invoice);
    } catch (xhr) {
      if (version === detailVersion) showError($invoiceMessage, xhr);
    }
  }

  $invoiceRows.on('click', 'tr', function () {
    const code = $(this).data('code');
    if (code) {
      $invoiceMessage.empty();
      openInvoice(code);
    }
  });

  $('#invoice-search, #invoice-from, #invoice-to').on('input change', () => {
    invoiceVersion++;
    clearTimeout(invoiceTimer);
    invoiceTimer = setTimeout(loadInvoices, 250);
  });

  $deleteInvoice.on('click', async () => {
    if (!selectedInvoice || saving || !window.confirm('Xóa hóa đơn ' + selectedInvoice + '?')) return;
    saving = true;
    syncButtons();
    try {
      await $.ajax({ url: invoiceApi + '/' + encodeURIComponent(selectedInvoice), method: 'DELETE' });
      detailVersion++;
      renderDetail(null);
      $invoiceMessage.removeClass('text-danger').text('Đã xóa hóa đơn.');
      await loadCombos();
      await loadInvoices();
    } catch (xhr) {
      showError($invoiceMessage, xhr);
    } finally {
      saving = false;
      syncButtons();
    }
  });

  $('#logout-button').on('click', async () => {
    try {
      await $.ajax({ url: '/api/auth/logout', method: 'POST' });
      location.assign('dang-nhap.html');
    } catch (xhr) {
      showError($invoiceMessage, xhr);
    }
  });

  $.getJSON('/api/auth/me').done(async account => {
    user = account;
    $('#account-name').text(user.HoTen + ' · ' +
      (user.VaiTro === 'QuanTriVien' ? 'Quản trị viên' : 'Nhân viên quầy'));
    $('#logout-button').prop('hidden', false);
    $('#customer-search, #combo-search, #invoice-search, #invoice-from, #invoice-to, #invoice-customer')
      .prop('disabled', false);
    await loadCombos();
    syncButtons();
    loadCustomers();
    loadInvoices();
  }).fail(xhr => showError($invoiceMessage, xhr));
})();
