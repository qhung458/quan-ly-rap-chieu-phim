/* global jQuery, ListQuery */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  const api = '/api/phong-chieu';
  const $roomForm = $('#room-form');
  const $seatForm = $('#seat-form');
  const $roomFilter = $('#room-filter-form');
  const $seatFilter = $('#seat-filter-form');
  const $seatRowOptions = $('#seat-row-options');
  const $roomRows = $('#room-rows');
  const $seatRows = $('#seat-rows');
  const $roomMessage = $('#room-message');
  const $seatMessage = $('#seat-message');
  const $roomSeatCount = $('#room-seat-count');
  const $seatsPerRow = $('#room-seats-per-row');
  const fetchRooms = ListQuery.loadFrom(api);
  const fetchRoomOptions = ListQuery.loadFrom(api + '/tuy-chon');

  let user;
  let rooms = [];
  let seats = [];
  let room = null;
  let seat = null;
  let roomMode = '';
  let seatMode = '';
  let roomsLoading = false;
  let seatsLoading = false;
  let roomsError = '';
  let seatsError = '';
  let saving = false;
  let roomRequest;
  let seatRequest;
  let roomCodeRequest;
  let roomFilters = {};
  let seatFilters = {};

  function showMessage($element, message, isError = false) {
    $element.toggleClass('text-danger', isError).text(message);
  }

  function errorText(error, fallback = 'Không kết nối được máy chủ.') {
    return error?.responseJSON?.message || error?.message || fallback;
  }

  function showError($element, error) {
    if (error.status === 401) {
      location.assign('dang-nhap.html');
      return;
    }
    showMessage($element, errorText(error), true);
  }

  function emptyRow($body, colspan, message) {
    $body.empty().append($('<tr>').append($('<td>', { colspan, text: message })));
  }

  function roomUrl() {
    return api + '/' + encodeURIComponent(room.MaPhong);
  }

  function seatUrl() {
    return roomUrl() + '/ghe/' + encodeURIComponent(seat.MaGhe);
  }

  function syncControls() {
    const canManage = Boolean(user) && !saving && !roomsLoading;
    const canDelete = canManage && user.VaiTro === 'QuanTriVien';
    const roomEditing = canManage && Boolean(roomMode);
    const canManageSeats = canManage && Boolean(room) && !seatsLoading;
    const seatEditing = canManageSeats && Boolean(seatMode);

    $('#room-id').prop('disabled', !room && !roomEditing).prop('readOnly', roomMode !== 'add');
    $('#room-name, #room-type').prop('disabled', !roomEditing);
    $roomSeatCount.prop('disabled', !room && !roomEditing).prop('readOnly', !roomEditing || roomMode !== 'add');
    $seatsPerRow.add('label[for="room-seats-per-row"]').prop('hidden', roomMode !== 'add');
    $seatsPerRow.prop('disabled', !roomEditing || roomMode !== 'add');
    $('#add-room').prop('disabled', !canManage || Boolean(roomMode));
    $('#save-room').prop('disabled', !roomEditing);
    $('#edit-room').prop('disabled', !canManage || !room || Boolean(roomMode));
    $('#delete-room').prop('disabled', !canDelete || !room || Boolean(roomMode));
    $('#clear-room, #logout-button').prop('disabled', !canManage);

    $('#seat-row, #seat-number, #seat-type').prop('disabled', !seatEditing);
    $('#add-seat').text(seatMode === 'add' ? 'Lưu ghế' : 'Thêm')
      .prop('disabled', !canManageSeats || seatMode === 'edit');
    $('#edit-seat').text(seatMode === 'edit' ? 'Lưu sửa' : 'Sửa')
      .prop('disabled', !canManageSeats || !seat || seatMode === 'add');
    $('#delete-seat').prop('disabled', !canManageSeats || !canDelete || !seat || Boolean(seatMode));
    $('#clear-seat').prop('disabled', !canManageSeats || (!seat && !seatMode));
    $roomFilter.children('fieldset').prop('disabled', !user || saving);
    $seatFilter.children('fieldset').prop('disabled', !room || saving);
  }

  function recordRow(code, kind, active, values) {
    const $button = $('<button>', {
      type: 'button',
      class: kind + '-selector',
      text: code,
      'aria-pressed': String(active)
    });
    const $row = $('<tr>').attr('data-' + kind + '-id', code).toggleClass('is-selected', active)
      .append($('<td>').append($button));
    for (const value of values) $row.append($('<td>').text(value));
    return $row;
  }

  function updateSelection($body, kind, code) {
    const attribute = 'data-' + kind + '-id';
    $body.children('tr[' + attribute + ']').each(function () {
      const active = this.getAttribute(attribute) === code;
      $(this).toggleClass('is-selected', active)
        .find('.' + kind + '-selector').attr('aria-pressed', String(active));
    });
  }

  function renderRooms() {
    $roomRows.empty();
    $('#room-count').text(roomsLoading || roomsError ? '' : rooms.length + ' phòng');
    if (roomsLoading) return emptyRow($roomRows, 4, 'Đang tải phòng chiếu…');
    if (roomsError) return emptyRow($roomRows, 4, roomsError);
    if (!rooms.length) {
      const filtered = roomFilters.loaiPhong || roomFilters.soGheMin || roomFilters.soGheMax;
      return emptyRow($roomRows, 4, filtered
        ? 'Không có phòng đáp ứng loại và sức chứa đã chọn.' : 'Chưa có phòng chiếu.');
    }
    for (const item of rooms) {
      $roomRows.append(recordRow(item.MaPhong, 'room', item.MaPhong === room?.MaPhong,
        [item.TenPhong, item.SoGhe, item.LoaiPhong]));
    }
  }

  function renderSeats() {
    $seatRows.empty();
    $('#seat-count').text(room && !seatsLoading && !seatsError ? `${seats.length} / ${room.SoGhe} ghế` : '');
    if (!room) return emptyRow($seatRows, 5, 'Chọn một phòng để xem danh sách ghế.');
    if (seatsLoading) return emptyRow($seatRows, 5, 'Đang tải ghế…');
    if (seatsError) return emptyRow($seatRows, 5, seatsError);
    if (!seats.length) {
      return emptyRow($seatRows, 5, room.SoGhe ? 'Không tìm thấy ghế phù hợp.' : 'Phòng này chưa có ghế.');
    }
    for (const item of seats) {
      $seatRows.append(recordRow(item.MaGhe, 'seat', item.MaGhe === seat?.MaGhe,
        [item.MaPhong, item.SoHang, item.SoGhe, item.LoaiGhe === 'VIP' ? 'VIP' : 'Thường']));
    }
  }

  function showRoom(item) {
    roomCodeRequest?.abort();
    roomCodeRequest = null;
    room = item ? { ...item } : null;
    roomMode = '';
    $roomForm[0].reset();
    $('#room-id').val(room?.MaPhong ?? '');
    $('#room-name').val(room?.TenPhong ?? '');
    $roomSeatCount.val(room?.SoGhe ?? '');
    if (room) $('#room-type').val(room.LoaiPhong);
    $('#selected-room-label').text(room ? '— ' + room.MaPhong : '');
    updateSelection($roomRows, 'room', room?.MaPhong);
    syncControls();
  }

  function showSeat(item) {
    seat = item;
    seatMode = '';
    $seatForm[0].reset();
    $('#seat-room').val(room?.MaPhong ?? '');
    $('#seat-id').val(seat?.MaGhe ?? '').removeAttr('placeholder');
    $('#seat-row').val(seat?.SoHang ?? '');
    $('#seat-number').val(seat?.SoGhe ?? '');
    $('#seat-type').val(seat?.LoaiGhe ?? 'Thuong');
    updateSelection($seatRows, 'seat', seat?.MaGhe);
    syncControls();
  }

  function readFilters(form) {
    const query = {};
    for (const [field, value] of new FormData(form)) {
      const term = value.trim();
      if (!term) continue;
      query[field] = Object.hasOwn(query, field) ? [].concat(query[field], term) : term;
    }
    return query;
  }

  function renderSeatRowOptions(rows) {
    const options = $seatRowOptions.find('input').get();
    const selected = new Set(options.filter(input => input.checked).map(input => input.value));
    const labels = [...new Set([...rows, ...selected, ...[].concat(seatFilters.hang ?? [])])];
    if (labels.length === options.length && labels.every((label, index) => label === options[index].value)) return;
    const focused = options.includes(document.activeElement) ? document.activeElement.value : null;
    $seatRowOptions.empty();
    for (const row of labels) {
      const $check = $('<input>', { class: 'form-check-input', type: 'checkbox', name: 'hang', value: row })
        .prop('checked', selected.has(row));
      $seatRowOptions.append($('<label>').append($check, document.createTextNode(' ' + row)));
      if (row === focused) $check.trigger('focus');
    }
  }

  async function loadRooms() {
    roomRequest?.abort();
    const request = new AbortController();
    roomRequest = request;
    roomsLoading = true;
    roomsError = '';
    renderRooms();
    syncControls();
    try {
      const items = await fetchRooms(roomFilters, { signal: request.signal });
      if (request === roomRequest) rooms = items;
    } catch (error) {
      if (request !== roomRequest) return;
      if (error.status === 401) location.assign('dang-nhap.html');
      roomsError = errorText(error, 'Không tải được danh sách phòng. Hãy áp dụng lại bộ lọc.');
    } finally {
      if (request === roomRequest) {
        roomRequest = null;
        roomsLoading = false;
        renderRooms();
        syncControls();
      }
    }
  }

  async function loadSeats() {
    seatRequest?.abort();
    const request = room ? new AbortController() : null;
    seatRequest = request;
    seats = [];
    seatsError = '';
    seatsLoading = Boolean(request);
    renderSeats();
    syncControls();
    if (!request) return;

    try {
      const result = await ListQuery.loadFrom(roomUrl() + '/ghe')(seatFilters, { signal: request.signal });
      if (request !== seatRequest) return;
      seats = result.items;
      room.SoGhe = result.totalRoomSeats;
      $roomSeatCount.val(room.SoGhe);
      renderSeatRowOptions(result.rows);
      if (seat && !seatMode) {
        const current = seats.find(item => item.MaGhe === seat.MaGhe);
        if (current || !Object.keys(seatFilters).length) showSeat(current ?? null);
      }
    } catch (error) {
      if (request !== seatRequest) return;
      if (error.status === 401) location.assign('dang-nhap.html');
      if (error.status === 404) {
        selectRoom(null);
        showMessage($roomMessage, errorText(error, 'Không tìm thấy phòng chiếu.'), true);
        await loadRooms();
        return;
      }
      seatsError = errorText(error, 'Không tải được danh sách ghế. Hãy áp dụng lại bộ lọc.');
    } finally {
      if (request === seatRequest) {
        seatRequest = null;
        seatsLoading = false;
        renderSeats();
        syncControls();
      }
    }
  }

  async function change(method, url, payload, $message, onSaved) {
    if (!user || saving || roomsLoading) return;
    saving = true;
    syncControls();
    showMessage($message, '');
    try {
      const result = await $.ajax({
        url,
        method,
        contentType: 'application/json',
        data: payload ? JSON.stringify(payload) : undefined
      });
      await onSaved(result);
    } catch (xhr) {
      showError($message, xhr);
    } finally {
      saving = false;
      syncControls();
    }
  }

  function selectRoom(item) {
    const changed = item?.MaPhong !== room?.MaPhong;
    showMessage($roomMessage, '');
    showMessage($seatMessage, '');
    showRoom(item);
    if (changed) {
      seatFilters = {};
      $seatFilter[0].reset();
      $seatRowOptions.empty();
    }
    showSeat(null);
    return loadSeats();
  }

  $roomFilter.on('submit', event => {
    event.preventDefault();
    if (!user || saving) return;
    roomFilters = readFilters(event.currentTarget);
    loadRooms();
  });

  $('#room-filter-reset').on('click', () => {
    $roomFilter[0].reset();
    roomFilters = {};
    loadRooms();
  });

  $seatFilter.on('submit', event => {
    event.preventDefault();
    if (!room || saving) return;
    seatFilters = readFilters(event.currentTarget);
    loadSeats();
  });

  $('#seat-filter-reset').on('click', () => {
    $seatFilter[0].reset();
    seatFilters = {};
    loadSeats();
  });

  $roomRows.on('click', 'tr[data-room-id]', function () {
    if (!saving && !roomsLoading) selectRoom(rooms.find(item => item.MaPhong === this.dataset.roomId));
  });

  $seatRows.on('click', 'tr[data-seat-id]', function () {
    if (saving || seatsLoading || roomsLoading) return;
    showMessage($seatMessage, '');
    showSeat(seats.find(item => item.MaGhe === this.dataset.seatId));
  });

  async function suggestRoomCode() {
    const request = new AbortController();
    roomCodeRequest = request;
    showMessage($roomMessage, 'Đang lấy gợi ý mã phòng…');
    try {
      const options = await fetchRoomOptions({}, { signal: request.signal });
      if (request !== roomCodeRequest) return;
      const used = new Set(options.map(item => item.MaPhong.toUpperCase()));
      let number = 1;
      const code = () => 'PC' + String(number).padStart(2, '0');
      while (used.has(code())) number++;
      if (!$('#room-id').val()) $('#room-id').val(code());
      showMessage($roomMessage, '');
    } catch (error) {
      if (request !== roomCodeRequest) return;
      if (error.status === 401) location.assign('dang-nhap.html');
      else showMessage($roomMessage, 'Không lấy được gợi ý mã phòng. Hãy nhập mã phòng.', true);
    } finally {
      if (request === roomCodeRequest) roomCodeRequest = null;
    }
  }

  $('#add-room').on('click', () => {
    selectRoom(null);
    roomMode = 'add';
    $roomSeatCount.val(20).trigger('input');
    syncControls();
    $('#room-name').trigger('focus');
    suggestRoomCode();
  });

  $roomSeatCount.on('input', function () {
    $seatsPerRow.attr('max', this.value || null);
  });

  $('#edit-room').on('click', () => {
    roomMode = 'edit';
    syncControls();
    $('#room-name').trigger('focus');
  });

  $roomForm.on('submit', event => {
    event.preventDefault();
    if (!roomMode || saving || !event.currentTarget.reportValidity()) return;
    const adding = roomMode === 'add';
    const payload = {
      TenPhong: $('#room-name').val(),
      LoaiPhong: $('#room-type').val()
    };
    if (adding) {
      roomCodeRequest?.abort();
      roomCodeRequest = null;
      payload.MaPhong = $('#room-id').val();
      payload.SoGhe = Number($roomSeatCount.val());
      if ($seatsPerRow.val() !== '') payload.SoGheMoiHang = Number($seatsPerRow.val());
    }
    change(adding ? 'POST' : 'PUT', adding ? api : roomUrl(), payload, $roomMessage, async saved => {
      const selected = adding ? selectRoom(saved) : showRoom(saved);
      showMessage($roomMessage, adding ? 'Đã thêm phòng và ' + saved.SoGhe + ' ghế.' : 'Đã cập nhật phòng.');
      await Promise.all([loadRooms(), selected]);
    });
  });

  $('#delete-room').on('click', () => {
    if (!room || saving || !window.confirm('Xóa phòng ' + room.MaPhong + ' và toàn bộ ghế trong phòng?')) return;
    change('DELETE', roomUrl(), null, $roomMessage, async () => {
      await Promise.all([selectRoom(null), loadRooms()]);
      showMessage($roomMessage, 'Đã xóa phòng và các ghế thuộc phòng.');
    });
  });

  $('#clear-room').on('click', () => {
    selectRoom(null);
    loadRooms();
  });

  $('#add-seat').on('click', () => {
    if (seatMode === 'add') return $seatForm[0].requestSubmit();
    showMessage($seatMessage, '');
    showSeat(null);
    seatMode = 'add';
    $('#seat-id').attr('placeholder', 'Tự tạo khi lưu');
    syncControls();
    $('#seat-row').trigger('focus');
  });

  $('#edit-seat').on('click', () => {
    if (seatMode === 'edit') return $seatForm[0].requestSubmit();
    showMessage($seatMessage, '');
    seatMode = 'edit';
    syncControls();
    $('#seat-row').trigger('focus');
  });

  $('#clear-seat').on('click', () => {
    showMessage($seatMessage, '');
    showSeat(null);
  });

  $seatForm.on('submit', event => {
    event.preventDefault();
    if (!room || !seatMode || saving || seatsLoading || !event.currentTarget.reportValidity()) return;
    const adding = seatMode === 'add';
    const payload = {
      SoHang: $('#seat-row').val(),
      SoGhe: Number($('#seat-number').val()),
      LoaiGhe: $('#seat-type').val()
    };
    change(adding ? 'POST' : 'PUT', adding ? roomUrl() + '/ghe' : seatUrl(), payload, $seatMessage, async saved => {
      showSeat(saved);
      showMessage($seatMessage, adding ? 'Đã thêm ghế.' : 'Đã cập nhật ghế.');
      await Promise.all([loadSeats(), loadRooms()]);
    });
  });

  $('#delete-seat').on('click', () => {
    if (!seat || saving || !window.confirm('Xóa ghế ' + seat.MaGhe + '?')) return;
    change('DELETE', seatUrl(), null, $seatMessage, async () => {
      showSeat(null);
      showMessage($seatMessage, 'Đã xóa ghế.');
      await Promise.all([loadSeats(), loadRooms()]);
    });
  });

  $('#logout-button').on('click', () => {
    change('POST', '/api/auth/logout', null, $roomMessage, () => location.assign('dang-nhap.html'));
  });

  syncControls();
  emptyRow($roomRows, 4, 'Đang tải phòng chiếu…');
  $.getJSON('/api/auth/me').done(account => {
    user = account;
    $('#account-name').text(user.HoTen + ' · ' +
      (user.VaiTro === 'QuanTriVien' ? 'Quản trị viên' : 'Nhân viên quầy'));
    $('#logout-button').prop('hidden', false);
    loadRooms();
  }).fail(xhr => {
    emptyRow($roomRows, 4, 'Không tải được thông tin tài khoản.');
    showError($roomMessage, xhr);
  });
})();
