/* global jQuery, ListQuery, ExcelExport */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  const comboApi = '/api/bap-nuoc';
  const invoiceApi = '/api/hoa-don';
  const customerApi = '/api/khach-hang/tuy-chon';
  const customerPageSize = 20;
  const money = new Intl.NumberFormat('vi-VN');
  const formatMoney = value => money.format(value) + ' ₫';
  const $comboRows = $('#combo-rows');
  const $invoiceRows = $('#invoice-rows');
  const $comboForm = $('#combo-form');
  const $comboMessage = $('#combo-message');
  const $invoiceForm = $('#invoice-form');
  const $invoiceMessage = $('#invoice-message');
  const $customer = $('#invoice-customer');
  const $customerSearch = $('#customer-search');
  const $customerMessage = $('#customer-lookup-message');
  const $customerMore = $('#customer-more');
  const $comboFilter = $('#invoice-combo-filter');
  const $lines = $('#invoice-lines');
  const $deleteCombo = $('#delete-combo');
  const $deleteInvoice = $('#delete-invoice');
  let user;
  let combos = [];
  let selectedCombo = null;
  let selectedInvoice = null;
  let saving = false;
  let comboOptionsVersion = 0;
  let customerVersion = 0;
  let customerRows = [];
  let selectedCustomer = null;
  let customerPage = 0;
  let customerTotal = 0;
  let customerLoading = false;
  let detailVersion = 0;
  let detailLoading = false;
  let customerTimer;

  const enableInvoiceExport = ExcelExport.bind('invoice-detail-export', () => {
    const invoice = selectedInvoice;
    return {
      filename: 'hoa-don-' + invoice.MaHoaDon,
      sheets: [{
        name: 'Hóa đơn',
        columns: [['Mã hóa đơn', 18], ['Mã khách', 16], ['Khách hàng', 28], ['Số điện thoại', 18],
          ['Ngày mua', 22, ExcelExport.dateTime], ['Tổng số lượng', 16, ExcelExport.integer],
          ['Tổng thanh toán', 20, ExcelExport.money]],
        rows: [[invoice.MaHoaDon, invoice.MaKhachHang, invoice.TenKhachHang, invoice.SoDienThoai,
          ExcelExport.asDate(invoice.NgayMua), invoice.SoLuong, invoice.TongTien]]
      }, {
        name: 'Chi tiết combo',
        columns: [['Mã combo', 16], ['Combo', 32], ['Đơn giá', 18, ExcelExport.money],
          ['Số lượng', 14, ExcelExport.integer], ['Thành tiền', 20, ExcelExport.money]],
        rows: invoice.ChiTiet.map(line => [line.MaCombo, line.TenCombo, line.DonGia, line.SoLuong, line.ThanhTien])
      }]
    };
  });

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

  function bindList({ id, api, filename, defaultSort, pageSize, $rows, columns, noun, rowRenderer, labels }) {
    const $form = $('#' + id + '-query');
    const fields = $form.find('[name]').toArray();
    const $main = $form.find('[data-sort-main]');
    const $mainDir = $form.find('[data-sort-main-dir]');
    const $extra = $form.find('[data-sort-extra]');
    const $extraDir = $form.find('[data-sort-extra-dir]');
    const $chips = $form.find('[data-query-conditions]');
    const $count = $('#' + id + '-count');
    const $pagination = $('#' + id + '-pagination');
    const $prev = $pagination.find('[data-page-prev]');
    const $next = $pagination.find('[data-page-next]');
    const sortLabels = new Map($main.find('option').toArray().map(option => [option.value, option.text]));
    $extra.append($main.find('option').clone());

    const enableExport = ExcelExport.bindDownload(id + '-export', () => ({
      url: api + '/xuat', filename, snapshotId: controller.getSnapshotId()
    }));
    const controller = ListQuery.create({
      defaults: { sort: defaultSort }, pageSize, load: ListQuery.loadFrom(api), onChange: render
    });

    function syncSortControls() {
      const primary = $main.val();
      if ($extra.val() === primary) $extra.val('');
      $extra.find('option').each(function () { this.disabled = this.value === primary; });
      $extraDir.prop('disabled', !$extra.val());
    }

    function writeDraft(query) {
      for (const field of fields) {
        $(field).val(query[field.name] ?? (field.multiple ? [] : ''));
      }
      const [main, extra = ''] = (query.sort || defaultSort).split(',');
      const [mainField, mainDir] = main.split(':');
      const [extraField, extraDir = 'asc'] = extra.split(':');
      $main.val(mainField);
      $mainDir.val(mainDir);
      $extra.val(extraField);
      $extraDir.val(extraDir);
      syncSortControls();
    }

    function readDraft() {
      const query = Object.fromEntries(fields.map(field => [field.name, $(field).val() ?? '']));
      const order = [$main.val() + ':' + $mainDir.val()];
      if ($extra.val()) order.push($extra.val() + ':' + $extraDir.val());
      return { ...query, sort: order.join(',') };
    }

    function chipText(name, value) {
      if (name === 'sort') {
        return value.split(',').map(order => {
          const [key, direction] = order.split(':');
          return sortLabels.get(key) + (direction === 'desc' ? ' giảm' : ' tăng');
        }).join(', rồi ');
      }
      const display = id === 'invoice' && name === 'maCombo'
        ? combos.find(combo => combo.MaCombo === value)?.TenCombo ?? value
        : value;
      return labels[name] + ' · ' + display;
    }

    function renderChips(applied) {
      $chips.empty();
      for (const [name, selection] of Object.entries(applied)) {
        if (!selection || (name === 'sort' && selection === defaultSort)) continue;
        for (const value of Array.isArray(selection) ? selection : [selection]) {
          const label = chipText(name, value);
          const $chip = $('<button>', {
            type: 'button', class: 'btn btn-outline-secondary btn-sm query-chip',
            text: label + ' ×', 'aria-label': 'Bỏ điều kiện ' + label
          }).on('click', () => {
            controller.setDraft(readDraft());
            controller.remove(name, value);
            writeDraft(controller.getState().draft);
            $form.find('button[type="submit"]').trigger('focus');
          });
          $chips.append($('<li>').append($chip));
        }
      }
      $chips.prop('hidden', !$chips.children().length);
    }

    function render(state) {
      const ready = state.status === 'ready';
      enableExport(ready && Boolean(state.snapshotId));
      renderChips(state.applied);
      $rows.closest('table').attr('aria-busy', String(state.status === 'loading'));
      $count.text(ready || state.status === 'empty' ? `${state.total} ${noun}` : '');
      if (ready) rowRenderer(state.items);
      if (state.status === 'loading') emptyRow($rows, columns, `Đang tải ${noun}…`);
      if (state.status === 'empty') emptyRow($rows, columns, `Không tìm thấy ${noun} phù hợp.`);
      if (state.status === 'error') {
        if (state.error.status === 401) {
          location.assign('dang-nhap.html');
          return;
        }
        emptyRow($rows, columns, state.error.message);
      }
      if ($pagination.length) {
        const pages = Math.ceil(state.total / state.pageSize);
        $pagination.prop('hidden', pages <= 1);
        $prev.prop('disabled', !ready || state.page <= 1);
        $next.prop('disabled', !ready || state.page >= pages);
        $pagination.find('[data-page-position]').text(pages > 1 ? `Trang ${state.page} / ${pages}` : '');
      }
    }

    $main.add($extra).on('change', syncSortControls);
    $form.on('submit', event => {
      event.preventDefault();
      if (!user) return;
      controller.setDraft(readDraft());
      controller.apply();
    });
    $form.find('[data-query-reset]').on('click', () => {
      controller.reset();
      writeDraft(controller.getState().draft);
    });
    $form.find('[data-query-refresh]').on('click', () => controller.refresh());
    $prev.on('click', () => controller.goToPage(controller.getState().page - 1));
    $next.on('click', () => controller.goToPage(controller.getState().page + 1));
    writeDraft(controller.getState().draft);
    return controller;
  }

  const comboList = bindList({
    id: 'combo', api: comboApi, filename: 'danh-muc-combo', defaultSort: 'maCombo:asc', pageSize: null,
    $rows: $comboRows, columns: 4, noun: 'combo', rowRenderer: renderCombos,
    labels: { q: 'Từ khóa', maCombo: 'Mã combo', ten: 'Tên combo', moTa: 'Mô tả',
      giaMin: 'Giá từ', giaMax: 'Giá đến', daBanMin: 'Đã bán từ', daBanMax: 'Đã bán đến' }
  });
  const invoiceList = bindList({
    id: 'invoice', api: invoiceApi, filename: 'hoa-don', defaultSort: 'ngayMua:desc,maHoaDon:desc',
    $rows: $invoiceRows, columns: 5, noun: 'hóa đơn', rowRenderer: renderInvoices,
    labels: { q: 'Từ khóa', maHoaDon: 'Mã hóa đơn', maKhachHang: 'Mã khách', tenKhachHang: 'Tên khách',
      soDienThoai: 'SĐT', tuNgay: 'Từ ngày', denNgay: 'Đến ngày', tongMin: 'Tổng tiền từ',
      tongMax: 'Tổng tiền đến', maCombo: 'Có combo' }
  });

  function syncButtons() {
    const admin = user?.VaiTro === 'QuanTriVien';
    $comboForm.find('button[value="them"]').prop('disabled', !user || saving || Boolean(selectedCombo));
    $comboForm.find('button[value="sua"]').prop('disabled', saving || !selectedCombo);
    $deleteCombo.prop('disabled', saving || !selectedCombo || !admin);
    $('#clear-combo').prop('disabled', !user || saving);
    $('#add-line').prop('disabled', !user || saving || !combos.length || $lines.children().length >= 10);
    $('#invoice-submit').prop('disabled', !user || saving || !$customer.val() ||
      !$lines.children().length || $lines.find('.line-combo').toArray().some(select => !select.value));
    $deleteInvoice.prop('hidden', !selectedInvoice || !admin).prop('disabled', saving || detailLoading);
    enableInvoiceExport(Boolean(user && selectedInvoice && !saving && !detailLoading));
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

  async function loadComboOptions() {
    const version = ++comboOptionsVersion;
    try {
      const options = await $.ajax({ url: comboApi + '/tuy-chon', dataType: 'json', cache: false });
      if (version !== comboOptionsVersion) return;
      combos = options;
      const selected = $comboFilter.val();
      $comboFilter.empty().append(combos.map(combo => $('<option>', {
        value: combo.MaCombo, text: combo.MaCombo + ' · ' + combo.TenCombo
      }))).val(selected);
      refreshLineOptions();
      if (!$lines.children().length) addLine();
      syncButtons();
    } catch (xhr) {
      if (version === comboOptionsVersion) showError($invoiceMessage, xhr);
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
      await Promise.all([loadComboOptions(), comboList.refresh(), invoiceList.refresh()]);
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

  /* ---------- Lập hóa đơn ---------- */

  function renderCustomers() {
    const selectedCode = selectedCustomer?.MaKhachHang ?? '';
    const rows = customerRows.some(row => row.MaKhachHang === selectedCode) || !selectedCustomer
      ? customerRows : [selectedCustomer, ...customerRows];
    $customer.empty().append($('<option>', { value: '', text: 'Chọn khách hàng…' }));
    for (const row of rows) {
      $customer.append($('<option>', {
        value: row.MaKhachHang,
        text: row.MaKhachHang + ' · ' + row.TenKhachHang + ' · ' + row.SoDienThoai
      }));
    }
    $customer.val(selectedCode);
    syncButtons();
  }

  function setCustomerPaging() {
    const hasMore = customerPage * customerPageSize < customerTotal;
    $customerMore.prop({ hidden: !hasMore, disabled: customerLoading });
  }

  async function loadCustomers(page = 1) {
    const version = ++customerVersion;
    customerLoading = true;
    $customerMessage.removeClass('text-danger').addClass('text-secondary').text('Đang tìm khách hàng…');
    setCustomerPaging();
    try {
      const result = await $.getJSON(customerApi, { q: $customerSearch.val(), page, pageSize: customerPageSize });
      if (version !== customerVersion) return;
      const customers = new Map((page === 1 ? [] : customerRows).map(row => [row.MaKhachHang, row]));
      result.items.forEach(row => customers.set(row.MaKhachHang, row));
      customerRows = [...customers.values()];
      customerPage = result.page;
      customerTotal = result.total;
      if (selectedCustomer && customers.has(selectedCustomer.MaKhachHang)) {
        selectedCustomer = customers.get(selectedCustomer.MaKhachHang);
      }
      renderCustomers();
      $customerMessage.text(customerTotal ? `${customerRows.length} / ${customerTotal} khách phù hợp` : 'Không tìm thấy khách phù hợp.');
    } catch (xhr) {
      if (version === customerVersion) showError($customerMessage.removeClass('text-secondary'), xhr);
    } finally {
      if (version === customerVersion) {
        customerLoading = false;
        setCustomerPaging();
      }
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
      if (!combos.some(combo => combo.MaCombo === current)) $(this).val('');
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
  $customer.on('change', () => {
    const code = $customer.val();
    selectedCustomer = customerRows.find(row => row.MaKhachHang === code) ??
      (selectedCustomer?.MaKhachHang === code ? selectedCustomer : null);
    syncButtons();
  });
  $customerMore.on('click', () => { if (!customerLoading) loadCustomers(customerPage + 1); });
  $customerSearch.on('input', () => {
    customerVersion++;
    clearTimeout(customerTimer);
    customerPage = 0;
    customerTotal = 0;
    customerRows = [];
    renderCustomers();
    setCustomerPaging();
    $customerMessage.removeClass('text-danger').addClass('text-secondary').text('Đang tìm khách hàng…');
    customerTimer = setTimeout(() => loadCustomers(), 250);
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
      detailVersion++;
      detailLoading = false;
      renderDetail(invoice);
      $invoiceMessage.text('Đã lưu hóa đơn ' + invoice.MaHoaDon + ' — ' + formatMoney(invoice.TongTien) + '.');
      $lines.empty();
      addLine();
      await Promise.all([comboList.refresh(), invoiceList.refresh()]);
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
    for (const row of rows) {
      const active = row.MaHoaDon === selectedInvoice?.MaHoaDon;
      $invoiceRows.append($('<tr>').data('code', row.MaHoaDon).toggleClass('is-selected', active).append(
        $('<td>').append($('<button>', {
          type: 'button', class: 'customer-selector', text: row.MaHoaDon, 'aria-pressed': String(active)
        })),
        $('<td>').text(row.TenKhachHang),
        $('<td>').text(row.NgayMua),
        $('<td class="money">').text(row.SoLuong),
        $('<td class="money">').text(formatMoney(row.TongTien))
      ));
    }
  }

  function renderDetail(invoice, message = 'Chọn một hóa đơn để xem chi tiết.') {
    selectedInvoice = invoice;
    const $detail = $('#invoice-detail').empty();
    $invoiceRows.find('tr').each(function () {
      const active = $(this).data('code') === selectedInvoice?.MaHoaDon;
      $(this).toggleClass('is-selected', active).find('.customer-selector').attr('aria-pressed', String(active));
    });
    syncButtons();
    if (!invoice) {
      $detail.append($('<p class="text-secondary mb-0">').text(message));
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
    detailLoading = true;
    renderDetail(null, 'Đang tải chi tiết hóa đơn…');
    try {
      const invoice = await $.getJSON(invoiceApi + '/' + encodeURIComponent(code));
      if (version === detailVersion) renderDetail(invoice);
    } catch (xhr) {
      if (version === detailVersion) {
        renderDetail(null, 'Không tải được chi tiết hóa đơn.');
        showError($invoiceMessage, xhr);
      }
    } finally {
      if (version === detailVersion) {
        detailLoading = false;
        syncButtons();
      }
    }
  }

  $invoiceRows.on('click', 'tr', function () {
    const code = $(this).data('code');
    if (code && !saving) {
      $invoiceMessage.removeClass('text-danger').empty();
      openInvoice(code);
    }
  });

  $deleteInvoice.on('click', async () => {
    const code = selectedInvoice?.MaHoaDon;
    if (!code || saving || detailLoading || !window.confirm('Xóa hóa đơn ' + code + '?')) return;
    saving = true;
    syncButtons();
    try {
      await $.ajax({ url: invoiceApi + '/' + encodeURIComponent(code), method: 'DELETE' });
      detailVersion++;
      renderDetail(null);
      $invoiceMessage.removeClass('text-danger').text('Đã xóa hóa đơn.');
      await Promise.all([comboList.refresh(), invoiceList.refresh()]);
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

  $.getJSON('/api/auth/me').done(account => {
    user = account;
    $('#account-name').text(user.HoTen + ' · ' +
      (user.VaiTro === 'QuanTriVien' ? 'Quản trị viên' : 'Nhân viên quầy'));
    $('#logout-button').prop('hidden', false);
    $('#customer-search, #invoice-customer, #combo-query fieldset, #invoice-query fieldset').prop('disabled', false);
    syncButtons();
    renderCustomers();
    loadComboOptions();
    loadCustomers();
    comboList.refresh();
    invoiceList.refresh();
  }).fail(xhr => showError($invoiceMessage, xhr));
})();
