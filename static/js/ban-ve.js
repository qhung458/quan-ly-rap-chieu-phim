/* global jQuery */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  const rows = 'ABCDEF';
  const seatsPerRow = 10;
  // Các mốc mặc định trong sqlCode/create_trigger.sql.
  const saleCutoff = 5 * 60 * 1000;
  const cancellationCutoff = 60 * 60 * 1000;
  const dateFormat = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeFormat = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const priceFormat = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
  const statusLabels = {
    DaDat: 'Đã đặt',
    DaSuDung: 'Đã sử dụng',
    DaHuy: 'Đã hủy'
  };

  function sampleDate(dayOffset, hour) {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    date.setHours(hour, 0, 0, 0);
    return date;
  }

  // Dữ liệu mẫu trong phiên xem trang, cùng mã khách hàng với trang Khách hàng.
  const shows = [
    { id: 'SC003', film: 'Phim A', room: 1, startsAt: sampleDate(1, 19), price: 130000 },
    { id: 'SC004', film: 'Phim B', room: 2, startsAt: new Date(Date.now() + 3 * 60 * 1000), price: 110000 },
    { id: 'SC002', film: 'Phim B', room: 2, startsAt: sampleDate(-1, 19), price: 110000 }
  ];
  const customers = {
    KH001: 'Nguyễn Văn An',
    KH002: 'Trần Thị Bình',
    KH003: 'Lê Minh Khoa',
    KH004: 'Phạm Ngọc Anh'
  };
  const tickets = [
    { id: 'V0102', showId: 'SC003', customerId: 'KH001', seat: 'D7', date: sampleDate(-1, 9), status: 'DaDat' },
    { id: 'V0103', showId: 'SC003', customerId: 'KH002', seat: 'C4', date: sampleDate(-1, 9), status: 'DaDat' },
    { id: 'V0104', showId: 'SC002', customerId: 'KH003', seat: 'C5', date: sampleDate(-1, 9), status: 'DaSuDung' },
    { id: 'V0105', showId: 'SC003', customerId: 'KH001', seat: 'C5', date: sampleDate(-1, 9), status: 'DaDat' },
    { id: 'V0106', showId: 'SC003', customerId: 'KH002', seat: 'C6', date: sampleDate(-1, 9), status: 'DaDat' },
    { id: 'V0107', showId: 'SC003', customerId: 'KH004', seat: 'D8', date: sampleDate(-1, 9), status: 'DaHuy' }
  ];

  const $show = $('#ticket-show');
  const $customer = $('#ticket-customer');
  const $seatMap = $('#seat-map');
  const $ticketRows = $('#ticket-rows');
  const $search = $('#ticket-search');
  const $message = $('#ticket-message');
  let show = shows[0];
  let selectedSeat = '';
  let selectedTicket = null;
  let ticketQuery = '';
  let customerQuery = '';
  let nextTicketNumber = 108;

  function nextTicketId() {
    return 'V' + String(nextTicketNumber).padStart(4, '0');
  }

  function seatId(seat) {
    const number = (show.room - 1) * rows.length * seatsPerRow
      + rows.indexOf(seat[0]) * seatsPerRow + Number(seat.slice(1));
    return 'G' + String(number).padStart(3, '0');
  }

  function occupiedSeats() {
    return new Set(tickets
      .filter(ticket => ticket.showId === show.id && ticket.status !== 'DaHuy')
      .map(ticket => ticket.seat));
  }

  function buildSeatMap() {
    for (const row of rows) {
      $seatMap.append($('<span>', { class: 'seat-row-label', text: row, 'aria-hidden': 'true' }));
      for (let number = 1; number <= seatsPerRow; number++) {
        $seatMap.append($('<button>', {
          type: 'button',
          class: 'seat-button',
          text: number,
          'data-seat': row + number
        }).toggleClass('is-vip', row === 'F'));
      }
    }
  }

  function showMessage(message, isError = false) {
    $message.toggleClass('text-danger', isError).text(message);
  }

  function showSaleHint() {
    if (show.startsAt.getTime() - Date.now() < saleCutoff) {
      showMessage('Suất chiếu đã ngừng bán. Chỉ lưu vé khi còn ít nhất 5 phút trước giờ chiếu.', true);
    } else {
      showMessage('Dữ liệu mẫu. Ngừng bán khi còn dưới 5 phút trước giờ chiếu.');
    }
  }

  function renderSelection() {
    const seat = selectedTicket ? selectedTicket.seat : selectedSeat;
    const occupied = occupiedSeats();
    $('#seat-show').text('– ' + show.film + ', Phòng ' + show.room + ', ' + timeFormat.format(show.startsAt));
    $seatMap.find('.seat-button').each(function () {
      const code = this.dataset.seat;
      const $button = $(this);
      const isOccupied = occupied.has(code);
      const isSelected = code === seat && selectedTicket?.status !== 'DaHuy';
      const name = 'Ghế ' + code + ($button.hasClass('is-vip') ? ', VIP' : '');
      $button
        .toggleClass('is-occupied', isOccupied)
        .toggleClass('is-selected', isSelected)
        .prop('disabled', isOccupied)
        .attr('aria-pressed', String(isSelected))
        .attr('aria-label', name + (isOccupied ? ', đã đặt' : ', trống'));
    });

    const isView = Boolean(selectedTicket);
    $('#ticket-id').val(selectedTicket?.id || nextTicketId());
    $customer.prop('disabled', isView);
    if (isView) $customer.val(selectedTicket.customerId);
    $('#ticket-seat').val(seat);
    $('#ticket-date').val(dateFormat.format(selectedTicket?.date || new Date()));
    $('#ticket-price').val(priceFormat.format(selectedTicket?.price ?? show.price));
    $('#ticket-status').val(statusLabels[selectedTicket?.status || 'DaDat']);
    $('#save-ticket').prop('disabled', isView);
    $('#cancel-ticket').prop('disabled', selectedTicket?.status !== 'DaDat');

    $ticketRows.find('[data-ticket-id]').each(function () {
      const isSelected = this.dataset.ticketId === selectedTicket?.id;
      $(this).toggleClass('is-selected', isSelected)
        .find('.ticket-selector').attr('aria-pressed', String(isSelected));
    });
  }

  function renderTickets() {
    const showTickets = tickets.filter(ticket => ticket.showId === show.id);
    const matches = showTickets.filter(ticket =>
      ticket.id.includes(ticketQuery) && ticket.customerId.includes(customerQuery)
    );
    $('#ticket-count').text(matches.length + '/' + showTickets.length + ' vé');
    $ticketRows.empty();

    if (!matches.length) {
      const message = showTickets.length ? 'Không tìm thấy vé phù hợp.' : 'Suất chiếu này chưa có vé.';
      $ticketRows.append($('<tr>').append($('<td>', { colspan: 7, text: message })));
      return;
    }

    for (const ticket of matches) {
      const $button = $('<button>', {
        type: 'button',
        class: 'btn btn-link p-0 ticket-selector',
        text: ticket.id
      });
      const $row = $('<tr>', { 'data-ticket-id': ticket.id }).append($('<td>').append($button));
      $row.append(
        $('<td>').text(ticket.showId),
        $('<td>').text(ticket.customerId),
        $('<td>').text(seatId(ticket.seat) + ' (' + ticket.seat + ')'),
        $('<td>').text(dateFormat.format(ticket.date)),
        $('<td>').text(priceFormat.format(ticket.price ?? show.price)),
        $('<td>').text(statusLabels[ticket.status])
      );
      $ticketRows.append($row);
    }
  }

  function clearSelection() {
    selectedTicket = null;
    selectedSeat = '';
    $customer.val('');
  }

  function clearSearch() {
    $search[0].reset();
    ticketQuery = '';
    customerQuery = '';
  }

  $show.on('change', function () {
    show = shows.find(item => item.id === this.value);
    clearSelection();
    clearSearch();
    renderTickets();
    renderSelection();
    showSaleHint();
  });

  $seatMap.on('click', '.seat-button', function () {
    if (selectedTicket) clearSelection();
    selectedSeat = selectedSeat === this.dataset.seat ? '' : this.dataset.seat;
    renderSelection();
    showSaleHint();
  });

  $ticketRows.on('click', '[data-ticket-id]', function () {
    selectedTicket = tickets.find(ticket => ticket.id === this.dataset.ticketId);
    selectedSeat = '';
    renderSelection();
    showMessage('');
  });

  $('#clear-ticket').on('click', () => {
    clearSelection();
    renderSelection();
    showSaleHint();
    $show.trigger('focus');
  });

  $('#ticket-form').on('submit', event => {
    event.preventDefault();
    if (selectedTicket) return;

    if (show.startsAt.getTime() - Date.now() < saleCutoff) {
      showSaleHint();
      return;
    }

    if (!selectedSeat || occupiedSeats().has(selectedSeat)) {
      showMessage('Chọn một ghế trống trên sơ đồ trước khi lưu vé.', true);
      return;
    }

    selectedTicket = {
      id: nextTicketId(),
      showId: show.id,
      customerId: $customer.val(),
      seat: selectedSeat,
      date: new Date(),
      price: show.price,
      status: 'DaDat'
    };
    tickets.push(selectedTicket);
    nextTicketNumber++;
    selectedSeat = '';
    clearSearch();
    renderTickets();
    renderSelection();
    showMessage('Đã lưu vé mẫu ' + selectedTicket.id + '.');
    $('#clear-ticket').trigger('focus');
  });

  $('#cancel-ticket').on('click', () => {
    if (selectedTicket?.status !== 'DaDat') return;

    if (show.startsAt.getTime() - Date.now() < cancellationCutoff) {
      showMessage('Không thể hủy vé khi còn dưới 60 phút trước giờ chiếu.', true);
      return;
    }

    selectedTicket.status = 'DaHuy';
    renderTickets();
    renderSelection();
    showMessage('Đã hủy vé mẫu ' + selectedTicket.id + '. Ghế ' + selectedTicket.seat + ' đã trống.');
    $('#clear-ticket').trigger('focus');
  });

  $search.on('submit', event => {
    event.preventDefault();
    ticketQuery = $('#search-ticket-id').val().trim().toUpperCase();
    customerQuery = $('#search-customer-id').val().trim().toUpperCase();
    if (selectedTicket && (!selectedTicket.id.includes(ticketQuery) || !selectedTicket.customerId.includes(customerQuery))) {
      clearSelection();
      showSaleHint();
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

  for (const item of shows) {
    const dateTime = dateFormat.format(item.startsAt) + ' ' + timeFormat.format(item.startsAt);
    $show.append($('<option>', { value: item.id, text: item.id + ' · ' + item.film + ' · ' + dateTime }));
  }

  for (const [id, name] of Object.entries(customers)) {
    $customer.append($('<option>', { value: id, text: id + ' · ' + name }));
  }

  $show.val(show.id).prop('disabled', false);
  $search.find(':input').add('#clear-ticket').prop('disabled', false);
  buildSeatMap();
  renderTickets();
  renderSelection();
  showSaleHint();
})();
