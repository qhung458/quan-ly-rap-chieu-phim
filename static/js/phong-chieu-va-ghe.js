/* global jQuery */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  const api = '/api/phong-chieu';
  const $roomForm = $('#room-form');
  const $seatForm = $('#seat-form');
  const $roomRows = $('#room-rows');
  const $seatRows = $('#seat-rows');
  const $roomMessage = $('#room-message');
  const $seatMessage = $('#seat-message');
  const $roomSeatCount = $('#room-seat-count');
  const $seatsPerRow = $('#room-seats-per-row');

  let user;
  let rooms = [];
  let seats = [];
  let room = null;
  let seat = null;
  let roomMode = '';
  let seatMode = '';
  let roomsLoading = false;
  let seatsLoading = false;
  let saving = false;
  let seatRequest = 0;

  function showMessage($element, message, isError = false) {
    $element.toggleClass('text-danger', isError).text(message);
  }

  function showError($element, xhr) {
    if (xhr.status === 401) {
      location.assign('dang-nhap.html');
      return;
    }
    showMessage($element, xhr.responseJSON?.message || 'Không kết nối được máy chủ.', true);
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

    $('#seat-row, #seat-number').prop('disabled', !seatEditing);
    $('#add-seat').text(seatMode === 'add' ? 'Lưu ghế' : 'Thêm')
      .prop('disabled', !canManageSeats || seatMode === 'edit');
    $('#edit-seat').text(seatMode === 'edit' ? 'Lưu sửa' : 'Sửa')
      .prop('disabled', !canManageSeats || !seat || seatMode === 'add');
    $('#delete-seat').prop('disabled', !canManageSeats || !canDelete || !seat || Boolean(seatMode));
    $('#clear-seat').prop('disabled', !canManageSeats || (!seat && !seatMode));
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

  function renderRooms() {
    $roomRows.empty();
    $('#room-count').text(rooms.length + ' phòng');
    if (!rooms.length) emptyRow($roomRows, 4, 'Chưa có phòng chiếu.');
    for (const item of rooms) {
      $roomRows.append(recordRow(item.MaPhong, 'room', item.MaPhong === room?.MaPhong,
        [item.TenPhong, item.SoGhe, item.LoaiPhong]));
    }
  }

  function renderSeats() {
    $seatRows.empty();
    $('#seat-count').text(room ? seats.length + ' ghế' : '');
    if (!room) return emptyRow($seatRows, 4, 'Chọn một phòng để xem danh sách ghế.');
    if (!seats.length) emptyRow($seatRows, 4, 'Phòng này chưa có ghế.');
    for (const item of seats) {
      $seatRows.append(recordRow(item.MaGhe, 'seat', item.MaGhe === seat?.MaGhe,
        [item.MaPhong, item.SoHang, item.SoGhe]));
    }
  }

  function showRoom(item) {
    room = item;
    roomMode = '';
    $roomForm[0].reset();
    $('#room-id').val(room?.MaPhong ?? '');
    $('#room-name').val(room?.TenPhong ?? '');
    $roomSeatCount.val(room?.SoGhe ?? '');
    if (room) $('#room-type').val(room.LoaiPhong);
    $('#selected-room-label').text(room ? '— ' + room.MaPhong : '');
    renderRooms();
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
    syncControls();
  }

  async function loadRooms() {
    roomsLoading = true;
    syncControls();
    $('#room-count').empty();
    emptyRow($roomRows, 4, 'Đang tải phòng chiếu…');
    try {
      rooms = await $.getJSON(api);
      renderRooms();
    } catch (xhr) {
      emptyRow($roomRows, 4, 'Không tải được danh sách phòng. Chọn Làm mới để thử lại.');
      showError($roomMessage, xhr);
    } finally {
      roomsLoading = false;
      syncControls();
    }
  }

  async function loadSeats(selectedCode) {
    const request = ++seatRequest;
    seats = [];
    seatsLoading = Boolean(room);
    showSeat(null);
    if (!room) return renderSeats();

    $('#seat-count').empty();
    emptyRow($seatRows, 4, 'Đang tải ghế…');
    try {
      const rows = await $.getJSON(roomUrl() + '/ghe');
      if (request !== seatRequest) return;
      seats = rows;
      room.SoGhe = seats.length;
      if (!roomMode) $roomSeatCount.val(room.SoGhe);
      renderRooms();
      showSeat(seats.find(item => item.MaGhe === selectedCode) ?? null);
      renderSeats();
    } catch (xhr) {
      if (request !== seatRequest) return;
      emptyRow($seatRows, 4, 'Không tải được ghế. Chọn lại phòng để thử lại.');
      showError($seatMessage, xhr);
    } finally {
      if (request === seatRequest) {
        seatsLoading = false;
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
    showMessage($roomMessage, '');
    showMessage($seatMessage, '');
    showRoom(item);
    return loadSeats();
  }

  $roomRows.on('click', 'tr[data-room-id]', function () {
    if (!saving && !roomsLoading) selectRoom(rooms.find(item => item.MaPhong === this.dataset.roomId));
  });

  $seatRows.on('click', 'tr[data-seat-id]', function () {
    if (saving || seatsLoading || roomsLoading) return;
    showMessage($seatMessage, '');
    showSeat(seats.find(item => item.MaGhe === this.dataset.seatId));
    renderSeats();
  });

  $('#add-room').on('click', () => {
    selectRoom(null);
    let number = 1;
    const used = new Set(rooms.map(item => item.MaPhong.toUpperCase()));
    const suggestedCode = () => 'PC' + String(number).padStart(2, '0');
    while (used.has(suggestedCode())) number++;
    roomMode = 'add';
    $('#room-id').val(suggestedCode());
    $roomSeatCount.val(20).trigger('input');
    syncControls();
    $('#room-name').trigger('focus');
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
      payload.MaPhong = $('#room-id').val();
      payload.SoGhe = Number($roomSeatCount.val());
      if ($seatsPerRow.val() !== '') payload.SoGheMoiHang = Number($seatsPerRow.val());
    }
    change(adding ? 'POST' : 'PUT', adding ? api : roomUrl(), payload, $roomMessage, async saved => {
      rooms = rooms.filter(item => item.MaPhong !== saved.MaPhong);
      rooms.push(saved);
      rooms.sort((a, b) => a.MaPhong.localeCompare(b.MaPhong));
      showRoom(saved);
      showMessage($roomMessage, adding ? 'Đã thêm phòng và ' + saved.SoGhe + ' ghế.' : 'Đã cập nhật phòng.');
      if (adding) await loadSeats();
    });
  });

  $('#delete-room').on('click', () => {
    if (!room || saving || !window.confirm('Xóa phòng ' + room.MaPhong + ' và toàn bộ ghế trong phòng?')) return;
    change('DELETE', roomUrl(), null, $roomMessage, async () => {
      rooms = rooms.filter(item => item.MaPhong !== room.MaPhong);
      await selectRoom(null);
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
    renderSeats();
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
    renderSeats();
  });

  $seatForm.on('submit', event => {
    event.preventDefault();
    if (!room || !seatMode || saving || seatsLoading || !event.currentTarget.reportValidity()) return;
    const adding = seatMode === 'add';
    const payload = {
      SoHang: $('#seat-row').val(),
      SoGhe: Number($('#seat-number').val())
    };
    change(adding ? 'POST' : 'PUT', adding ? roomUrl() + '/ghe' : seatUrl(), payload, $seatMessage, async saved => {
      showMessage($seatMessage, adding ? 'Đã thêm ghế.' : 'Đã cập nhật ghế.');
      await loadSeats(saved.MaGhe);
    });
  });

  $('#delete-seat').on('click', () => {
    if (!seat || saving || !window.confirm('Xóa ghế ' + seat.MaGhe + '?')) return;
    change('DELETE', seatUrl(), null, $seatMessage, async () => {
      showMessage($seatMessage, 'Đã xóa ghế.');
      await loadSeats();
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
