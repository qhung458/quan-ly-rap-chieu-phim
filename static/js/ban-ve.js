/* global jQuery */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  const api = '/api/ban-ve';
  const priceFormat = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
  const statusLabels = { DaDat: 'Đã đặt', DaSuDung: 'Đã sử dụng', DaHuy: 'Đã hủy' };
  const $form = $('#ticket-form');
  const $film = $('#ticket-film');
  const $show = $('#ticket-show');
  const $customer = $('#ticket-customer');
  const $customerSearch = $('#ticket-customer-search');
  const $seatMap = $('#seat-map');
  const $ticketRows = $('#ticket-rows');
  const $search = $('#ticket-search');
  const $message = $('#ticket-message');

  let ready = false;
  let loading = false;
  let saving = false;
  let showRequest = 0;
  let shows = [];
  let show = null;
  let seats = [];
  let tickets = [];
  let customers = [];
  let selectedSeat = null;
  let selectedTicket = null;
  let moving = false;
  let ticketQuery = '';
  let customerQuery = '';

  function showMessage(message, isError = false) {
    $message.toggleClass('text-danger', isError).text(message);
  }

  function showError(xhr) {
    if (xhr?.status === 401) {
      location.assign('dang-nhap.html');
      return;
    }
    showMessage(xhr?.responseJSON?.message || 'Không kết nối được máy chủ.', true);
  }

  function seatLabel(item) {
    return item ? item.SoHang + item.SoGhe : '';
  }

  function ticketKey(ticket) {
    return JSON.stringify([ticket.MaVe, ticket.MaSuatChieu, ticket.MaKhachHang, ticket.MaGhe]);
  }

  function ticketReference(ticket) {
    const { MaVe, MaSuatChieu, MaKhachHang, MaGhe } = ticket;
    return { MaVe, MaSuatChieu, MaKhachHang, MaGhe };
  }

  function normalizeCustomerSearch(text) {
    return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').trim();
  }

  function customerOption({ MaKhachHang, TenKhachHang, SoDienThoai }) {
    return $('<option>', {
      value: MaKhachHang,
      text: [MaKhachHang, TenKhachHang, SoDienThoai].filter(Boolean).join(' - ')
    })[0];
  }

  function renderCustomerOptions(selectedCode = $customer.val()) {
    const query = normalizeCustomerSearch($customerSearch.val());
    const terms = query.split(/\s+/).filter(Boolean);
    const phoneQuery = /^[\d+().\s-]+$/.test(query) ? query.replace(/\D/g, '') : '';
    const matches = customers.filter(customer => {
      if (phoneQuery) return customer.phoneDigits.includes(phoneQuery) || customer.searchText.includes(query);
      return terms.every(term => customer.searchText.includes(term));
    });
    const options = matches.map(customerOption);

    if (selectedTicket && !matches.some(customer => customer.MaKhachHang === selectedCode)) {
      options.push(customerOption(selectedTicket));
    }

    $customer.empty().append($('<option>', { value: '', text: 'Chọn khách hàng' }), options).val(selectedCode);
    if ($customer.val() == null) $customer.val('');
    $('#ticket-customer-search-status').text(terms.length
      ? (matches.length ? matches.length + ' khách hàng phù hợp' : 'Không tìm thấy khách hàng.') : '');
  }

  function resetCustomerPicker() {
    $customerSearch.val('');
    renderCustomerOptions(selectedTicket?.MaKhachHang ?? '');
  }

  function feedbackForShow() {
    if (!show) return;
    if (moving && !show.CoTheBan) {
      showMessage('Chọn một suất còn mở bán để đổi vé.', true);
    } else if (moving) {
      showMessage('Chọn ghế mới, hoặc chọn phim và suất khác, rồi bấm Lưu đổi.');
    } else if (selectedTicket?.TrangThai === 'DaDat' && !show.CoTheHuyDoi) {
      showMessage('Chỉ hủy hoặc đổi vé khi còn ít nhất ' + show.PhutNgungHuy + ' phút trước giờ chiếu.');
    } else if (selectedTicket) {
      showMessage('');
    } else if (!show.CoTheBan) {
      const message = show.TrangThai === 'SapChieu'
        ? 'Suất này đã ngừng bán. Chỉ bán vé khi còn ít nhất ' + show.PhutNgungBan + ' phút trước giờ chiếu.'
        : 'Suất chiếu này không mở bán vé.';
      showMessage(message);
    } else {
      showMessage('');
    }
  }

  function renderSeatMap(message) {
    $seatMap.empty();
    if (message || !seats.length) {
      $seatMap.append($('<p>', { class: 'small text-secondary', text: message || 'Phòng này chưa có ghế.' }));
      return;
    }

    const rows = new Map();
    const numbers = [...new Set(seats.map(seat => seat.SoGhe))].sort((a, b) => a - b);
    const columns = new Map(numbers.map((number, index) => [number, index + 2]));
    $seatMap[0].style.setProperty('--seat-columns', numbers.length);

    for (const seat of seats) {
      if (!rows.has(seat.SoHang)) {
        const row = rows.size + 1;
        rows.set(seat.SoHang, row);
        $seatMap.append($('<span>', {
          class: 'seat-row-label', text: seat.SoHang, 'aria-hidden': 'true'
        }).css({ gridColumn: '1', gridRow: String(row) }));
      }
      const vip = String(seat.LoaiGhe).toUpperCase() === 'VIP';
      $seatMap.append($('<button>', { type: 'button', class: 'seat-button', text: seat.SoGhe })
        .toggleClass('is-vip', vip)
        .css({ gridColumn: String(columns.get(seat.SoGhe)), gridRow: String(rows.get(seat.SoHang)) })
        .data('seat', seat));
    }
  }

  function renderSelection() {
    const active = ready && Boolean(show) && !loading && !saving;
    const viewing = Boolean(selectedTicket) && !moving;
    const canChooseSeat = active && Boolean(show?.CoTheBan);
    const canChange = active && viewing && selectedTicket.TrangThai === 'DaDat' && show.CoTheHuyDoi;
    const viewedSeat = viewing && selectedTicket.TrangThai !== 'DaHuy' ? selectedTicket : null;
    const selection = viewedSeat || selectedSeat;
    const price = viewing || (moving && selectedTicket.MaSuatChieu === show?.MaSuatChieu)
      ? selectedTicket.GiaVe : show?.GiaVe;
    const pickedShow = show ?? shows.find(item => item.MaSuatChieu === $show.val());

    $('#ticket-room').val(pickedShow ? pickedShow.MaPhong + ' - ' + pickedShow.TenPhong : '');
    $('#seat-show').text(show ? '– ' + show.TenPhim + ' · ' + show.TenPhong + ' · ' + show.BatDau : '');
    $seatMap.find('.seat-button').each(function () {
      const $button = $(this);
      const seat = $button.data('seat');
      const isOccupied = Boolean(seat.DaCoVe);
      const isSelected = seat.MaGhe === selection?.MaGhe;
      const name = 'Ghế ' + seatLabel(seat) + ($button.hasClass('is-vip') ? ', VIP' : '');
      $button.toggleClass('is-occupied', isOccupied)
        .toggleClass('is-selected', isSelected)
        .prop('disabled', !canChooseSeat || isOccupied)
        .attr('aria-pressed', String(isSelected))
        .attr('aria-label', name + (isOccupied ? ', đã có vé' : ', trống'));
    });

    $film.prop('disabled', !ready || saving || !shows.length);
    $show.prop('disabled', !ready || saving || !$film.val());
    $customer.add($customerSearch).prop('disabled', !active || Boolean(selectedTicket) || !show.CoTheBan);
    if (selectedTicket) $customer.val(selectedTicket.MaKhachHang);
    const customerCode = $customer.val();
    $('#ticket-id').val(selectedTicket?.MaVe ?? '');
    $('#ticket-seat').val(seatLabel(viewing ? selectedTicket : selectedSeat));
    $('#ticket-date').val(selectedTicket?.NgayDat ?? '');
    $('#ticket-price').val(price == null ? '' : priceFormat.format(price));
    $('#ticket-status').val(selectedTicket ? statusLabels[selectedTicket.TrangThai] : '');
    $('#save-ticket').text(moving ? 'Lưu đổi' : 'Lưu vé')
      .prop('disabled', !active || !show.CoTheBan || viewing || !selectedSeat || !(customerCode || moving));
    $('#move-ticket, #cancel-ticket').prop('disabled', !canChange);
    $('#clear-ticket').text(moving ? 'Bỏ đổi' : 'Làm mới')
      .prop('disabled', !ready || saving || (!moving && !$show.val()));
    $('#logout-button').prop('disabled', saving);
    $search.find(':input').prop('disabled', !active);

    const selectedKey = selectedTicket && ticketKey(selectedTicket);
    $ticketRows.find('[data-ticket-id]').each(function () {
      const $row = $(this);
      const isSelected = ticketKey($row.data('ticket')) === selectedKey;
      $row.toggleClass('is-selected', isSelected).find('.ticket-selector')
        .attr('aria-pressed', String(isSelected)).prop('disabled', saving || moving);
    });
  }

  function emptyTickets(message) {
    $ticketRows.empty().append($('<tr>').append($('<td>', { colspan: 7, text: message })));
  }

  function matchesSearch(ticket) {
    return ticket.MaVe.toUpperCase().includes(ticketQuery)
      && ticket.MaKhachHang.toUpperCase().includes(customerQuery);
  }

  function renderTickets() {
    const matches = tickets.filter(matchesSearch);
    $('#ticket-count').text(matches.length + '/' + tickets.length + ' vé');
    $ticketRows.empty();
    if (!matches.length) {
      emptyTickets(tickets.length ? 'Không tìm thấy vé phù hợp.' : 'Suất chiếu này chưa có vé.');
      return;
    }

    for (const ticket of matches) {
      const $button = $('<button>', {
        type: 'button', class: 'btn btn-link p-0 ticket-selector', text: ticket.MaVe
      });
      const $row = $('<tr>', { 'data-ticket-id': ticket.MaVe }).data('ticket', ticket)
        .append($('<td>').append($button));
      $row.append(
        $('<td>').text(ticket.MaKhachHang),
        $('<td>').text(ticket.TenKhachHang),
        $('<td>').text(seatLabel(ticket) + ' - ' + ticket.MaGhe),
        $('<td>').text(ticket.NgayDat),
        $('<td>').text(priceFormat.format(ticket.GiaVe)),
        $('<td>').text(statusLabels[ticket.TrangThai] ?? ticket.TrangThai)
      );
      $ticketRows.append($row);
    }
  }

  function clearSelection() {
    selectedTicket = null;
    selectedSeat = null;
    moving = false;
    resetCustomerPicker();
  }

  function clearSearch() {
    $search[0].reset();
    ticketQuery = '';
    customerQuery = '';
  }

  function renderShowOptions() {
    const filmCode = $film.val();
    $show.empty().append($('<option>', { value: '', text: filmCode ? 'Chọn suất chiếu' : 'Chọn phim trước' }));
    for (const item of shows.filter(item => item.MaPhim === filmCode)) {
      $show.append($('<option>', {
        value: item.MaSuatChieu, text: item.MaSuatChieu + ' - ' + item.BatDau
      }));
    }
  }

  function clearShowDetails(seatMessage, ticketMessage) {
    show = null;
    seats = [];
    tickets = [];
    $('#ticket-count').empty();
    renderSeatMap(seatMessage);
    emptyTickets(ticketMessage);
    renderSelection();
  }

  function showSelectionPrompt() {
    ++showRequest;
    loading = false;
    let message = 'Chọn phim rồi chọn suất chiếu.';
    if (!shows.length) message = 'Không có suất chiếu đang mở bán.';
    else if ($film.val()) message = 'Chọn suất chiếu để xem ghế và vé.';
    clearShowDetails(message, message);
    showMessage('');
  }

  async function loadShow(code, keepFeedback = false) {
    const request = ++showRequest;
    loading = true;
    clearShowDetails('Đang tải sơ đồ ghế…', 'Đang tải vé…');
    if (!keepFeedback) showMessage('');

    try {
      const detail = await $.getJSON(api + '/suat-chieu/' + encodeURIComponent(code));
      if (request !== showRequest) return;

      show = detail.suatChieu;
      seats = detail.ghe;
      tickets = detail.ve;
      if (selectedTicket && !moving) {
        const key = ticketKey(selectedTicket);
        selectedTicket = tickets.find(ticket => ticketKey(ticket) === key) ?? null;
      }
      if (selectedSeat) {
        const code = selectedSeat.MaGhe;
        selectedSeat = seats.find(seat => seat.MaGhe === code && !seat.DaCoVe) ?? null;
      }

      renderSeatMap();
      renderTickets();
      if (!keepFeedback) feedbackForShow();
    } catch (xhr) {
      if (request !== showRequest) return;
      renderSeatMap('Không tải được sơ đồ ghế.');
      emptyTickets('Không tải được vé.');
      showError(xhr);
    } finally {
      if (request === showRequest) {
        loading = false;
        renderSelection();
      }
    }
  }

  async function changeTicket(method, path, payload, message) {
    if (saving || loading || !show) return;
    saving = true;
    showMessage('');
    renderSelection();
    let saved = false;
    try {
      selectedTicket = await $.ajax({
        url: api + path, method, contentType: 'application/json', data: JSON.stringify(payload)
      });
      moving = false;
      selectedSeat = null;
      resetCustomerPicker();
      clearSearch();
      saved = true;
      showMessage(message + ' ' + selectedTicket.MaVe + '.');
      await loadShow(selectedTicket.MaSuatChieu, true);
    } catch (xhr) {
      if (xhr?.status === 409 || xhr?.status === 404) await loadShow($show.val(), true);
      showError(xhr);
    } finally {
      saving = false;
      renderSelection();
      if (saved) $('#clear-ticket').trigger('focus');
    }
  }

  function selectShow(code) {
    if (moving) selectedSeat = null;
    else clearSelection();
    clearSearch();
    if (code) loadShow(code);
    else showSelectionPrompt();
  }

  $film.on('change', () => {
    if (saving) return;
    renderShowOptions();
    selectShow('');
  });

  $show.on('change', function () {
    if (!saving) selectShow(this.value);
  });

  $customer.on('change', renderSelection);

  $customerSearch.on('input', () => {
    renderCustomerOptions();
    renderSelection();
  }).on('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.originalEvent?.isComposing) return;
    const matches = $customer.find('option').not('[value=""]');
    if (matches.length === 1) $customer.val(matches[0].value).trigger('change');
    if (matches.length) $customer.trigger('focus');
  });

  $seatMap.on('click', '.seat-button', function () {
    if (saving || loading || !show?.CoTheBan) return;
    const seat = $(this).data('seat');
    if (seat.DaCoVe) return;
    if (selectedTicket && !moving) clearSelection();
    selectedSeat = selectedSeat?.MaGhe === seat.MaGhe ? null : seat;
    renderSelection();
    feedbackForShow();
  });

  $ticketRows.on('click', '[data-ticket-id]', function () {
    if (saving || loading || moving) return;
    selectedTicket = $(this).data('ticket');
    selectedSeat = null;
    resetCustomerPicker();
    renderSelection();
    feedbackForShow();
  });

  $('#clear-ticket').on('click', () => {
    if (saving) return;
    clearSelection();
    if ($show.val()) {
      loadShow($show.val());
      $show.trigger('focus');
    } else {
      showSelectionPrompt();
      ($film.val() ? $show : $film).trigger('focus');
    }
  });

  $('#move-ticket').on('click', () => {
    if (saving || loading || !show?.CoTheHuyDoi || selectedTicket?.TrangThai !== 'DaDat') return;
    moving = true;
    selectedSeat = null;
    renderSelection();
    feedbackForShow();
    $show.trigger('focus');
  });

  $form.on('submit', event => {
    event.preventDefault();
    if (saving || loading || !show?.CoTheBan || !selectedSeat || (selectedTicket && !moving)) return;
    const payload = { MaSuatChieu: show.MaSuatChieu, MaGhe: selectedSeat.MaGhe };
    if (moving) {
      changeTicket('PUT', '/doi', { ...payload, Ve: ticketReference(selectedTicket) }, 'Đã đổi vé');
    } else if ($customer.val()) {
      changeTicket('POST', '', { ...payload, MaKhachHang: $customer.val() }, 'Đã lưu vé');
    }
  });

  $('#cancel-ticket').on('click', () => {
    if (saving || loading || moving || !show?.CoTheHuyDoi || selectedTicket?.TrangThai !== 'DaDat') return;
    if (!window.confirm('Hủy vé ' + selectedTicket.MaVe + '?')) return;
    changeTicket('PUT', '/huy', { Ve: ticketReference(selectedTicket) }, 'Đã hủy vé');
  });

  $search.on('submit', event => {
    event.preventDefault();
    ticketQuery = $('#search-ticket-id').val().trim().toUpperCase();
    customerQuery = $('#search-customer-id').val().trim().toUpperCase();
    if (selectedTicket && !moving && !matchesSearch(selectedTicket)) {
      clearSelection();
      feedbackForShow();
    }
    renderTickets();
    renderSelection();
  });

  $('#clear-search').on('click', () => {
    clearSearch();
    renderTickets();
    renderSelection();
    $('#search-ticket-id').trigger('focus');
  });

  $('#logout-button').on('click', async () => {
    if (saving) return;
    saving = true;
    renderSelection();
    try {
      await $.ajax({ url: '/api/auth/logout', method: 'POST' });
      location.assign('dang-nhap.html');
    } catch (xhr) {
      saving = false;
      renderSelection();
      showError(xhr);
    }
  });

  async function initialize() {
    emptyTickets('Đang tải suất chiếu…');
    renderSeatMap('Đang tải suất chiếu…');
    try {
      const [user, showRows, customerRows] = await Promise.all([
        $.getJSON('/api/auth/me'), $.getJSON(api + '/suat-chieu'), $.getJSON(api + '/khach-hang')
      ]);
      $('#account-name').text(user.HoTen + ' · ' +
        (user.VaiTro === 'QuanTriVien' ? 'Quản trị viên' : 'Nhân viên quầy'));
      $('#logout-button').prop('hidden', false);
      shows = showRows;
      const filmNames = new Map(shows.map(({ MaPhim, TenPhim }) => [MaPhim, TenPhim]));
      const films = [...filmNames].sort((a, b) => a[1].localeCompare(b[1], 'vi'));
      for (const [code, title] of films) {
        $film.append($('<option>', { value: code, text: title }));
      }
      customers = customerRows.map(customer => ({
        ...customer,
        searchText: normalizeCustomerSearch([customer.MaKhachHang, customer.TenKhachHang, customer.SoDienThoai].join(' ')),
        phoneDigits: (customer.SoDienThoai ?? '').replace(/\D/g, '')
      }));
      resetCustomerPicker();
      ready = true;
      showSelectionPrompt();
    } catch (xhr) {
      emptyTickets('Không tải được dữ liệu bán vé.');
      renderSeatMap('Không tải được sơ đồ ghế.');
      showError(xhr);
    }
  }

  initialize();
})();
