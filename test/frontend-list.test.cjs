const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const location = new URL('http://localhost:3000/html/fixture.html');
const excelType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function browserScript(file, globals = {}, properties = {}) {
  const window = { location, ...properties };
  const script = fs.readFileSync(path.join(__dirname, '../static/js', file), 'utf8');
  vm.runInNewContext(script, { window, URL, AbortController, structuredClone, ...globals }, { filename: file });
  return window;
}

function page(snapshotId, current = 1, items, total = 51, pageSize = 25) {
  const offset = (current - 1) * pageSize;
  const rows = items ?? Array.from({ length: Math.min(pageSize, total - offset) }, (_, index) => ({ id: offset + index }));
  return { snapshotId, items: rows, total, page: current, pageSize };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('frontend applies, removes and resets filters independently from draft edits and switches pages by snapshot', async () => {
  const { ListQuery } = browserScript('truy-van-danh-sach.js');
  const calls = [];
  const states = [];
  const controller = ListQuery.create({
    defaults: { sort: 'ma:asc' },
    onChange: state => states.push(state.status),
    load: async params => {
      calls.push(structuredClone(params));
      return page(params.snapshotId || 'snapshot-' + calls.length, params.page);
    }
  });
  assert.equal(controller.getState().status, 'idle');
  const statuses = ['DaDat', 'DaSuDung'];
  controller.setDraft({ q: 'dien anh', trangThai: statuses, giaMin: 0, sort: 'gia:desc,ten:asc' });
  statuses.push('DaHuy');
  assert.deepEqual(structuredClone(controller.getState().applied), { sort: 'ma:asc' });
  await controller.apply();
  assert.deepEqual(calls[0], {
    q: 'dien anh', trangThai: ['DaDat', 'DaSuDung'], giaMin: 0,
    sort: 'gia:desc,ten:asc', page: 1, pageSize: 25
  });

  await controller.goToPage(2);
  assert.deepEqual(calls[1], { snapshotId: 'snapshot-1', page: 2, pageSize: 25 });
  assert.equal(controller.getState().page, 2);
  assert.equal(controller.getSnapshotId(), 'snapshot-1');

  controller.setDraft({ q: 'chưa áp dụng', sort: 'ten:asc' });
  await controller.remove('trangThai', 'DaDat');
  assert.deepEqual(calls[2], {
    q: 'dien anh', trangThai: ['DaSuDung'], giaMin: 0, sort: 'gia:desc,ten:asc', page: 1, pageSize: 25
  });
  assert.equal(controller.getState().draft.q, 'chưa áp dụng');
  await controller.remove('trangThai', 'DaSuDung');
  await controller.remove('giaMin');
  assert.deepEqual(calls[4], { q: 'dien anh', sort: 'gia:desc,ten:asc', page: 1, pageSize: 25 });

  await controller.apply();
  assert.deepEqual(calls[5], { q: 'chưa áp dụng', sort: 'ten:asc', page: 1, pageSize: 25 });
  await controller.reset();
  assert.deepEqual(calls[6], { sort: 'ma:asc', page: 1, pageSize: 25 });
  assert.deepEqual(structuredClone(controller.getState().draft), { sort: 'ma:asc' });
  assert.ok(states.includes('loading'));
  assert.equal(states.at(-1), 'ready');
});

test('frontend ignores late successes and errors and exposes the snapshot of the winning request', async () => {
  const { ListQuery } = browserScript('truy-van-danh-sach.js');
  const pending = [];
  const controller = ListQuery.create({
    load(params, { signal }) {
      const request = deferred();
      pending.push({ ...request, signal });
      return request.promise;
    }
  });
  const oldSuccess = controller.apply();
  controller.setDraft({ q: 'mới hơn' });
  const oldFailure = controller.apply();
  controller.setDraft({ q: 'mới nhất' });
  const newest = controller.apply();
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(pending[1].signal.aborted, true);
  assert.equal(controller.getSnapshotId(), null);

  pending[2].resolve(page('current'));
  await newest;
  pending[1].reject(new Error('Lỗi cũ'));
  pending[0].resolve(page('outdated'));
  await Promise.all([oldFailure, oldSuccess]);
  assert.equal(controller.getSnapshotId(), 'current');
  assert.equal(controller.getState().applied.q, 'mới nhất');
  assert.equal(controller.getState().status, 'ready');
  assert.equal(controller.getState().error, null);
});

test('frontend reports a missing snapshot, refreshes only on request and distinguishes empty results', async () => {
  const calls = [];
  const { ListQuery } = browserScript('truy-van-danh-sach.js', {
    fetch: async url => {
      calls.push(url);
      if (url.searchParams.has('snapshotId')) return new Response('', { status: 410 });
      if (calls.length === 1) return Response.json(page('first'));
      return Response.json(page('second', 1, [], 0));
    }
  });
  const controller = ListQuery.create({
    load: ListQuery.loadFrom('/api/fixture?snapshotId=stale&page=9&sort=outdated'),
    defaults: { q: 'Đồng Ánh', trangThai: ['DaHuy', 'DaDat'], coEmail: false, giaMin: 0 }
  });
  await controller.apply();
  assert.deepEqual([...calls[0].searchParams], [
    ['q', 'Đồng Ánh'], ['trangThai', 'DaHuy'], ['trangThai', 'DaDat'],
    ['coEmail', 'false'], ['giaMin', '0'], ['page', '1'], ['pageSize', '25']
  ]);
  await controller.goToPage(2);
  assert.deepEqual([...calls[1].searchParams], [['snapshotId', 'first'], ['page', '2'], ['pageSize', '25']]);
  assert.equal(calls.length, 2);
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().error.status, 410);
  assert.match(controller.getState().error.message, /hết hạn/);
  assert.equal(controller.getSnapshotId(), null);

  controller.setDraft({ q: 'chưa áp dụng' });
  await controller.refresh();
  assert.equal(calls[2].searchParams.get('q'), 'Đồng Ánh');
  assert.equal(calls[2].searchParams.has('snapshotId'), false);
  assert.equal(controller.getSnapshotId(), 'second');
  assert.equal(controller.getState().total, 0);
  assert.equal(controller.getState().status, 'empty');
});

