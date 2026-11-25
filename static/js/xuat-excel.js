'use strict';

window.ExcelExport = (() => {
  const money = '#,##0.##" ₫"';
  const integer = '#,##0';
  const date = 'dd/mm/yyyy';
  const dateTime = 'dd/mm/yyyy hh:mm';
  const month = 'mm/yyyy';
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
    const url = URL.createObjectURL(new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename + '.xlsx';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bind(id, report) {
    const button = document.getElementById(id);
    const message = document.getElementById(id + '-message');
    let available = false;
    let busy = false;

    button.addEventListener('click', async () => {
      if (!available || busy) return;
      busy = true;
      button.disabled = true;
      button.textContent = 'Đang xuất…';
      message.classList.remove('text-danger');
      message.textContent = 'Đang tạo tệp Excel…';
      try {
        const { filename, sheets } = await report();
        await write(filename, sheets);
        message.textContent = 'Đã gửi tệp Excel để tải xuống.';
      } catch (error) {
        message.classList.add('text-danger');
        message.textContent = error.responseJSON?.message || error.message || 'Không thể xuất Excel. Vui lòng thử lại.';
      } finally {
        busy = false;
        button.disabled = !available;
        button.textContent = 'Xuất Excel';
      }
    });

    return enabled => {
      available = Boolean(enabled);
      button.disabled = busy || !available;
      if (!busy) message.textContent = '';
    };
  }

  return { bind, asDate, money, integer, date, dateTime, month };
})();
