/* global jQuery */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  // Dữ liệu mẫu để xem giao diện. Tên trường khách hàng theo schema SQL.
  const customers = [
    { MaKhachHang: 'KH001', TenKhachHang: 'Nguyễn Văn An', SoDienThoai: '0900000001', Email: 'an@example.com' },
    { MaKhachHang: 'KH002', TenKhachHang: 'Trần Thị Bình', SoDienThoai: '0900000002', Email: 'binh@example.com' },
    { MaKhachHang: 'KH003', TenKhachHang: 'Lê Minh Khoa', SoDienThoai: '0900000003', Email: 'khoa@example.com' },
    { MaKhachHang: 'KH004', TenKhachHang: 'Phạm Ngọc Anh', SoDienThoai: '0900000004', Email: '' }
  ];

  const ticketsByCustomer = {
    KH001: [
      { MaVe: 'V0105', TenPhim: 'Phim A', NgayDat: '25/10/2026' },
      { MaVe: 'V0051', TenPhim: 'Phim B', NgayDat: '12/10/2026' }
    ],
    KH002: [{ MaVe: 'V0106', TenPhim: 'Phim C', NgayDat: '25/10/2026' }]
  };

  const $customerRows = $('#customer-rows');
  const $ticketRows = $('#ticket-rows');
  const $form = $('#customer-form');
  const $message = $('#customer-message');
  const $search = $('#customer-search');
  let selectedId = '';

  function showEmptyRow($tableBody, colspan, message) {
    $tableBody.append($('<tr>').append($('<td>', { colspan, text: message })));
  }

  function normalizeSearch(value) {
    return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
  }

  function renderCustomers() {
    const keyword = normalizeSearch($search.val());
    const matches = customers.filter(customer =>
      Object.values(customer).some(value => normalizeSearch(value).includes(keyword))
    );

    $customerRows.empty();
    $('#customer-count').text(matches.length + '/' + customers.length + ' khách hàng');

    if (matches.length === 0) {
      showEmptyRow($customerRows, 4, 'Không tìm thấy khách hàng.');
    }

    for (const customer of matches) {
      const $button = $('<button>', {
        type: 'button',
        class: 'customer-selector',
        text: customer.MaKhachHang,
        'data-customer-id': customer.MaKhachHang,
        'aria-pressed': String(customer.MaKhachHang === selectedId)
      });

      $customerRows.append($('<tr>')
        .toggleClass('is-selected', customer.MaKhachHang === selectedId)
        .append($('<td>').append($button))
        .append($('<td>').text(customer.TenKhachHang))
        .append($('<td>').text(customer.SoDienThoai))
        .append($('<td>').text(customer.Email || '—')));
    }
  }

  function renderTickets() {
    $ticketRows.empty();

    if (!selectedId) {
      showEmptyRow($ticketRows, 3, 'Chọn một khách hàng để xem lịch sử.');
      return;
    }

    const tickets = ticketsByCustomer[selectedId] || [];
    if (tickets.length === 0) {
      showEmptyRow($ticketRows, 3, 'Khách hàng chưa có lịch sử mua vé.');
    }

    for (const ticket of tickets) {
      $ticketRows.append($('<tr>')
        .append($('<td>').text(ticket.MaVe))
        .append($('<td>').text(ticket.TenPhim))
        .append($('<td>').text(ticket.NgayDat)));
    }
  }

  function selectCustomer(customer) {
    selectedId = customer ? customer.MaKhachHang : '';
    $form[0].reset();
    $message.empty();

    if (customer) {
      for (const [field, value] of Object.entries(customer)) {
        $form[0].elements.namedItem(field).value = value;
      }
    }

    $('#customer-id').prop('readOnly', Boolean(customer));
    $form.find('button[value="them"]').prop('disabled', Boolean(customer));
    $form.find('button[value="sua"], #delete-customer').prop('disabled', !customer);

    $customerRows.find('.customer-selector').each(function () {
      const isSelected = this.dataset.customerId === selectedId;
      $(this).attr('aria-pressed', String(isSelected)).closest('tr').toggleClass('is-selected', isSelected);
    });

    renderTickets();
  }

  $search.on('input', renderCustomers);
  $customerRows.on('click', 'tr', function () {
    const id = $(this).find('.customer-selector').attr('data-customer-id');
    const customer = customers.find(item => item.MaKhachHang === id);
    if (customer) selectCustomer(customer);
  });

  $('#clear-customer').on('click', () => {
    selectCustomer(null);
    $('#customer-id').trigger('focus');
  });

  $form.on('submit', event => {
    event.preventDefault();
    const action = selectedId ? 'sửa' : 'thêm';
    $message.text('Nút ' + action + ' đang ở chế độ xem thử.');
  });

  $('#delete-customer').on('click', () => {
    $message.text('Nút xóa đang ở chế độ xem thử.');
  });

  $search.add('#clear-customer').prop('disabled', false);
  renderCustomers();
  selectCustomer(null);
})();