test('clearing a list restores defaults and ignores the pending response and its metadata', async () => {
  const { ListQuery } = browserScript('truy-van-danh-sach.js');
  const waiting = deferred();
  let signal;
  let calls = 0;
  const controller = ListQuery.create({
    defaults: { sort: 'ngayDat:desc' },
    load(_params, options) {
      calls++;
      signal = options.signal;
      return waiting.promise;
    }
  });

  controller.setDraft({ q: 'vé bị hủy' });
  const old = controller.apply();
  controller.clear();
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  waiting.resolve({ ...page('old'), meta: { hasHistory: true } });
  await old;
  assert.equal(controller.getState().status, 'idle');
  assert.equal(controller.getState().meta, null);
  assert.equal(controller.getSnapshotId(), null);
  assert.deepEqual(structuredClone(controller.getState().applied), { sort: 'ngayDat:desc' });
  assert.deepEqual(structuredClone(controller.getState().draft), { sort: 'ngayDat:desc' });
});

test('frontend keeps the displayed rows isolated and rejects a page from another snapshot', async () => {
  const { ListQuery } = browserScript('truy-van-danh-sach.js');
  const first = page('first');
  first.items[0] = { info: { name: 'Tên ban đầu' } };
  const controller = ListQuery.create({
    load: async params => params.page === 1 ? first : page('wrong', 2)
  });
  await controller.apply();
  const copy = controller.getState();
  copy.items[0].info.name = 'Sửa trên giao diện';
  first.items[0].info.name = 'Sửa từ bộ đệm tải';
  assert.equal(controller.getState().items[0].info.name, 'Tên ban đầu');

  await controller.goToPage(2);
  assert.equal(controller.getState().status, 'error');
  assert.match(controller.getState().error.message, /không khớp/);
  assert.equal(controller.getState().page, 1);
  assert.equal(controller.getSnapshotId(), null);
});

test('out-of-bounds and inconsistent pages are not reported as empty searches', async () => {
  const { ListQuery } = browserScript('truy-van-danh-sach.js');
  const controller = ListQuery.create({
    load: async params => params.page === 1 ? page('first') : page('first', params.page, [])
  });
  await controller.apply();
  assert.throws(() => controller.goToPage(4), /ngoài phạm vi/);
  assert.equal(controller.getState().status, 'ready');
  await controller.goToPage(3);
  assert.equal(controller.getState().status, 'error');
  assert.match(controller.getState().error.message, /Số bản ghi/);
});

test('a list without pagination keeps a snapshot and refreshes the whole result', async () => {
  const { ListQuery } = browserScript('truy-van-danh-sach.js');
  const calls = [];
  const controller = ListQuery.create({
    pageSize: null,
    defaults: { snapshotId: 'stale', pageSize: 25 },
    load: async params => {
      calls.push(structuredClone(params));
      return page('combo-' + calls.length, 1, [{ id: 'CB01' }, { id: 'CB02' }], 2, 2);
    }
  });
  await controller.apply();
  await controller.goToPage(2);
  await controller.refresh();
  assert.deepEqual(calls, [{ page: 1 }, { page: 1 }]);
  assert.equal(controller.getSnapshotId(), 'combo-2');
  assert.equal(controller.getState().pageSize, 2);
  assert.equal(controller.getState().items.length, 2);
});

