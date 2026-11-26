/* global jQuery, ListQuery, ShowTicketList, ExcelExport */
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
  const $customerMessage = $('#ticket-customer-search-status');
  const $customerMore = $('#ticket-customer-more');
  const $seatMap = $('#seat-map');
  const $seatAvailability = $('#seat-availability');
  const $message = $('#ticket-message');
  const ticketList = ShowTicketList.mount(document.getElementById('ticket-list-content'), { onSelect: selectTicket });
  const lookupCustomers = ListQuery.loadFrom('/api/khach-hang/tuy-chon');
  const customerPageSize = 20;

  let ready = false;
  let loading = false;
  let saving = false;
  let showRequest = 0;
  let shows = [];
  let show = null;
  let seats = [];
  let customers = [];
  let saleCustomer = null;
  let customerPage = 0;
  let customerTotal = 0;
  let customerTimer;
  let customerRequest;
  let customerError = '';
  let pickCustomerOnLoad = false;
  let selectedSeat = null;
  let selectedSeats = [];
  let selectedTicket = null;
  let lastSale = null;
  let ticketRequest;
  let moving = false;

  const enableTicketExport = ExcelExport.bind('export-ticket', () => {
    const source = selectedTicket ? { tickets: [selectedTicket], show } : lastSale;
    const { tickets, show: screening } = source;
    const first = tickets[0].MaVe;
    const last = tickets.at(-1).MaVe;
    return {
      filename: 've-' + (tickets.length > 1 ? `${first}-${last}` : first),
      sheets: [{
        name: 'Vé xem phim',
        columns: [['Mã vé', 16], ['Phim', 32], ['Mã suất chiếu', 20], ['Bắt đầu', 22, ExcelExport.dateTime],
          ['Phòng', 20], ['Ghế', 12], ['Mã khách', 16], ['Khách hàng', 28], ['Ngày đặt', 22, ExcelExport.dateTime],
          ['Giá vé', 18, ExcelExport.money], ['Trạng thái', 18]],
        rows: tickets.map(ticket => [ticket.MaVe, screening.TenPhim, ticket.MaSuatChieu,
          ExcelExport.asDate(screening.BatDau), screening.TenPhong, seatLabel(ticket), ticket.MaKhachHang,
          ticket.TenKhachHang, ExcelExport.asDate(ticket.NgayDat), Number(ticket.GiaVe), statusLabels[ticket.TrangThai]])
      }]
    };
  });

  function showMessage(message, isError = false) {
    $message.toggleClass('text-danger', isError).text(message);
  }

  function showError(xhr) {
    if (xhr?.status === 401) {
      location.assign('dang-nhap.html');
      return;
    }
    showMessage(xhr?.responseJSON?.message || xhr?.message || 'Không kết nối được máy chủ.', true);
  }

  function seatLabel(item) {
    return item ? item.SoHang + item.SoGhe : '';
  }

  function ticketReference(ticket) {
    const { MaVe, MaSuatChieu, MaKhachHang, MaGhe } = ticket;
    return { MaVe, MaSuatChieu, MaKhachHang, MaGhe };
  }

  function showUrl(code) {
    return api + '/suat-chieu/' + encodeURIComponent(code);
  }

  function customerOption({ MaKhachHang, TenKhachHang, SoDienThoai }, pinned = false) {
    return $('<option>', {
      value: MaKhachHang,
      text: [MaKhachHang, TenKhachHang, SoDienThoai].filter(Boolean).join(' - ') +
        (pinned ? ' (đang chọn)' : '')
    })[0];
  }

  function customerPending() {
    return customerTimer !== undefined || Boolean(customerRequest);
  }

  function renderCustomerOptions() {
    const picked = selectedTicket ?? saleCustomer;
    const options = customers.map(customer => customerOption(customer));
    const pinned = picked && !customers.some(customer => customer.MaKhachHang === picked.MaKhachHang);
    if (pinned) {
      options.unshift(customerOption(picked, !selectedTicket));
    }
    $customer.empty().append($('<option>', { value: '', text: 'Chọn khách hàng' }), options)
      .val(picked?.MaKhachHang ?? '');
    const status = customerPending() ? 'Đang tìm khách hàng…' : customerError || (customerPage
      ? (customerTotal ? `${customers.length} / ${customerTotal} khách hàng` : 'Không tìm thấy khách hàng.') : '');
    const retained = pinned && !selectedTicket ? `Vẫn chọn khách ${saleCustomer.MaKhachHang}.` : '';
    $customerMessage.toggleClass('text-danger', Boolean(customerError)).text([status, retained].filter(Boolean).join(' '));
  }

  function cancelCustomerLookup() {
    clearTimeout(customerTimer);
    customerTimer = undefined;
    const previous = customerRequest;
    customerRequest = null;
    previous?.abort();
    pickCustomerOnLoad = false;
  }

  function clearCustomerResults() {
    cancelCustomerLookup();
    customers = [];
    customerPage = 0;
    customerTotal = 0;
    customerError = '';
  }

  function resetCustomerPicker() {
    clearCustomerResults();
    saleCustomer = null;
    $customerSearch.val('');
    renderCustomerOptions();
  }

  function chooseOnlyCustomer() {
    if ($customer.prop('disabled')) return;
    if (customerTotal === 1 && customers.length === 1) {
      saleCustomer = customers[0];
      renderCustomerOptions();
      renderSelection();
    }
    if (customers.length) $customer.trigger('focus');
  }

  async function loadCustomers(page = 1) {
    const request = new AbortController();
    const previous = customerRequest;
    customerRequest = request;
    previous?.abort();
    customerError = '';
    renderCustomerOptions();
    renderSelection();
    try {
      const result = await lookupCustomers({ q: $customerSearch.val(), page, pageSize: customerPageSize }, { signal: request.signal });
      if (customerRequest !== request) return;
      const byCode = new Map((page === 1 ? [] : customers).map(customer => [customer.MaKhachHang, customer]));
      for (const customer of result.items) byCode.set(customer.MaKhachHang, customer);
      customers = [...byCode.values()];
      customerPage = result.page;
      customerTotal = result.total;
      saleCustomer = byCode.get(saleCustomer?.MaKhachHang) ?? saleCustomer;
    } catch (error) {
      if (customerRequest !== request) return;
      if (error.status === 401) location.assign('dang-nhap.html');
      customerError = error.message || 'Không tải được khách hàng.';
    } finally {
      if (customerRequest === request) {
        customerRequest = null;
        const shouldPick = pickCustomerOnLoad;
        pickCustomerOnLoad = false;
        renderCustomerOptions();
        renderSelection();
        if (shouldPick && !customerError) chooseOnlyCustomer();
      }
    }
  }

  function loadInitialCustomers() {
    if (show?.CoTheBan && !moving && !selectedTicket && !customerPending() && !customerPage && !customerError) {
      loadCustomers();
    }
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
    const active = ready && Boolean(show) && !loading && !saving && !ticketRequest;
    const viewing = Boolean(selectedTicket) && !moving;
    const canChooseSeat = active && Boolean(show?.CoTheBan);
    const canChange = active && viewing && selectedTicket.TrangThai === 'DaDat' && show.CoTheHuyDoi;
    const viewedSeat = viewing && selectedTicket.TrangThai !== 'DaHuy' ? selectedTicket : null;
    const selectedCodes = new Set(viewing
      ? (viewedSeat ? [viewedSeat.MaGhe] : [])
      : moving ? (selectedSeat ? [selectedSeat.MaGhe] : []) : selectedSeats.map(seat => seat.MaGhe));
    const selectedForSale = moving ? (selectedSeat ? [selectedSeat] : []) : selectedSeats;
    const price = viewing || (moving && selectedTicket.MaSuatChieu === show?.MaSuatChieu)
      ? selectedTicket.GiaVe : show?.GiaVe == null ? null : show.GiaVe * (moving ? 1 : Math.max(selectedSeats.length, 1));
    const pickedShow = show ?? shows.find(item => item.MaSuatChieu === $show.val());

    $('#ticket-room').val(pickedShow ? pickedShow.MaPhong + ' - ' + pickedShow.TenPhong : '');
    $('#seat-show').text(show ? '– ' + show.TenPhim + ' · ' + show.TenPhong + ' · ' + show.BatDau : '');
    $seatMap.find('.seat-button').each(function () {
      const $button = $(this);
      const seat = $button.data('seat');
      const isOccupied = Boolean(seat.DaCoVe);
      const isSelected = selectedCodes.has(seat.MaGhe);
      const name = 'Ghế ' + seatLabel(seat) + ($button.hasClass('is-vip') ? ', VIP' : '');
      $button.toggleClass('is-occupied', isOccupied)
        .toggleClass('is-selected', isSelected)
        .prop('disabled', !canChooseSeat || isOccupied)
        .attr('aria-pressed', String(isSelected))
        .attr('aria-label', name + (isOccupied ? ', đã có vé' : ', trống'));
    });

    $film.prop('disabled', !ready || saving || !shows.length);
    $show.prop('disabled', !ready || saving || !$film.val());
    const canPickCustomer = active && !selectedTicket && show.CoTheBan;
    $customer.add($customerSearch).prop('disabled', !canPickCustomer);
    const moreCustomers = customerPage * customerPageSize < customerTotal;
    $customerMore.prop({ hidden: !canPickCustomer || !moreCustomers, disabled: !canPickCustomer || customerPending() });
    const ticketSeats = viewing ? [selectedTicket] : selectedForSale;
    $('#ticket-seat').val(ticketSeats.map(seatLabel).join(', '));
    $('#ticket-date').val(selectedTicket?.NgayDat ?? '');
    $('#ticket-price').val(price == null ? '' : priceFormat.format(price));
    $('#ticket-status').val(selectedTicket ? statusLabels[selectedTicket.TrangThai] : '');
    $('#ticket-id').val(selectedTicket?.MaVe ?? (selectedSeats.length > 1
      ? selectedSeats.length + ' mã vé sẽ được tạo khi lưu' : ''));
    $('#ticket-id').toggleClass('ticket-multiple', !selectedTicket && selectedSeats.length > 1);
    if (!selectedTicket && selectedSeats.length > 1) {
      $('#ticket-price').val(priceFormat.format(price) + ' · ' + selectedSeats.length + ' vé');
    }
    const hasSeatSelection = moving ? Boolean(selectedSeat) : selectedSeats.length > 0;
    const canSave = moving || (saleCustomer && !customerPending());
    $('#save-ticket').text(moving ? 'Lưu đổi' : 'Lưu vé')
      .prop('disabled', !active || !show.CoTheBan || viewing || !hasSeatSelection || !canSave);
    $('#move-ticket, #cancel-ticket').prop('disabled', !canChange);
    enableTicketExport(!loading && !saving && !ticketRequest && !moving && Boolean(viewing ? show : lastSale));
    $('#clear-ticket').text(moving ? 'Bỏ đổi' : 'Làm mới')
      .prop('disabled', !ready || saving || (!moving && !$show.val()));
    $('#logout-button').prop('disabled', saving);
    ticketList.setSelected(selectedTicket, ready && Boolean(show) && !loading && !saving && !moving);
  }

  function clearSelection() {
    cancelTicketLookup();
    selectedTicket = null;
    lastSale = null;
    selectedSeat = null;
    selectedSeats = [];
    moving = false;
    resetCustomerPicker();
  }

  function cancelTicketLookup() {
    const previous = ticketRequest;
    ticketRequest = null;
    previous?.abort();
  }

  async function loadTicket(ticket, pick = false, preserveMessage = false) {
    const request = new AbortController();
    cancelTicketLookup();
    ticketRequest = request;
    renderSelection();
    let loaded = false;
    try {
      const current = await ListQuery.loadFrom(showUrl(ticket.MaSuatChieu) + '/ve/chi-tiet')({
        maVe: ticket.MaVe, maKhachHang: ticket.MaKhachHang, maGhe: ticket.MaGhe
      }, { signal: request.signal });
      if (ticketRequest !== request) return;

      if (moving && current.TrangThai !== 'DaDat') {
        moving = false;
        selectedSeat = null;
        selectedTicket = current.MaSuatChieu === $show.val() ? current : null;
      } else {
        selectedTicket = current;
      }
      if (pick) {
        lastSale = null;
        selectedSeat = null;
        selectedSeats = [];
      }
      resetCustomerPicker();
      loaded = true;
    } catch (error) {
      if (ticketRequest !== request) return;
      if (error.status === 404) {
        const missingCurrent = !pick || (selectedTicket && Object.entries(ticketReference(ticket))
          .every(([field, value]) => selectedTicket[field] === value));
        if (missingCurrent) {
          selectedTicket = null;
          moving = false;
          selectedSeat = null;
          renderCustomerOptions();
        }
      }
      if (!preserveMessage || error.status === 401) showError(error);
      if (pick && error.status === 404 && show) {
        loadShow(show.MaSuatChieu, { keepFeedback: true, refreshTickets: true });
      }
    } finally {
      if (ticketRequest === request) {
        ticketRequest = null;
        renderSelection();
        loadInitialCustomers();
        if (loaded && !preserveMessage) feedbackForShow();
      }
    }
  }

  function selectTicket(ticket) {
    if (saving || loading || moving || ticket.MaSuatChieu !== show?.MaSuatChieu) return;
    showMessage('');
    loadTicket(ticket, true);
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

  function clearShowDetails(seatMessage) {
    show = null;
    seats = [];
    $seatAvailability.empty();
    renderSeatMap(seatMessage);
    renderSelection();
  }

  function showSelectionPrompt() {
    ++showRequest;
    cancelTicketLookup();
    loading = false;
    let message = 'Chọn phim rồi chọn suất chiếu.';
    if (!shows.length) message = 'Không có suất chiếu đang mở bán.';
    else if ($film.val()) message = 'Chọn suất chiếu để xem ghế và vé.';
    ticketList.setShow('', message);
    clearShowDetails(message);
    showMessage('');
  }

  async function loadShow(code, { keepFeedback = false, refreshTickets = false, recheckTicket = false } = {}) {
    const request = ++showRequest;
    cancelTicketLookup();
    loading = true;
    clearShowDetails('Đang tải sơ đồ ghế…');
    if (refreshTickets) ticketList.refresh();
    else ticketList.setShow(code);
    if (!keepFeedback) showMessage('');
    if (recheckTicket && selectedTicket) loadTicket(selectedTicket, false, true);

    try {
      const detail = await $.getJSON(showUrl(code));
      if (request !== showRequest) return;

      show = detail.suatChieu;
      seats = detail.ghe;
      $seatAvailability.text('Số ghế trống: ' + show.SoGheTrong);
      if (selectedSeat) {
        const code = selectedSeat.MaGhe;
        selectedSeat = seats.find(seat => seat.MaGhe === code && !seat.DaCoVe) ?? null;
      }
      if (selectedSeats.length) {
        const available = new Map(seats.filter(seat => !seat.DaCoVe).map(seat => [seat.MaGhe, seat]));
        selectedSeats = selectedSeats.map(seat => available.get(seat.MaGhe)).filter(Boolean);
      }

      renderSeatMap();
      if (!keepFeedback) feedbackForShow();
    } catch (xhr) {
      if (request !== showRequest) return;
      renderSeatMap('Không tải được sơ đồ ghế.');
      showError(xhr);
    } finally {
      if (request === showRequest) {
        loading = false;
        renderSelection();
        loadInitialCustomers();
      }
    }
  }

  async function changeTicket(method, path, payload, message) {
    if (saving || loading || ticketRequest || !show) return;
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
      selectedSeats = [];
      resetCustomerPicker();
      saved = true;
      showMessage(message + ' ' + selectedTicket.MaVe + '.');
      await loadShow(selectedTicket.MaSuatChieu, { keepFeedback: true, refreshTickets: true });
    } catch (xhr) {
      if (xhr?.status === 409 || xhr?.status === 404) {
        await loadShow($show.val(), { keepFeedback: true, refreshTickets: true, recheckTicket: true });
      }
      showError(xhr);
    } finally {
      saving = false;
      renderSelection();
      if (saved) $('#clear-ticket').trigger('focus');
    }
  }

  async function sellTickets() {
    if (saving || loading || ticketRequest || !show?.CoTheBan || !saleCustomer ||
      customerPending() || !selectedSeats.length) return;
    const showCode = show.MaSuatChieu;
    const payload = {
      MaSuatChieu: showCode,
      MaKhachHang: saleCustomer.MaKhachHang,
      MaGhes: selectedSeats.map(seat => seat.MaGhe)
    };
    saving = true;
    showMessage('');
    renderSelection();
    let saved = false;
    try {
      const result = await $.ajax({
        url: api, method: 'POST', contentType: 'application/json', data: JSON.stringify(payload)
      });
      const savedTickets = Array.isArray(result) ? result : [result];
      lastSale = { tickets: savedTickets, show };
      selectedTicket = null;
      selectedSeat = null;
      selectedSeats = [];
      moving = false;
      saved = true;
      showMessage('Đã lưu ' + savedTickets.length + ' vé: '
        + savedTickets.map(ticket => ticket.MaVe).join(', ') + '.');
      await loadShow(showCode, { keepFeedback: true, refreshTickets: true });
    } catch (xhr) {
      if (xhr?.status === 409 || xhr?.status === 404) {
        await loadShow(showCode, { keepFeedback: true, refreshTickets: true });
      }
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

  $customer.on('change', () => {
    if (selectedTicket) return;
    const code = $customer.val();
    saleCustomer = customers.find(customer => customer.MaKhachHang === code)
      ?? (saleCustomer?.MaKhachHang === code ? saleCustomer : null);
    renderCustomerOptions();
    renderSelection();
  });

  $customerMore.on('click', () => {
    if (!$customerMore.prop('disabled') && customerPage * customerPageSize < customerTotal) {
      loadCustomers(customerPage + 1);
    }
  });

  $customerSearch.on('input', () => {
    clearCustomerResults();
    customerTimer = setTimeout(() => {
      customerTimer = undefined;
      loadCustomers();
    }, 250);
    renderCustomerOptions();
    renderSelection();
  }).on('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.originalEvent?.isComposing) return;
    if (customerPending() || customerError) {
      pickCustomerOnLoad = true;
      if (customerTimer !== undefined || customerError) {
        clearTimeout(customerTimer);
        customerTimer = undefined;
        loadCustomers();
      }
    } else {
      chooseOnlyCustomer();
    }
  });

  $seatMap.on('click', '.seat-button', function () {
    if (saving || loading || ticketRequest || !show?.CoTheBan) return;
    const seat = $(this).data('seat');
    if (seat.DaCoVe) return;
    if (selectedTicket && !moving) clearSelection();
    lastSale = null;
    if (moving) {
      selectedSeat = selectedSeat?.MaGhe === seat.MaGhe ? null : seat;
    } else {
      const isSelected = selectedSeats.some(item => item.MaGhe === seat.MaGhe);
      selectedSeats = isSelected
        ? selectedSeats.filter(item => item.MaGhe !== seat.MaGhe)
        : [...selectedSeats, seat];
    }
    renderSelection();
    loadInitialCustomers();
    feedbackForShow();
  });

  $('#clear-ticket').on('click', () => {
    if (saving) return;
    clearSelection();
    if ($show.val()) {
      loadShow($show.val(), { refreshTickets: true });
      $show.trigger('focus');
    } else {
      showSelectionPrompt();
      ($film.val() ? $show : $film).trigger('focus');
    }
  });

  $('#move-ticket').on('click', () => {
    if (saving || loading || ticketRequest || !show?.CoTheHuyDoi || selectedTicket?.TrangThai !== 'DaDat') return;
    moving = true;
    selectedSeat = null;
    selectedSeats = [];
    renderSelection();
    feedbackForShow();
    $show.trigger('focus');
  });

  $form.on('submit', event => {
    event.preventDefault();
    if (saving || loading || ticketRequest || !show?.CoTheBan || (selectedTicket && !moving)) return;
    if (moving) {
      if (!selectedSeat) return;
      const payload = { MaSuatChieu: show.MaSuatChieu, MaGhe: selectedSeat.MaGhe };
      changeTicket('PUT', '/doi', { ...payload, Ve: ticketReference(selectedTicket) }, 'Đã đổi vé');
    } else if (saleCustomer && selectedSeats.length) {
      sellTickets();
    }
  });

  $('#cancel-ticket').on('click', () => {
    if (saving || loading || ticketRequest || moving || !show?.CoTheHuyDoi || selectedTicket?.TrangThai !== 'DaDat') return;
    if (!window.confirm('Hủy vé ' + selectedTicket.MaVe + '?')) return;
    changeTicket('PUT', '/huy', { Ve: ticketReference(selectedTicket) }, 'Đã hủy vé');
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
    ticketList.setShow('', 'Đang tải suất chiếu…');
    renderSeatMap('Đang tải suất chiếu…');
    try {
      const [user, showRows] = await Promise.all([
        $.getJSON('/api/auth/me'), $.getJSON(api + '/suat-chieu')
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
      resetCustomerPicker();
      ready = true;
      showSelectionPrompt();
    } catch (xhr) {
      ticketList.setShow('', 'Không tải được dữ liệu bán vé.');
      renderSeatMap('Không tải được sơ đồ ghế.');
      showError(xhr);
    }
  }

  initialize();
})();
