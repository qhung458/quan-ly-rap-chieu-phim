const assert = require('node:assert/strict');
const test = require('node:test');
const { createSnapshotStore, withConsistentListRead, SnapshotError } = require('../server/list-snapshots.cjs');

const access = { sessionId: 'session-a', scope: 've:SC001' };

test('pages and the full report read the same ordered values after the live data changes', () => {
  const store = createSnapshotStore();
  const items = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, value: 100 - index }));
  const firstId = store.create({ ...access, items, report: { detail: [{ id: 1, combo: 'CB01' }] } });
  const firstPage = store.page(firstId, access, { page: 1, pageSize: 50 });

  items[0].value = 999;
  items.splice(1, 1);
  items.push({ id: 101, value: 0 }, { id: 102, value: 0 });
  firstPage.items[0].value = 999;

  const secondPage = store.page(firstId, access, { page: 2, pageSize: 50 });
  const full = store.read(firstId, access);
  assert.equal(firstPage.snapshotId, firstId);
  assert.equal(secondPage.snapshotId, firstId);
  assert.equal(secondPage.total, 100);
  assert.deepEqual(full.items.map(item => item.id), Array.from({ length: 100 }, (_, index) => index + 1));
  assert.deepEqual(full.items.slice(50), secondPage.items);
  assert.equal(full.items[0].value, 100);
  assert.deepEqual(full.report.detail, [{ id: 1, combo: 'CB01' }]);

  const nextId = store.create({ ...access, items });
  assert.notEqual(nextId, firstId);
  assert.equal(store.page(nextId, access).total, 101);
  assert.deepEqual(store.read(nextId, access).items, items);
});

test('a caller cannot mutate stored rows or report data through either input or output', () => {
  const store = createSnapshotStore();
  const date = new Date('2026-11-25T00:00:00Z');
  const original = { rows: [{ date, binary: Buffer.from([7]), label: 'ban đầu' }] };
  const id = store.create({ ...access, items: original.rows, report: original });
  date.setUTCFullYear(2040);
  original.rows[0].binary[0] = 8;
  original.rows[0].label = 'đã đổi';

  const read = store.read(id, access);
  read.items[0].binary[0] = 9;
  read.report.rows[0].date.setUTCFullYear(2080);
  read.report.rows[0].binary[0] = 10;
  const expected = [{ date: new Date('2026-11-25T00:00:00Z'), binary: Buffer.from([7]), label: 'ban đầu' }];
  assert.deepEqual(store.read(id, access), { items: expected, report: { rows: expected } });
});

test('page metadata is frozen with the original result', () => {
  const store = createSnapshotStore();
  const meta = { hasHistory: true };
  const id = store.create({ ...access, items: [{ id: 1 }, { id: 2 }], meta });
  const first = store.page(id, access, { pageSize: 1 });
  meta.hasHistory = false;
  first.meta.hasHistory = false;

  const second = store.page(id, access, { page: 2, pageSize: 1 });
  assert.deepEqual(second.items, [{ id: 2 }]);
  assert.deepEqual(second.meta, { hasHistory: true });
  assert.deepEqual(store.read(id, access).meta, second.meta);
});

test('scope, session, pagination and expiry are checked without changing the snapshot', () => {
  let time = 0;
  const store = createSnapshotStore({ ttlMs: 10, now: () => time });
  const id = store.create({ ...access, items: [{ id: 1 }] });
  for (const other of [{ ...access, sessionId: 'session-b' }, { ...access, scope: 've:SC002' }]) {
    assert.throws(() => store.read(id, other), { status: 403, code: 'SNAPSHOT_FORBIDDEN' });
    assert.throws(() => store.page(id, other), { status: 403, code: 'SNAPSHOT_FORBIDDEN' });
  }
  assert.throws(() => store.page(id, access, { page: 1, pageSize: 101 }), { status: 400, code: 'INVALID_SNAPSHOT_PAGE' });
  assert.throws(() => store.page(id, access, { page: 1.5 }), { status: 400, code: 'INVALID_SNAPSHOT_PAGE' });
  assert.throws(() => store.page(id, access, { page: 2 }), { status: 400, code: 'INVALID_SNAPSHOT_PAGE' });
  time = 9;
  assert.equal(store.page(id, access).items.length, 1);
  time = 10;
  assert.throws(() => store.read(id, access), { status: 410, code: 'SNAPSHOT_EXPIRED' });
  assert.throws(() => store.page('unknown-id', access), { status: 410, code: 'SNAPSHOT_EXPIRED' });
});

