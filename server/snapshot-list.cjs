'use strict';

const { ListQueryError, parseListPagination, parseListQuery } = require('./list-query.cjs');
const { SnapshotError, withConsistentListRead } = require('./list-snapshots.cjs');
const { sendListWorkbook } = require('./list-workbook.cjs');

function accessScope(req, scope) {
  return { sessionId: req.sessionID, scope: typeof scope === 'function' ? scope(req) : scope };
}

function readSnapshotId(raw) {
  if (typeof raw !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    throw new ListQueryError('snapshotId');
  }
  return raw.toLowerCase();
}

function only(query, keys) {
  for (const key of Object.keys(query)) {
    if (!keys.includes(key)) throw new ListQueryError(key);
  }
}

function handleListRequest(run) {
  return async (req, res) => {
    if (!req.session?.user || !req.sessionID) {
      return res.status(401).json({ message: 'Vui lòng đăng nhập.' });
    }
    res.set('Cache-Control', 'no-store');
    try {
      return await run(req, res);
    } catch (error) {
      if (error instanceof ListQueryError || error instanceof SnapshotError) {
        return res.status(error.status).json({ code: error.code, message: error.message });
      }
      throw error;
    }
  };
}

// The route supplies its authorization middleware and a scope that includes any parent
// record/key. load uses the provided read-only connection, returning the full ordered
// items, optional list metadata, and optional report data from the same read.
// workbook maps that frozen data.
function createSnapshotList({ store, pool, scope, query, load, workbook, paginated = true }) {
  const list = handleListRequest(async (req, res) => {
    const { page, pageSize, snapshotId: rawId, ...filters } = req.query;
    const pagination = parseListPagination(page, pageSize);
    if (!paginated && pagination.page !== 1) throw new ListQueryError('page');
    if (rawId === undefined && pagination.page !== 1) throw new ListQueryError('page');
    const access = accessScope(req, scope);
    let snapshotId;
    if (rawId !== undefined) {
      only(filters, []);
      snapshotId = readSnapshotId(rawId);
    } else {
      const selection = parseListQuery(filters, query);
      const snapshot = await withConsistentListRead(pool, connection => load(connection, selection, req));
      snapshotId = store.create({ ...snapshot, ...access });
    }
    if (paginated) return res.json(store.page(snapshotId, access, pagination));
    const { items, meta } = store.read(snapshotId, access);
    return res.json({
      snapshotId, items, total: items.length, page: 1, pageSize: Math.max(1, items.length),
      ...(meta === undefined ? {} : { meta })
    });
  });

  if (!workbook) return { list };
  const exportXlsx = handleListRequest(async (req, res) => {
    only(req.query, ['snapshotId']);
    const snapshotId = readSnapshotId(req.query.snapshotId);
    const data = store.read(snapshotId, accessScope(req, scope));
    return sendListWorkbook(res, workbook(data, req));
  });

  return { list, exportXlsx };
}

module.exports = { createSnapshotList, handleListRequest, only, readSnapshotId };
