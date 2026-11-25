'use strict';

window.ExcelExport = (() => {
  const money = '#,##0.##" ₫"';
  const integer = '#,##0';
  const date = 'dd/mm/yyyy';
  const dateTime = 'dd/mm/yyyy hh:mm';
  const month = 'mm/yyyy';
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  let library;

  function loadLibrary() {
    if (!library) {
      library = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/js/vendor/exceljs.js';
        script.onload = () => window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error());
        script.onerror = () => {
          script.remove();
          reject(new Error());
        };
        document.head.append(script);
      }).catch(() => {
        library = null;
        throw new Error('Không tải được công cụ xuất Excel. Vui lòng thử lại.');
      });
    }
    return library;
  }

  function asDate(value) {
    if (!value) return null;
    const match = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
    const iso = match
      ? match[3] + '-' + match[2] + '-' + match[1] + 'T' + (match[4] || '00') + ':' + (match[5] || '00') + ':' + (match[6] || '00') + 'Z'
      : value.length === 7 ? value + '-01T00:00:00Z' : value.length === 10 ? value + 'T00:00:00Z' : value;
    const result = new Date(iso);
    return Number.isNaN(result.getTime()) ? value : result;
  }

  async function write(filename, sheets) {
    const ExcelJS = await loadLibrary();
    const workbook = new ExcelJS.Workbook();
    for (const { name, columns, rows } of sheets) {
      const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.columns = columns.map(([header, width, numFmt]) => ({
        header, width, style: numFmt ? { numFmt } : {}
      }));
      sheet.addRows(rows);
      const header = sheet.getRow(1);
      header.height = 24;
      header.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF262C36' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle' };
      });
      if (rows.length) sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: rows.length + 1, column: columns.length }
      };
    }
    const bytes = await workbook.xlsx.writeBuffer();
    saveBlob(new Blob([bytes], { type: mimeType }), filename);
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename + '.xlsx';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function download(request) {
    const { url, snapshotId, filename, query = {} } = request ?? {};
    if (!snapshotId) throw new Error('Tải danh sách trước khi xuất Excel.');
    if (!url || !filename) throw new Error('Thông tin xuất Excel không hợp lệ.');
    const endpoint = new URL(url, window.location.href);
    if (endpoint.origin !== window.location.origin) throw new Error('Địa chỉ xuất Excel không hợp lệ.');
    endpoint.search = '';
    for (const [name, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== null && item !== undefined && item !== '') endpoint.searchParams.append(name, item);
      }
    }
    endpoint.searchParams.set('snapshotId', snapshotId);
    const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const messages = {
        401: 'Vui lòng đăng nhập lại để xuất Excel.',
        403: 'Bạn không có quyền xuất dữ liệu này.',
        410: 'Kết quả đang xem đã hết hạn. Tải lại danh sách trước khi xuất Excel.'
      };
      throw new Error(body?.message || messages[response.status] || 'Không thể xuất Excel. Vui lòng thử lại.');
    }
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (type !== mimeType) throw new Error('Máy chủ không trả về tệp Excel hợp lệ.');
    saveBlob(await response.blob(), filename);
  }

  function bindAction(id, run) {
    const button = document.getElementById(id);
    const message = document.getElementById(id + '-message');
    let available = false;
    let busy = false;
    let revision = 0;

    button.addEventListener('click', async () => {
      if (!available || busy) return;
      const clickRevision = revision;
      busy = true;
      button.disabled = true;
      button.textContent = 'Đang xuất…';
      message.classList.remove('text-danger');
      message.textContent = 'Đang tạo tệp Excel…';
      try {
        await run();
        if (clickRevision === revision) message.textContent = 'Đã gửi tệp Excel để tải xuống.';
      } catch (error) {
        if (clickRevision === revision) {
          message.classList.add('text-danger');
          message.textContent = error.responseJSON?.message || error.message || 'Không thể xuất Excel. Vui lòng thử lại.';
        }
      } finally {
        busy = false;
        button.disabled = !available;
        button.textContent = 'Xuất Excel';
      }
    });

    return enabled => {
      if (available && !enabled) revision++;
      available = Boolean(enabled);
      button.disabled = busy || !available;
      if (!busy || !available) {
        message.textContent = '';
        message.classList.remove('text-danger');
      }
    };
  }

  function bind(id, report) {
    return bindAction(id, async () => {
      const { filename, sheets } = await report();
      await write(filename, sheets);
    });
  }

  function bindDownload(id, getRequest) {
    return bindAction(id, () => download(getRequest()));
  }

  return { bind, bindDownload, asDate, money, integer, date, dateTime, month };
})();
