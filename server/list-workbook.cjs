'use strict';

const ExcelJS = require('exceljs');
const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function addSheet(workbook, { name, columns, rows }) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(([header, width, numFmt]) => ({
    header,
    width,
    style: numFmt ? { numFmt } : {}
  }));
  sheet.addRows(rows);
  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF262C36' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle' };
  });
  if (rows.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: columns.length }
    };
  }
}

async function sendListWorkbook(res, { filename, sheets }) {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) addSheet(workbook, sheet);
  const bytes = await workbook.xlsx.writeBuffer();
  res.set('Cache-Control', 'no-store');
  res.attachment(filename + '.xlsx');
  res.set('Content-Type', contentType);
  return res.send(Buffer.from(bytes));
}

module.exports = { sendListWorkbook };
