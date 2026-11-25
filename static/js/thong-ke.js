/* global jQuery, ListQuery, ExcelExport */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;
  const api = '/api/thong-ke';
  const loadPeriod = ListQuery.loadFrom(api);
  const money = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
  const formatMoney = value => money.format(value) + ' ₫';
  const formatPeriod = value => value.split('-').reverse().join('/');
  const defaultSort = 'doanhThu:desc,ten:asc';
  const $message = $('#stats-message');
  const $submit = $('#stats-form button[type="submit"]');
  const $periodRows = $('#period-rows');
  let data = null;
  let mode = 'day';
  let periodRequest;
  let exportAvailable = false;

  const rankDefinitions = {
    phim: { label: 'phim', code: 'MaPhim', name: 'TenPhim', count: 'SoVe', countLabel: 'Lượt vé', codeLength: 15 },
    combo: { label: 'combo', code: 'MaCombo', name: 'TenCombo', count: 'SoLuong', countLabel: 'Số phần', codeLength: 10 }
  };
  const setExportEnabled = ExcelExport.bindDownload('stats-export', () => {
    const query = { mode };
    for (const ranking of rankings) {
      for (const [key, value] of Object.entries(ranking.getApplied())) {
        query[ranking.key + key[0].toUpperCase() + key.slice(1)] = value;
      }
    }
    return {
      url: api + '/xuat', filename: 'thong-ke-' + data.TuNgay + '_' + data.DenNgay,
      snapshotId: data.snapshotId, query
    };
  });
  const rankings = Object.entries(rankDefinitions).map(([key, definition]) => createRanking(key, definition));

  function syncExport() {
    const snapshotId = data?.snapshotId;
    const available = Boolean(snapshotId && rankings.every(rank => rank.getSnapshotId() === snapshotId));
    if (available === exportAvailable) return;
    exportAvailable = available;
    setExportEnabled(available);
  }

  function dateText(date) {
    const pad = number => String(number).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function showError(error) {
    if (error.status === 401) {
      location.assign('dang-nhap.html');
      return;
    }
    $message.addClass('text-danger').text(error.responseJSON?.message || error.message || 'Không kết nối được máy chủ.');
  }

  function emptyRow($body, columns, text) {
    $body.empty().append($('<tr>').append($('<td>', { colspan: columns, text })));
  }

  function tile(label, value, sub, total) {
    return $('<div class="stat-tile">').toggleClass('is-total', Boolean(total)).append(
      $('<p class="stat-label">').text(label),
      $('<p class="stat-value">').text(value),
      $('<p class="stat-sub">').text(sub)
    );
  }

  function renderTiles(summary) {
    $('#stat-tiles').empty().append(
      tile('Tổng doanh thu', formatMoney(summary.TongDoanhThu), 'Vé + bắp nước', true),
      tile('Doanh thu vé', formatMoney(summary.DoanhThuVe), summary.SoVe + ' vé'),
      tile('Doanh thu bắp nước', formatMoney(summary.DoanhThuBapNuoc), summary.SoHoaDon + ' hóa đơn')
    );
  }

  function renderPeriod() {
    const rows = mode === 'day' ? data.TheoNgay : data.TheoThang;
    if (!rows.length) {
      emptyRow($periodRows, 6, 'Không có doanh thu trong khoảng ngày này.');
      return;
    }
    $periodRows.empty().append(rows.map(row => $('<tr>').append(
      $('<th scope="row" class="fw-normal">').text(formatPeriod(mode === 'day' ? row.Ngay : row.Thang)),
      $('<td class="money">').text(row.SoVe),
      $('<td class="money">').text(formatMoney(row.DoanhThuVe)),
      $('<td class="money">').text(row.SoHoaDon),
      $('<td class="money">').text(formatMoney(row.DoanhThuBapNuoc)),
      $('<td class="money fw-bold">').text(formatMoney(row.TongDoanhThu))
    )));
  }

  function createRanking(key, definition) {
    const { label, code, name, count, countLabel, codeLength } = definition;
    const codeField = code[0].toLowerCase() + code.slice(1);
    const countField = count[0].toLowerCase() + count.slice(1);
    const sortLabels = { doanhThu: 'Doanh thu', [countField]: countLabel, ten: 'Tên ' + label };
    const filterLabels = {
      q: 'Từ khóa', [codeField]: 'Mã ' + label + ' chính xác',
      [countField + 'Min']: countLabel + ' từ', [countField + 'Max']: countLabel + ' đến',
      doanhThuMin: 'Doanh thu từ', doanhThuMax: 'Doanh thu đến'
    };
    const sortOptions = Object.entries(sortLabels)
      .map(([value, text]) => `<option value="${value}">${text}</option>`).join('');
    const directions = '<option value="asc">Tăng dần</option><option value="desc">Giảm dần</option>';
    const panel = document.querySelector(`[data-stats-ranking="${key}"]`);
    const form = panel.querySelector('form');
    const table = panel.querySelector('table');
    const $body = $(table.tBodies[0]);
    const resultCount = panel.querySelector('[data-rank-count]');
    const pager = panel.querySelector('nav');
    const previous = pager.querySelector('[data-page-prev]');
    const next = pager.querySelector('[data-page-next]');
    const position = pager.querySelector('[data-page-position]');
    const fetchRanking = ListQuery.loadFrom(api + '/theo-' + key);
    let applied = { sort: defaultSort };
    let idleMessage = 'Chọn khoảng ngày để xem thống kê.';

    form.innerHTML = `
      <fieldset class="query-layout" disabled aria-label="Điều kiện thống kê theo ${label}">
        <div class="query-head">
          <label class="query-keyword">Tìm theo mã hoặc tên ${label}
            <input class="form-control form-control-sm" name="q" type="search" maxlength="100">
          </label>
          <div class="query-actions">
            <button class="btn btn-dark btn-sm" type="submit">Áp dụng</button>
            <button class="btn btn-outline-secondary btn-sm" type="button" data-query-reset>Đặt lại</button>
          </div>
        </div>
        <div class="query-options">
          <details class="query-section">
            <summary>Bộ lọc ${label}</summary>
            <div class="query-section-body">
              <label>${filterLabels[codeField]}
                <input class="form-control form-control-sm" name="${codeField}" maxlength="${codeLength}">
              </label>
              <div class="query-groups query-groups--paired">
                <fieldset class="query-group">
                  <legend>${countLabel}</legend>
                  <div class="query-fields query-fields--pair">
                    <label>Từ<input class="form-control form-control-sm" name="${countField}Min" type="number" min="0" step="1"></label>
                    <label>Đến<input class="form-control form-control-sm" name="${countField}Max" type="number" min="0" step="1"></label>
                  </div>
                </fieldset>
                <fieldset class="query-group">
                  <legend>Doanh thu (₫)</legend>
                  <div class="query-fields query-fields--pair">
                    <label>Từ<input class="form-control form-control-sm" name="doanhThuMin" type="number" min="0" step=".01"></label>
                    <label>Đến<input class="form-control form-control-sm" name="doanhThuMax" type="number" min="0" step=".01"></label>
                  </div>
                </fieldset>
              </div>
            </div>
          </details>
          <details class="query-section">
            <summary>Sắp xếp</summary>
            <div class="query-section-body">
              <div class="query-groups query-groups--paired">
                <fieldset class="query-group">
                  <legend>Thứ tự chính</legend>
                  <div class="query-fields query-fields--pair">
                    <label>Tiêu chí<select class="form-select form-select-sm" data-sort-main>${sortOptions}</select></label>
                    <label>Chiều<select class="form-select form-select-sm" data-sort-main-dir>${directions}</select></label>
                  </div>
                </fieldset>
                <fieldset class="query-group">
                  <legend>Thứ tự phụ</legend>
                  <div class="query-fields query-fields--pair">
                    <label>Tiêu chí<select class="form-select form-select-sm" data-sort-extra><option value="">Không chọn</option>${sortOptions}</select></label>
                    <label>Chiều<select class="form-select form-select-sm" data-sort-extra-dir>${directions}</select></label>
                  </div>
                </fieldset>
              </div>
            </div>
          </details>
        </div>
        <ul class="query-chips" data-query-conditions aria-label="Điều kiện đang áp dụng" hidden></ul>
      </fieldset>`;

    const fieldset = form.querySelector('fieldset');
    const chips = form.querySelector('[data-query-conditions]');
    const main = form.querySelector('[data-sort-main]');
    const mainDirection = form.querySelector('[data-sort-main-dir]');
    const extra = form.querySelector('[data-sort-extra]');
    const extraDirection = form.querySelector('[data-sort-extra-dir]');
    const fields = Array.from(form.querySelectorAll('input[name]'));
    const controller = ListQuery.create({
      defaults: applied,
      async load(params, context) {
        const snapshotId = params.snapshotId ?? data.snapshotId;
        const response = await fetchRanking({ ...controller.getState().applied, ...params, snapshotId }, context);
        if (response?.snapshotId !== snapshotId || !Number.isFinite(response.meta?.maxRevenue) || response.meta.maxRevenue < 0) {
          throw new Error('Phản hồi bảng xếp hạng không khớp với kỳ thống kê.');
        }
        return response;
      },
      onChange: render
    });

    function syncSort() {
      if (extra.value === main.value) extra.value = '';
      for (const option of extra.options) option.disabled = option.value === main.value;
      extraDirection.disabled = !extra.value;
    }

    function readDraft() {
      const draft = Object.fromEntries(fields.map(field => [field.name, field.value.trim()]));
      draft.sort = main.value + ':' + mainDirection.value +
        (extra.value ? ',' + extra.value + ':' + extraDirection.value : '');
      return draft;
    }

    function writeDraft(draft) {
      for (const field of fields) field.value = draft[field.name] ?? '';
      const [primary, secondary = ''] = (draft.sort || defaultSort).split(',');
      [main.value, mainDirection.value] = primary.split(':');
      [extra.value, extraDirection.value = 'asc'] = secondary.split(':');
      syncSort();
    }

    function conditionText(field, value) {
      if (field !== 'sort') return filterLabels[field] + ' · ' + value;
      return 'Sắp xếp · ' + value.split(',').map(order => {
        const [criterion, direction] = order.split(':');
        return sortLabels[criterion] + (direction === 'asc' ? ' tăng' : ' giảm');
      }).join(', rồi ');
    }

    function renderConditions() {
      chips.replaceChildren();
      for (const [field, value] of Object.entries(applied)) {
        if (!value || (field === 'sort' && value === defaultSort)) continue;
        const labelText = conditionText(field, value);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'btn btn-outline-secondary btn-sm';
        chip.textContent = labelText + ' ×';
        chip.setAttribute('aria-label', 'Bỏ điều kiện ' + labelText);
        chip.addEventListener('click', () => {
          controller.setDraft(readDraft());
          controller.remove(field, value);
          writeDraft(controller.getState().draft);
          form.querySelector('button[type="submit"]').focus();
        });
        const item = document.createElement('li');
        item.append(chip);
        chips.append(item);
      }
      chips.hidden = !chips.children.length;
    }

    function render(state) {
      const ready = state.status === 'ready';
      const settled = ready || state.status === 'empty';
      const pages = Math.ceil(state.total / state.pageSize);
      if (state.status !== 'idle') applied = state.applied;
      fieldset.disabled = !data;
      table.setAttribute('aria-busy', String(state.status === 'loading'));
      resultCount.textContent = settled ? state.total + ' ' + label : '';
      pager.hidden = pages <= 1 || state.status === 'error';
      previous.disabled = !ready || state.page <= 1;
      next.disabled = !ready || state.page >= pages;
      position.textContent = pages > 1 ? `Trang ${state.page} / ${pages}` : '';
      renderConditions();
      syncExport();

      if (ready) {
        const max = state.meta.maxRevenue;
        $body.empty().append(state.items.map(item => {
          const width = max > 0 ? Math.min(100, item.DoanhThu / max * 100) : 0;
          return $('<tr>', { 'data-code': item[code] }).append(
            $('<td>').text(item[code]),
            $('<th scope="row" class="fw-normal">').text(item[name]),
            $('<td class="money">').text(item[count]),
            $('<td class="bar-cell">').append(
              $('<div>').text(formatMoney(item.DoanhThu)),
              $('<div class="bar-track" aria-hidden="true">').append($('<div class="bar-fill">').css('width', width + '%'))
            )
          );
        }));
        return;
      }

      const filtered = fields.some(field => Boolean(applied[field.name]));
      const messages = {
        idle: idleMessage,
        loading: 'Đang tải bảng xếp hạng…',
        empty: filtered ? 'Không tìm thấy ' + label + ' phù hợp.' : 'Không có doanh thu theo ' + label + ' trong kỳ này.',
        error: state.error?.status === 410 ? 'Kỳ thống kê đã hết hạn. Bấm Xem thống kê để tải lại.' : state.error?.message
      };
      if (state.error?.status === 401) location.assign('dang-nhap.html');
      emptyRow($body, 4, messages[state.status]);
    }

    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!data) return;
      controller.setDraft(readDraft());
      controller.apply();
    });
    form.querySelector('[data-query-reset]').addEventListener('click', () => {
      controller.reset();
      writeDraft(controller.getState().draft);
    });
    main.addEventListener('change', syncSort);
    extra.addEventListener('change', syncSort);
    previous.addEventListener('click', () => controller.goToPage(controller.getState().page - 1));
    next.addEventListener('click', () => controller.goToPage(controller.getState().page + 1));
    writeDraft(applied);
    return {
      key,
      getSnapshotId: controller.getSnapshotId,
      getApplied: () => applied,
      clear(message) {
        idleMessage = message;
        controller.clear();
      },
      reload() {
        const draft = readDraft();
        controller.setDraft(applied);
        controller.apply();
        controller.setDraft(draft);
      }
    };
  }

  function clearReport(message) {
    data = null;
    syncExport();
    $('#stat-tiles').empty();
    emptyRow($periodRows, 6, message);
    for (const ranking of rankings) ranking.clear(message);
  }

  async function load() {
    periodRequest?.abort();
    periodRequest = null;
    $message.removeClass('text-danger').empty();
    const from = $('#stats-from').val();
    const to = $('#stats-to').val();
    if (!from || !to || from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000) {
      clearReport('Chọn khoảng ngày để xem thống kê.');
      $submit.prop('disabled', false);
      $message.addClass('text-danger').text('Chọn khoảng ngày hợp lệ, tối đa 366 ngày.');
      return;
    }

    const request = new AbortController();
    periodRequest = request;
    clearReport('Đang tải thống kê…');
    $submit.prop('disabled', true);
    $message.text('Đang tải thống kê…');
    try {
      const result = await loadPeriod({ tuNgay: from, denNgay: to, tomTat: 1 }, { signal: request.signal });
      if (request !== periodRequest) return;
      if (typeof result?.snapshotId !== 'string' || !result.snapshotId || !result.TongQuan ||
          !Array.isArray(result.TheoNgay) || !Array.isArray(result.TheoThang)) {
        throw new Error('Phản hồi kỳ thống kê không hợp lệ.');
      }
      data = result;
      renderTiles(result.TongQuan);
      renderPeriod();
      for (const ranking of rankings) ranking.reload();
      $message.text('Đang hiển thị từ ' + formatPeriod(result.TuNgay) + ' đến ' + formatPeriod(result.DenNgay) + '.');
    } catch (error) {
      if (request !== periodRequest) return;
      clearReport('Không tải được kỳ thống kê.');
      showError(error);
    } finally {
      if (request === periodRequest) {
        periodRequest = null;
        $submit.prop('disabled', false);
      }
    }
  }

  function setMode(next) {
    mode = next;
    $('#period-head').text(mode === 'day' ? 'Ngày' : 'Tháng');
    $('#by-day').toggleClass('btn-dark', next === 'day').toggleClass('btn-outline-dark', next !== 'day')
      .attr('aria-pressed', String(next === 'day'));
    $('#by-month').toggleClass('btn-dark', next === 'month').toggleClass('btn-outline-dark', next !== 'month')
      .attr('aria-pressed', String(next === 'month'));
    if (data) renderPeriod();
  }

  $('#stats-form').on('submit', event => {
    event.preventDefault();
    load();
  });
  $('#stats-from, #stats-to').on('change', load);
  $('#by-day').on('click', () => setMode('day'));
  $('#by-month').on('click', () => setMode('month'));
  $('#logout-button').on('click', async () => {
    try {
      await $.ajax({ url: '/api/auth/logout', method: 'POST' });
      location.assign('dang-nhap.html');
    } catch (error) {
      showError(error);
    }
  });

  $.getJSON('/api/auth/me').done(user => {
    $('#account-name').text(user.HoTen + ' · ' +
      (user.VaiTro === 'QuanTriVien' ? 'Quản trị viên' : 'Nhân viên quầy'));
    $('#logout-button').prop('hidden', false);
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    $('#stats-from').val(dateText(start));
    $('#stats-to').val(dateText(today));
    $submit.prop('disabled', false);
    load();
  }).fail(error => {
    clearReport('Không tải được kỳ thống kê.');
    showError(error);
  });
})();
