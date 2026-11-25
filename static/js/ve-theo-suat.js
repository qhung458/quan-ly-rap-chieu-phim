'use strict';

window.ShowTicketList = (() => {
  const defaultSort = 'ngayDat:desc';
  const statuses = { DaDat: 'Đã đặt', DaSuDung: 'Đã sử dụng', DaHuy: 'Đã hủy' };
  const sortLabels = { ngayDat: 'Ngày đặt', viTri: 'Vị trí ghế', maVe: 'Mã vé' };
  const conditionLabels = {
    q: 'Từ khóa', maVe: 'Mã vé', maKhachHang: 'Mã khách', soDienThoai: 'SĐT', hang: 'Hàng ghế',
    soGhe: 'Số ghế', tuNgay: 'Đặt từ ngày', denNgay: 'Đặt đến ngày', trangThai: 'Trạng thái'
  };
  const price = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 2 });
  const counterColumns = ['Mã vé', 'Mã KH', 'Tên khách hàng', 'Ghế', 'Ngày đặt', 'Giá vé', 'Trạng thái'];
  const reviewColumns = ['Mã vé', 'Mã suất chiếu', 'Ghế', 'Ngày đặt', 'Giá', 'Trạng thái', 'Mã khách'];

  function bookingKey(ticket) {
    return ticket ? JSON.stringify([ticket.MaVe, ticket.MaSuatChieu, ticket.MaKhachHang, ticket.MaGhe]) : null;
  }

  function mount(root, { onSelect, exportId } = {}) {
    const counter = typeof onSelect === 'function';
    root.innerHTML = `
      <form class="show-ticket-query">
        <fieldset disabled aria-label="Điều kiện danh sách vé">
          <label>Tìm vé hoặc khách
            <input class="form-control form-control-sm" name="q" type="search" maxlength="100"
              placeholder="Mã vé, mã khách, tên khách hoặc SĐT">
          </label>
          <details class="show-ticket-advanced">
            <summary>Tìm nâng cao</summary>
            <div class="show-ticket-grid">
              <label>Mã vé<input class="form-control form-control-sm" name="maVe" maxlength="15"></label>
              <label>Cách so mã vé<select class="form-select form-select-sm" name="maVeMode">
                <option value="contains">Chứa</option><option value="exact">Chính xác</option>
              </select></label>
              <label>Mã khách<input class="form-control form-control-sm" name="maKhachHang" maxlength="10"></label>
              <label>Cách so mã khách<select class="form-select form-select-sm" name="maKhachHangMode">
                <option value="contains">Chứa</option><option value="exact">Chính xác</option>
              </select></label>
              <label>SĐT chính xác<input class="form-control form-control-sm" name="soDienThoai" type="tel" maxlength="30"></label>
              <label>Hàng ghế<input class="form-control form-control-sm" name="hang" maxlength="5"></label>
              <label>Số ghế<input class="form-control form-control-sm" name="soGhe" type="number" min="1" max="2147483647"></label>
              <label>Đặt từ ngày<input class="form-control form-control-sm" name="tuNgay" type="date"></label>
              <label>Đặt đến ngày<input class="form-control form-control-sm" name="denNgay" type="date"></label>
              <fieldset class="show-ticket-statuses">
                <legend>Trạng thái</legend>
                <div class="show-ticket-actions">
                  ${Object.entries(statuses).map(([value, label]) => `<label><input class="form-check-input" type="checkbox" name="trangThai" value="${value}"> ${label}</label>`).join('')}
                </div>
              </fieldset>
            </div>
          </details>
          <div class="show-ticket-grid">
            <label>Sắp xếp theo<select class="form-select form-select-sm" data-sort-main>
              ${Object.entries(sortLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
            </select></label>
            <label>Chiều chính<select class="form-select form-select-sm" data-sort-main-dir>
              <option value="asc">Tăng dần</option><option value="desc">Giảm dần</option>
            </select></label>
            <label>Tiêu chí phụ<select class="form-select form-select-sm" data-sort-extra>
              <option value="">Không chọn</option>
            </select></label>
            <label>Chiều phụ<select class="form-select form-select-sm" data-sort-extra-dir>
              <option value="asc">Tăng dần</option><option value="desc">Giảm dần</option>
            </select></label>
          </div>
          <div class="show-ticket-actions">
            <button class="btn btn-dark btn-sm" type="submit">Áp dụng</button>
            <button class="btn btn-outline-secondary btn-sm" type="button" data-query-reset>Đặt lại</button>
            <button class="btn btn-outline-secondary btn-sm" type="button" data-query-refresh>Tải lại</button>
          </div>
          <ul class="show-ticket-chips" data-query-conditions aria-label="Điều kiện vé đang áp dụng" hidden></ul>
        </fieldset>
      </form>
      <p class="small text-secondary mb-1" data-ticket-count role="status"></p>
      <div class="table-responsive">
        <table class="table align-middle show-ticket-table mb-0" aria-label="Vé của suất chiếu">
          <thead><tr>${(counter ? counterColumns : reviewColumns).map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>
          <tbody data-ticket-rows></tbody>
        </table>
      </div>
      <nav class="show-ticket-pages mt-3" aria-label="Phân trang vé" hidden>
        <button class="btn btn-outline-secondary btn-sm" type="button" data-page-prev>Trang trước</button>
        <span class="small" data-page-position role="status"></span>
        <button class="btn btn-outline-secondary btn-sm" type="button" data-page-next>Trang sau</button>
      </nav>`;
    const form = root.querySelector('form');
    const filters = Array.from(form.querySelectorAll('input[name], select[name]'));
    const checkboxFields = filters.filter(field => field.type === 'checkbox');
    const fieldset = form.querySelector('fieldset');
    const chips = root.querySelector('[data-query-conditions]');
    const count = root.querySelector('[data-ticket-count]');
    const table = root.querySelector('table');
    const body = root.querySelector('[data-ticket-rows]');
    const pagination = root.querySelector('nav');
    const previous = root.querySelector('[data-page-prev]');
    const next = root.querySelector('[data-page-next]');
    const position = root.querySelector('[data-page-position]');
    const mainSort = root.querySelector('[data-sort-main]');
    const mainDirection = root.querySelector('[data-sort-main-dir]');
    const extraSort = root.querySelector('[data-sort-extra]');
    const extraDirection = root.querySelector('[data-sort-extra-dir]');
    let show = '';
    let idleMessage = 'Chọn suất chiếu để xem vé.';
    let selectedKey = null;
    let selectionEnabled = false;
    let rows = [];
    let showRequest;

    for (const option of mainSort.options) extraSort.append(option.cloneNode(true));
    const endpoint = () => '/api/ban-ve/suat-chieu/' + encodeURIComponent(show) + '/ve';
    const controller = ListQuery.create({
      defaults: { sort: defaultSort },
      load: (params, context) => ListQuery.loadFrom(endpoint())(params, context),
      onChange: render
    });
    const enableExport = exportId ? ExcelExport.bindDownload(exportId, () => ({
      url: endpoint() + '/xuat', filename: 've-' + show, snapshotId: controller.getSnapshotId()
    })) : undefined;

    function syncSort() {
      if (extraSort.value === mainSort.value) extraSort.value = '';
      for (const option of extraSort.options) option.disabled = option.value === mainSort.value;
      extraDirection.disabled = !extraSort.value;
    }

    function readDraft() {
      const draft = Object.fromEntries(filters.filter(field => field.type !== 'checkbox')
        .map(field => [field.name, field.value.trim()]));
      draft.trangThai = checkboxFields.filter(field => field.checked).map(field => field.value);
      // Keep the mode as a draft field even when its code is empty.
      draft.sort = `${mainSort.value}:${mainDirection.value}` +
        (extraSort.value ? `,${extraSort.value}:${extraDirection.value}` : '');
      return draft;
    }

    function writeDraft(draft) {
      for (const field of filters) {
        if (field.type === 'checkbox') field.checked = draft.trangThai?.includes(field.value) ?? false;
        else field.value = draft[field.name] ?? (field.name.endsWith('Mode') ? 'contains' : '');
      }
      const [main, extra = ''] = (draft.sort || defaultSort).split(',');
      [mainSort.value, mainDirection.value] = main.split(':');
      [extraSort.value, extraDirection.value = 'asc'] = extra.split(':');
      syncSort();
    }

    function chipLabel(name, value, applied) {
      if (name === 'sort') {
        return 'Sắp xếp · ' + value.split(',').map(item => {
          const [field, direction] = item.split(':');
          return sortLabels[field] + (direction === 'asc' ? ' tăng' : ' giảm');
        }).join(', rồi ');
      }
      const mode = (name === 'maVe' || name === 'maKhachHang')
        ? (applied[name + 'Mode'] === 'exact' ? ' chính xác' : ' chứa') : '';
      return `${conditionLabels[name]}${mode} · ${name === 'trangThai' ? statuses[value] : value}`;
    }

    function renderConditions(applied) {
      chips.replaceChildren();
      for (const [name, values] of Object.entries(applied)) {
        if (!values || name.endsWith('Mode') || (name === 'sort' && values === defaultSort)) continue;
        for (const value of Array.isArray(values) ? values : [values]) {
          const label = chipLabel(name, value, applied);
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'btn btn-outline-secondary btn-sm';
          chip.textContent = label + ' ×';
          chip.setAttribute('aria-label', 'Bỏ điều kiện ' + label);
          chip.addEventListener('click', () => {
            controller.setDraft(readDraft());
            controller.remove(name, value);
            writeDraft(controller.getState().draft);
            form.querySelector('button[type="submit"]').focus();
          });
          const item = document.createElement('li');
          item.append(chip);
          chips.append(item);
        }
      }
      chips.hidden = !chips.children.length;
    }

    function renderSelection() {
      for (const { row, button, key } of rows) {
        row.classList.toggle('is-selected', key === selectedKey);
        button.setAttribute('aria-pressed', String(key === selectedKey));
        button.disabled = !selectionEnabled;
        row.toggleAttribute('data-ticket-selectable', selectionEnabled);
      }
    }

    function renderRows(items) {
      for (const ticket of items) {
        const row = body.insertRow();
        const first = row.insertCell();
        const seat = `${ticket.SoHang}-${ticket.SoGhe}`;
        const status = statuses[ticket.TrangThai] ?? ticket.TrangThai;
        if (counter) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'customer-selector ticket-selector';
          button.textContent = ticket.MaVe;
          row.dataset.ticketId = ticket.MaVe;
          row.addEventListener('click', () => { if (selectionEnabled) onSelect(ticket); });
          rows.push({ row, button, key: bookingKey(ticket) });
          first.append(button);
        } else {
          first.textContent = ticket.MaVe;
        }
        const values = counter
          ? [ticket.MaKhachHang, ticket.TenKhachHang, `${seat} · ${ticket.MaGhe}`, ticket.NgayDat, price.format(ticket.GiaVe), status]
          : [ticket.MaSuatChieu, seat, ticket.NgayDat, price.format(ticket.GiaVe), status, ticket.MaKhachHang];
        for (const value of values) row.insertCell().textContent = value;
      }
      renderSelection();
    }

    function render(state) {
      const ready = state.status === 'ready';
      enableExport?.(ready && Boolean(state.snapshotId));
      fieldset.disabled = !show;
      renderConditions(state.applied);
      table.setAttribute('aria-busy', String(state.status === 'loading'));
      count.textContent = ready || state.status === 'empty' ? `${state.total} vé` : '';
      const pages = Math.ceil(state.total / state.pageSize);
      pagination.hidden = !ready || pages <= 1;
      previous.disabled = !ready || state.page <= 1;
      next.disabled = !ready || state.page >= pages;
      position.textContent = pages > 1 ? `Trang ${state.page} / ${pages}` : '';

      body.replaceChildren();
      rows = [];
      if (ready) {
        renderRows(state.items);
        return;
      }
      if (state.status === 'error' && state.error.status === 401) location.assign('dang-nhap.html');
      const messages = {
        idle: idleMessage,
        loading: 'Đang tải vé…',
        empty: state.meta?.hasTickets === false ? 'Suất chiếu này chưa có vé.' : 'Không tìm thấy vé phù hợp.',
        error: state.error?.message
      };
      const cell = body.insertRow().insertCell();
      cell.colSpan = 7;
      cell.textContent = messages[state.status] ?? '';
    }

    function setShow(code, message = 'Chọn suất chiếu để xem vé.') {
      idleMessage = message;
      const requestedShow = code || '';
      if (show === requestedShow) {
        if (!show) render(controller.getState());
        return showRequest;
      }
      show = requestedShow;
      controller.clear();
      writeDraft(controller.getState().draft);
      showRequest = show ? controller.refresh() : undefined;
      return showRequest;
    }

    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!show) return;
      controller.setDraft(readDraft());
      controller.apply();
    });
    form.querySelector('[data-query-reset]').addEventListener('click', () => {
      if (!show) return;
      controller.reset();
      writeDraft(controller.getState().draft);
    });
    form.querySelector('[data-query-refresh]').addEventListener('click', () => { if (show) controller.refresh(); });
    mainSort.addEventListener('change', syncSort);
    extraSort.addEventListener('change', syncSort);
    previous.addEventListener('click', () => controller.goToPage(controller.getState().page - 1));
    next.addEventListener('click', () => controller.goToPage(controller.getState().page + 1));
    writeDraft(controller.getState().draft);
    render(controller.getState());

    return {
      setShow,
      refresh() { if (show) return controller.refresh(); },
      setSelected(ticket, enabled = true) {
        selectedKey = bookingKey(ticket);
        selectionEnabled = enabled;
        renderSelection();
      }
    };
  }

  return { mount };
})();