test('the store rejects oversized projections and retains active snapshots when it reaches capacity', () => {
  let time = 0;
  const byCount = createSnapshotStore({ maxItems: 1, maxSnapshots: 1, ttlMs: 10, now: () => time });
  assert.throws(() => byCount.create({ ...access, items: [1, 2] }), { status: 413, code: 'SNAPSHOT_TOO_LARGE' });
  const id = byCount.create({ ...access, items: [1] });
  assert.throws(() => byCount.create({ ...access, items: [2] }), { status: 503, code: 'SNAPSHOT_STORE_FULL' });
  assert.deepEqual(byCount.read(id, access).items, [1]);
  time = 10;
  assert.notEqual(byCount.create({ ...access, items: [2] }), id);

  const byBytes = createSnapshotStore({ maxSnapshotBytes: 100, maxTotalBytes: 140 });
  const label = 'a'.repeat(60);
  assert.throws(() => byBytes.create({ ...access, items: [], report: { data: label.repeat(2) } }), {
    status: 413, code: 'SNAPSHOT_TOO_LARGE'
  });
  const first = byBytes.create({ ...access, items: [{ label }] });
  assert.throws(() => byBytes.create({ ...access, items: [{ label }] }), { status: 503, code: 'SNAPSHOT_STORE_FULL' });
  assert.deepEqual(byBytes.read(first, access).items, [{ label }]);
});

test('capacity reclaims only retired snapshots from their owning session', () => {
  const store = createSnapshotStore({ maxSnapshots: 2 });
  const other = { ...access, sessionId: 'session-b' };
  const old = store.create({ ...access, items: [1] });
  const active = store.create({ ...other, items: [2] });

  store.retire([old], other.sessionId);
  assert.throws(() => store.create({ ...access, items: [3] }), { code: 'SNAPSHOT_STORE_FULL' });
  store.retire([old], access.sessionId);
  assert.deepEqual(store.read(old, access).items, [1]);

  const next = store.create({ ...access, items: [3] });
  assert.throws(() => store.page(old, access), { code: 'SNAPSHOT_EXPIRED' });
  assert.deepEqual(store.read(active, other).items, [2]);
  assert.deepEqual(store.read(next, access).items, [3]);
});

test('an oversized admission leaves retired snapshots readable when it still cannot fit', () => {
  const store = createSnapshotStore({ maxSnapshotBytes: 256, maxTotalBytes: 96 });
  const small = store.create({ ...access, items: [1] });
  store.retire([small], access.sessionId);
  assert.throws(() => store.create({ ...access, items: ['x'.repeat(110)] }), { code: 'SNAPSHOT_STORE_FULL' });
  assert.deepEqual(store.read(small, access).items, [1]);
});

const isolation = 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ';
const start = 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY';

function connectionFixture(errors = {}) {
  const events = [];
  function call(name) {
    events.push(name);
    if (errors[name]) throw errors[name];
  }
  const connection = {
    query: async sql => call(sql),
    commit: async () => call('commit'),
    rollback: async () => call('rollback'),
    release: () => call('release'),
    destroy: () => call('destroy')
  };
  return { events, connection, pool: { getConnection: async () => connection } };
}

test('a consistent read commits before releasing its one connection', async () => {
  const { events, connection, pool } = connectionFixture();
  const result = await withConsistentListRead(pool, async selected => {
    assert.equal(selected, connection);
    await selected.query('SELECT items');
    await selected.query('SELECT detail');
    return { items: [1], report: { detail: [1] } };
  });
  assert.deepEqual(result, { items: [1], report: { detail: [1] } });
  assert.deepEqual(events, [isolation, start, 'SELECT items', 'SELECT detail', 'commit', 'release']);
});

test('an errored read rolls back and preserves the original error even if rollback fails', async () => {
  const readError = new SnapshotError(413, 'TEST_ERROR', 'read failed');
  for (const rollbackFails of [false, true]) {
    const { events, pool } = connectionFixture(rollbackFails ? { rollback: new Error('rollback failed') } : {});
    await assert.rejects(withConsistentListRead(pool, async () => { throw readError; }), error => error === readError);
    assert.deepEqual(events, [isolation, start, 'rollback', rollbackFails ? 'destroy' : 'release']);
  }
});

test('failed transaction setup discards the connection and a failed commit rolls back', async () => {
  const startError = new Error('transaction setup failed');
  const setup = connectionFixture({ [start]: startError });
  await assert.rejects(withConsistentListRead(setup.pool, () => assert.fail('read must not run')), error => error === startError);
  assert.deepEqual(setup.events, [isolation, start, 'destroy']);

  const commitError = new Error('commit failed');
  const commit = connectionFixture({ commit: commitError });
  await assert.rejects(withConsistentListRead(commit.pool, () => 'unused result'), error => error === commitError);
  assert.deepEqual(commit.events, [isolation, start, 'commit', 'rollback', 'release']);
});
