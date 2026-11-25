const { randomUUID } = require('node:crypto');
const { serialize, deserialize } = require('node:v8');

class SnapshotError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'SnapshotError';
    this.status = status;
    this.code = code;
  }
}

function snapshotTooLarge() {
  return new SnapshotError(413, 'SNAPSHOT_TOO_LARGE', 'Kết quả quá lớn để lưu. Hãy thu hẹp điều kiện truy vấn.');
}

function copyValue(encoded) {
  // Some deserialized typed arrays share the decoder's input bytes.
  return deserialize(Buffer.from(encoded));
}

function encodeProjection(items, report, meta, byteLimit) {
  // Keep one packed buffer and an index so a page need only decode its own rows.
  const indexBytes = (items.length + 1) * Uint32Array.BYTES_PER_ELEMENT;
  if (indexBytes > byteLimit) throw snapshotTooLarge();
  const offsets = new Uint32Array(items.length + 1);
  const rows = [];
  let rowBytes = 0;
  for (const [index, item] of items.entries()) {
    const row = serialize(item);
    rowBytes += row.length;
    if (rowBytes + offsets.byteLength > byteLimit) throw snapshotTooLarge();
    offsets[index + 1] = rowBytes;
    rows.push(row);
  }

  const encodedReport = report === undefined ? undefined : serialize(report);
  const encodedMeta = meta === undefined ? undefined : serialize(meta);
  const bytes = rowBytes + offsets.byteLength + (encodedReport?.length ?? 0) + (encodedMeta?.length ?? 0);
  if (bytes > byteLimit) throw snapshotTooLarge();
  return { data: Buffer.concat(rows, rowBytes), offsets, report: encodedReport, meta: encodedMeta, bytes };
}

function readItems({ data, offsets }, start, end) {
  const items = [];
  for (let index = start; index < end; index++) {
    items.push(copyValue(data.subarray(offsets[index], offsets[index + 1])));
  }
  return items;
}

function readMeta(snapshot) {
  return snapshot.meta ? { meta: copyValue(snapshot.meta) } : {};
}

function createSnapshotStore({
  ttlMs = 15 * 60 * 1000,
  maxSnapshots = 100,
  maxSnapshotBytes = 8 * 1024 * 1024,
  maxTotalBytes = 32 * 1024 * 1024,
  maxItems = 25_000,
  now = Date.now
} = {}) {
  for (const [option, value] of Object.entries({ ttlMs, maxSnapshots, maxSnapshotBytes, maxTotalBytes, maxItems })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(option + ' must be a positive integer');
  }
  if (maxSnapshotBytes > 0xFFFFFFFF) throw new RangeError('maxSnapshotBytes exceeds the row offset range');
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  const snapshots = new Map();
  let retainedBytes = 0;

  function remove(id, snapshot) {
    snapshots.delete(id);
    retainedBytes -= snapshot.bytes;
  }

  function removeExpired(time) {
    for (const [id, snapshot] of snapshots) {
      if (snapshot.expiresAt <= time) remove(id, snapshot);
    }
  }

  // The caller authorizes every request before using a snapshot in its server-defined scope.
  function find(snapshotId, { sessionId, scope }) {
    removeExpired(now());
    const snapshot = snapshots.get(snapshotId);
    if (!snapshot) {
      throw new SnapshotError(410, 'SNAPSHOT_EXPIRED', 'Kết quả đã hết hiệu lực. Hãy tải lại danh sách để truy vấn lại.');
    }
    if (snapshot.sessionId !== sessionId || snapshot.scope !== scope) {
      throw new SnapshotError(403, 'SNAPSHOT_FORBIDDEN', 'Không có quyền truy cập kết quả này.');
    }
    return snapshot;
  }

  function storeFull() {
    return new SnapshotError(503, 'SNAPSHOT_STORE_FULL', 'Tạm thời chưa thể lưu kết quả. Vui lòng thử lại sau.');
  }

  function makeSpace(bytes) {
    let count = snapshots.size;
    let totalBytes = retainedBytes;
    const fits = () => count < maxSnapshots && totalBytes + bytes <= maxTotalBytes;
    if (fits()) return;

    const unused = [];
    for (const [id, snapshot] of snapshots) {
      if (!snapshot.retired) continue;
      unused.push([id, snapshot]);
      count--;
      totalBytes -= snapshot.bytes;
      if (fits()) break;
    }
    if (!fits()) throw storeFull();
    for (const [id, snapshot] of unused) remove(id, snapshot);
  }

  function retire(ids, sessionId) {
    for (const id of ids) {
      const snapshot = snapshots.get(id);
      if (snapshot?.sessionId === sessionId) snapshot.retired = true;
    }
  }

  function create({ sessionId, scope, items, report, meta }) {
    if (typeof sessionId !== 'string' || !sessionId || typeof scope !== 'string' || !scope || !Array.isArray(items)) {
      throw new TypeError('A snapshot needs a sessionId, a scope and an items array');
    }
    if (items.length > maxItems) throw snapshotTooLarge();
    const time = now();
    removeExpired(time);

    const encoded = encodeProjection(items, report, meta, maxSnapshotBytes);
    makeSpace(encoded.bytes);
    const id = randomUUID();
    snapshots.set(id, { ...encoded, sessionId, scope, expiresAt: time + ttlMs, total: items.length });
    retainedBytes += encoded.bytes;
    return id;
  }

  function page(snapshotId, access, { page = 1, pageSize = 25 } = {}) {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new SnapshotError(400, 'INVALID_SNAPSHOT_PAGE', 'Trang phải là số nguyên dương và kích thước trang từ 1 đến 100.');
    }
    const snapshot = find(snapshotId, access);
    if (page > Math.max(1, Math.ceil(snapshot.total / pageSize))) {
      throw new SnapshotError(400, 'INVALID_SNAPSHOT_PAGE', 'Trang nằm ngoài phạm vi kết quả đang xem.');
    }
    const start = (page - 1) * pageSize;
    const items = readItems(snapshot, start, Math.min(start + pageSize, snapshot.total));
    return { snapshotId, items, total: snapshot.total, page, pageSize, ...readMeta(snapshot) };
  }

  function read(snapshotId, access) {
    const snapshot = find(snapshotId, access);
    return {
      items: readItems(snapshot, 0, snapshot.total),
      report: snapshot.report ? copyValue(snapshot.report) : undefined,
      ...readMeta(snapshot)
    };
  }

  return { create, page, read, retire };
}

async function withConsistentListRead(pool, read) {
  const connection = await pool.getConnection();
  let started = false;
  let reusable = false;
  try {
    // SET TRANSACTION applies to the next transaction on this connection only.
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    started = true;
    const result = await read(connection);
    await connection.commit();
    reusable = true;
    return result;
  } catch (error) {
    if (started) {
      try {
        await connection.rollback();
        reusable = true;
      } catch {
        // Discard a connection whose transaction state could not be reset.
      }
    }
    throw error;
  } finally {
    if (reusable) connection.release();
    else connection.destroy();
  }
}

module.exports = { createSnapshotStore, withConsistentListRead, SnapshotError };
