/* global jQuery */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  const roomTypes = ['2D', '3D'];
  const seatStatuses = {
    Trong: 'Trống',
    DaDat: 'Đã đặt',
    BaoTri: 'Bảo trì'
  };
  const rooms = [
    { MaPhong: 'PC01', TenPhong: 'Phòng 01', LoaiPhong: '2D' },
    { MaPhong: 'PC02', TenPhong: 'Phòng 02', LoaiPhong: '2D' },
    { MaPhong: 'PC03', TenPhong: 'Phòng 03', LoaiPhong: '3D' }
  ];
  const seats = [];
  let nextSeatNumber = 1;
  let selectedRoomId = '';
  let selectedSeatId = '';
  let roomMode = 'idle';
  let seatMode = 'idle';

  // Tạo dữ liệu xem thử theo mẫu SQL: 4 hàng, 5 ghế mỗi hàng trong một phòng.
  for (const room of rooms) {
    for (let index = 0; index < 20; index++) {
      const row = String.fromCharCode(65 + Math.floor(index / 5));
      const number = index % 5 + 1;
      seats.push({
        MaGhe: 'G' + String(nextSeatNumber).padStart(3, '0'),
        MaPhong: room.MaPhong,
        SoHang: row,
        SoGhe: number,
        TrangThai: nextSeatNumber % 17 === 0 ? 'BaoTri' : 'Trong'
      });
      nextSeatNumber++;
    }
  }

  const $roomForm = $('#room-form');
  const $seatForm = $('#seat-form');
  const $roomRows = $('#room-rows');
  const $seatRows = $('#seat-rows');

  function emptyRow($body, colspan, message) {
    $body.append($('<tr>').append($('<td>', { colspan, text: message })));
  }

  function roomById(id) {
    return rooms.find(room => room.MaPhong === id);
  }

  function roomSeats(roomId) {
    return seats.filter(seat => seat.MaPhong === roomId);
  }

  function roomSeatCount(roomId) {
    return roomSeats(roomId).length;
  }

  function showMessage(selector, message, isError = false) {
    $(selector).toggleClass('text-danger', isError).text(message);
  }

  function setRoomMode(mode) {
    roomMode = mode;
    const selected = mode === 'selected';
    const editing = mode === 'editing';
    const adding = mode === 'adding';
    $('#room-id').prop('readOnly', selected || editing || adding).prop('disabled', mode === 'idle');
    $('#room-name, #room-type').prop('disabled', mode === 'idle');
    $('#room-seat-count').prop('disabled', mode === 'idle').prop('readOnly', selected || editing);
    $('#add-room').prop('disabled', selected || editing || adding);
    $('#save-room').prop('disabled', !editing && !adding);
    $('#edit-room, #delete-room').prop('disabled', !selected);
    $('#clear-room').prop('disabled', mode === 'idle');
  }

  function setSeatMode(mode) {
    seatMode = mode;
    const canEdit = Boolean(selectedRoomId) && (mode === 'adding' || mode === 'editing');
    const isSelected = mode === 'selected';
    $('#add-seat').text(mode === 'adding' ? 'Lưu ghế' : 'Thêm');
    $('#edit-seat').text(mode === 'editing' ? 'Lưu sửa' : 'Sửa');
    $('#seat-id, #seat-room').prop('disabled', !selectedRoomId);
    $('#seat-row, #seat-number, #seat-status').prop('disabled', !canEdit);
    $('#seat-id').prop('readOnly', true);
    $('#add-seat').prop('disabled', !selectedRoomId || isSelected || mode === 'editing');
    $('#edit-seat, #delete-seat').prop('disabled', !isSelected);
  }

  function updateRoomCount() {
    $('#room-count').text(rooms.length + ' phòng');
  }

  function renderRooms() {
    $roomRows.empty();
    updateRoomCount();
    if (!rooms.length) emptyRow($roomRows, 4, 'Chưa có phòng chiếu.');

    for (const room of rooms) {
      const $id = $('<button>', {
        type: 'button', class: 'room-selector', text: room.MaPhong,
        'data-room-id': room.MaPhong, 'aria-pressed': String(room.MaPhong === selectedRoomId)
      });
      $roomRows.append($('<tr>')
        .toggleClass('is-selected', room.MaPhong === selectedRoomId)
        .attr('data-room-id', room.MaPhong)
        .append($('<td>').append($id))
        .append($('<td>').text(room.TenPhong))
        .append($('<td>').text(roomSeatCount(room.MaPhong)))
        .append($('<td>').text(room.LoaiPhong)));
    }
  }

  function renderSeats() {
    $seatRows.empty();
    const visibleSeats = roomSeats(selectedRoomId);
    $('#seat-count').text(selectedRoomId ? visibleSeats.length + ' ghế' : '');
    if (!selectedRoomId) {
      emptyRow($seatRows, 5, 'Chọn một phòng để xem danh sách ghế.');
      return;
    }
    if (!visibleSeats.length) emptyRow($seatRows, 5, 'Phòng này chưa có ghế.');

    for (const seat of visibleSeats) {
      const $id = $('<button>', {
        type: 'button', class: 'seat-selector', text: seat.MaGhe,
        'data-seat-id': seat.MaGhe, 'aria-pressed': String(seat.MaGhe === selectedSeatId)
      });
      $seatRows.append($('<tr>')
        .toggleClass('is-selected', seat.MaGhe === selectedSeatId)
        .attr('data-seat-id', seat.MaGhe)
        .append($('<td>').append($id))
        .append($('<td>').text(seat.MaPhong))
        .append($('<td>').text(seat.SoHang))
        .append($('<td>').text(seat.SoGhe))
        .append($('<td>').text(seatStatuses[seat.TrangThai] || seat.TrangThai)));
    }
  }

  function resetRoomForm() {
    $roomForm[0].reset();
    $('#room-id').val('').prop('readOnly', false);
    $('#room-seat-count').val('').prop('readOnly', false);
    setRoomMode('idle');
    showMessage('#room-message', '');
  }

  function resetSeatForm() {
    $seatForm[0].reset();
    $('#seat-room').val(selectedRoomId);
    $('#seat-id').val('');
    $('#seat-status').val('Trong');
    setSeatMode(selectedRoomId ? 'idle' : 'idle');
    showMessage('#seat-message', '');
  }

  function selectRoom(room) {
    selectedRoomId = room ? room.MaPhong : '';
    selectedSeatId = '';
    resetRoomForm();
    resetSeatForm();
    $('#selected-room-label').text(room ? '— ' + room.MaPhong : '');

    if (room) {
      $('#room-id').val(room.MaPhong);
      $('#room-name').val(room.TenPhong);
      $('#room-seat-count').val(roomSeatCount(room.MaPhong));
      $('#room-type').val(room.LoaiPhong);
      setRoomMode('selected');
    }
    renderRooms();
    renderSeats();
  }

  function selectSeat(seat) {
    selectedSeatId = seat ? seat.MaGhe : '';
    resetSeatForm();
    if (seat) {
      $('#seat-id').val(seat.MaGhe);
      $('#seat-room').val(seat.MaPhong);
      $('#seat-row').val(seat.SoHang);
      $('#seat-number').val(seat.SoGhe);
      $('#seat-status').val(seat.TrangThai);
      setSeatMode('selected');
    }
    renderSeats();
  }

  function nextRoomId() {
    let number = 1;
    while (roomById('PC' + String(number).padStart(2, '0'))) number++;
    return 'PC' + String(number).padStart(2, '0');
  }

  function nextSeatId() {
    while (seats.some(seat => seat.MaGhe === 'G' + String(nextSeatNumber).padStart(3, '0'))) nextSeatNumber++;
    return 'G' + String(nextSeatNumber++).padStart(3, '0');
  }

  function createInitialSeats(roomId, count) {
    for (let index = 0; index < count; index++) {
      seats.push({
        MaGhe: nextSeatId(), MaPhong: roomId,
        SoHang: String.fromCharCode(65 + Math.floor(index / 5)),
        SoGhe: index % 5 + 1, TrangThai: 'Trong'
      });
    }
  }

  $('#room-rows').on('click', '[data-room-id]', function () {
    const room = roomById(this.dataset.roomId);
    if (room) selectRoom(room);
  });

  $('#seat-rows').on('click', '[data-seat-id]', function () {
    const seat = seats.find(item => item.MaGhe === this.dataset.seatId);
    if (seat) selectSeat(seat);
  });

  $('#add-room').on('click', () => {
    selectedRoomId = '';
    selectedSeatId = '';
    resetRoomForm();
    resetSeatForm();
    $('#selected-room-label').empty();
    renderRooms();
    renderSeats();
    $('#room-id').val(nextRoomId());
    $('#room-seat-count').val(20);
    $('#room-type').val(roomTypes[0]);
    setRoomMode('adding');
    showMessage('#room-message', 'Khi thêm phòng, hệ thống tạo vị trí ghế theo số lượng đã nhập.');
    $('#room-name').trigger('focus');
  });

  $('#edit-room').on('click', () => {
    const room = roomById(selectedRoomId);
    if (!room) return;
    $('#room-name, #room-type').prop('disabled', false);
    $('#room-seat-count').val(roomSeatCount(room.MaPhong)).prop('disabled', false).prop('readOnly', true);
    $('#save-room').prop('disabled', false);
    $('#edit-room, #delete-room, #add-room').prop('disabled', true);
    roomMode = 'editing';
    showMessage('#room-message', 'Sửa tên phòng hoặc loại phòng rồi chọn Lưu.');
  });

  $roomForm.on('submit', event => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const id = $('#room-id').val().trim().toUpperCase();
    const name = $('#room-name').val().trim();
    const type = $('#room-type').val();
    if (roomMode === 'adding' && !selectedRoomId) {
      const seatCount = Number($('#room-seat-count').val());
      if (rooms.some(room => room.MaPhong === id)) {
        showMessage('#room-message', 'Mã phòng đã tồn tại.', true);
        return;
      }
      if (rooms.some(room => room.TenPhong.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) {
        showMessage('#room-message', 'Tên phòng đã được sử dụng.', true);
        return;
      }
      const room = { MaPhong: id, TenPhong: name, LoaiPhong: type };
      rooms.push(room);
      createInitialSeats(id, seatCount);
      renderRooms();
      selectRoom(room);
      showMessage('#room-message', 'Đã thêm phòng và ' + seatCount + ' ghế mẫu.');
      return;
    }
    const room = roomById(selectedRoomId);
    if (!room || roomMode !== 'editing') return;
    if (rooms.some(item => item !== room && item.TenPhong.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) {
      showMessage('#room-message', 'Tên phòng đã được sử dụng.', true);
      return;
    }
    room.TenPhong = name;
    room.LoaiPhong = type;
    selectRoom(room);
    showMessage('#room-message', 'Đã cập nhật phòng trong phiên xem trang.');
  });

  $('#delete-room').on('click', () => {
    const room = roomById(selectedRoomId);
    if (!room) return;
    if (!window.confirm('Xóa ' + room.MaPhong + ' và toàn bộ ghế mẫu thuộc phòng này?')) return;
    const deletedSeats = roomSeats(room.MaPhong);
    for (const seat of deletedSeats) seats.splice(seats.indexOf(seat), 1);
    rooms.splice(rooms.indexOf(room), 1);
    selectRoom(null);
    showMessage('#room-message', 'Đã xóa phòng và ' + deletedSeats.length + ' ghế mẫu trong phiên xem trang.');
  });

  $('#clear-room').on('click', () => selectRoom(null));

  $('#add-seat').on('click', () => {
    if (!selectedRoomId) return;
    if (seatMode === 'adding') {
      saveSeat();
      return;
    }
    selectedSeatId = '';
    resetSeatForm();
    $('#seat-id').val(nextSeatId());
    $('#seat-room').val(selectedRoomId);
    $('#seat-row, #seat-number, #seat-status').prop('disabled', false);
    $('#seat-status').val('Trong');
    $('#add-seat').prop('disabled', true);
    $('#add-seat').text('Lưu ghế');
    seatMode = 'adding';
    showMessage('#seat-message', 'Nhập hàng và số ghế rồi chọn Thêm.');
    $('#seat-row').trigger('focus');
  });

  $('#edit-seat').on('click', () => {
    if (!selectedSeatId) return;
    if (seatMode === 'editing') {
      saveSeat();
      return;
    }
    $('#seat-row, #seat-number, #seat-status').prop('disabled', false);
    $('#edit-seat, #delete-seat, #add-seat').prop('disabled', true);
    $('#edit-seat').prop('disabled', false).text('Lưu sửa');
    seatMode = 'editing';
    showMessage('#seat-message', 'Cập nhật vị trí hoặc trạng thái ghế rồi chọn Sửa.');
  });

  function saveSeat() {
    if (!selectedRoomId || !$('#seat-form')[0].reportValidity()) return;
    const id = $('#seat-id').val();
    const seat = seats.find(item => item.MaGhe === id);
    const candidate = {
      MaGhe: id,
      MaPhong: selectedRoomId,
      SoHang: $('#seat-row').val().trim().toUpperCase(),
      SoGhe: Number($('#seat-number').val()),
      TrangThai: $('#seat-status').val()
    };
    const duplicate = seats.some(item => item.MaPhong === candidate.MaPhong
      && item.SoHang.toLocaleLowerCase('vi') === candidate.SoHang.toLocaleLowerCase('vi')
      && Number(item.SoGhe) === candidate.SoGhe && item.MaGhe !== id);
    if (duplicate) {
      showMessage('#seat-message', 'Vị trí hàng và ghế này đã tồn tại trong phòng.', true);
      return;
    }
    if (seatMode === 'adding') {
      seats.push(candidate);
      selectSeat(candidate);
      renderRooms();
      showMessage('#seat-message', 'Đã thêm ghế trong phiên xem trang.');
    } else if (seatMode === 'editing' && seat) {
      Object.assign(seat, candidate);
      selectSeat(seat);
      renderRooms();
      showMessage('#seat-message', 'Đã cập nhật ghế trong phiên xem trang.');
    }
  }

  $('#seat-form').on('submit', event => {
    event.preventDefault();
    saveSeat();
  });

  $('#delete-seat').on('click', () => {
    const seat = seats.find(item => item.MaGhe === selectedSeatId);
    if (!seat) return;
    if (!window.confirm('Xóa ghế ' + seat.MaGhe + '?')) return;
    seats.splice(seats.indexOf(seat), 1);
    selectedSeatId = '';
    resetSeatForm();
    renderSeats();
    renderRooms();
    showMessage('#seat-message', 'Đã xóa ghế trong phiên xem trang.');
  });

  selectRoom(null);
  renderRooms();
  setRoomMode('idle');
})();