function excelBrowser(fetch, ExcelJS) {
  const classes = new Set();
  const downloads = [];
  const revoked = [];
  const clickHandlers = [];
  const button = {
    disabled: true,
    addEventListener(type, listener) {
      assert.equal(type, 'click');
      clickHandlers.push(listener);
    },
    click() { return clickHandlers[0](); }
  };
  const message = {
    textContent: '',
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name)
    }
  };
  const blobs = new Map();
  class BrowserURL extends URL {
    static createObjectURL(blob) {
      const address = 'blob:' + (downloads.length + 1);
      blobs.set(address, blob);
      return address;
    }
    static revokeObjectURL(address) {
      revoked.push(address);
      blobs.delete(address);
    }
  }
  const document = {
    getElementById: id => id === 'export' ? button : message,
    head: { append(script) { script.onload(); } },
    body: { append() {} },
    createElement(type) {
      if (type === 'script') return {};
      assert.equal(type, 'a');
      return {
        click() { downloads.push({ filename: this.download, blob: blobs.get(this.href) }); },
        remove() {}
      };
    }
  };
  const { ExcelExport } = browserScript('xuat-excel.js', {
    fetch, URL: BrowserURL, Blob, document, setTimeout: callback => callback()
  }, { ExcelJS });
  return { ExcelExport, button, message, classes, downloads, revoked };
}

test('server Excel download pins the preview on click and ignores the old status after the query changes', async () => {
  const request = deferred();
  const calls = [];
  const { ExcelExport, button, message, downloads, revoked } = excelBrowser((url, options) => {
    calls.push({ url, options });
    return request.promise;
  });
  const preview = { url: '/api/fixture/xuat?page=4&snapshotId=stale', snapshotId: 'first?x=1', filename: 'may-chu' };
  const enable = ExcelExport.bindDownload('export', () => preview);
  enable(true);
  const click = button.click();
  preview.snapshotId = 'second';
  preview.filename = 'khac';
  enable(false);
  enable(true);
  await button.click();
  assert.equal(calls.length, 1);
  assert.deepEqual([...calls[0].url.searchParams], [['snapshotId', 'first?x=1']]);
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(button.disabled, true);

  request.resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': excelType } }));
  await click;
  assert.equal(downloads[0].filename, 'may-chu.xlsx');
  assert.deepEqual(new Uint8Array(await downloads[0].blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal(button.disabled, false);
  assert.equal(message.textContent, '');
  assert.deepEqual(revoked, ['blob:1']);
});

test('an HTML success response cannot be downloaded as XLSX', async () => {
  const { ExcelExport, button, message, classes, downloads } = excelBrowser(async () =>
    new Response('<html>Đăng nhập</html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  ExcelExport.bindDownload('export', () => ({ url: '/api/fixture/xuat', snapshotId: 'first', filename: 'may-chu' }))(true);
  await button.click();
  assert.equal(downloads.length, 0);
  assert.equal(classes.has('text-danger'), true);
  assert.match(message.textContent, /tệp Excel hợp lệ/);
});

test('server Excel download reports authentication, permission and expiration without downloading or reloading', async () => {
  const cases = [
    [401, /đăng nhập/],
    [403, /quyền/],
    [410, /hết hạn/]
  ];
  for (const [status, expected] of cases) {
    let requests = 0;
    const { ExcelExport, button, message, classes, downloads } = excelBrowser(async () => {
      requests++;
      return new Response('', { status });
    });
    ExcelExport.bindDownload('export', () => ({ url: '/api/fixture/xuat', snapshotId: 'first', filename: 'may-chu' }))(true);
    await button.click();
    assert.equal(requests, 1);
    assert.equal(downloads.length, 0);
    assert.equal(button.disabled, false);
    assert.equal(classes.has('text-danger'), true);
    assert.match(message.textContent, expected);
  }
});

test('the legacy client-side Excel binder still creates a readable workbook with ordered rows', async () => {
  const ExcelJS = require('exceljs');
  const { ExcelExport, button, message, downloads } = excelBrowser(
    () => assert.fail('legacy path must not call fetch'), ExcelJS
  );
  const enable = ExcelExport.bind('export', async () => ({
    filename: 'hien-tai',
    sheets: [{ name: 'Khách', columns: [['Mã', 16], ['Số điện thoại', 20]], rows: [['KH02', '0901234567'], ['KH01', '0911234567']] }]
  }));
  await button.click();
  assert.equal(downloads.length, 0);
  enable(true);
  await button.click();
  assert.equal(downloads[0].filename, 'hien-tai.xlsx');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await downloads[0].blob.arrayBuffer());
  const sheet = book.getWorksheet('Khách');
  assert.equal(sheet.rowCount, 3);
  assert.deepEqual(sheet.getSheetValues().slice(2).map(row => row.slice(1)), [
    ['KH02', '0901234567'], ['KH01', '0911234567']
  ]);
  assert.match(message.textContent, /Đã gửi/);
});
