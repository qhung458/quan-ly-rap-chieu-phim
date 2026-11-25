'use strict';

window.ListQuery = (() => {
  const resultParams = new Set(['snapshotId', 'page', 'pageSize']);
  const activeSnapshots = new Set();
  const downloads = new Map();
  const pendingRetirement = new Set();

  function retireSnapshots(ids, wait = false) {
    const unused = ids.filter(id => {
      if (!id) return false;
      if (!downloads.has(id)) return true;
      pendingRetirement.add(id);
      return false;
    });
    if (!unused.length) return;
    const url = '/api/list-snapshots/retire';
    const json = JSON.stringify(unused);
    if (wait && window.fetch) {
      return window.fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: json })
        .catch(() => {});
    }
    window.navigator?.sendBeacon?.(url, new Blob([json], { type: 'application/json' }));
  }

  function snapshotOwner() {
    let id;
    let retiring;
    return (next, wait) => {
      if (id === next) return retiring;
      if (id) {
        activeSnapshots.delete(id);
        const marked = retireSnapshots([id], wait);
        if (marked) {
          retiring = marked;
          marked.then(() => { if (retiring === marked) retiring = undefined; });
        }
      }
      id = next;
      if (id) activeSnapshots.add(id);
      return retiring;
    };
  }

  function protectSnapshot(id) {
    downloads.set(id, (downloads.get(id) ?? 0) + 1);
    return () => {
      const count = downloads.get(id);
      if (count > 1) downloads.set(id, count - 1);
      else {
        downloads.delete(id);
        if (pendingRetirement.delete(id)) retireSnapshots([id]);
      }
    };
  }

  window.addEventListener?.('pagehide', event => {
    if (!event.persisted) retireSnapshots([...activeSnapshots]);
  });

  function copyQuery(query) {
    return Object.fromEntries(Object.entries(query)
      .filter(([name]) => !resultParams.has(name))
      .map(([name, value]) => [name, Array.isArray(value) ? [...value] : value]));
  }

  function removeCondition(query, name, value) {
    const selected = query[name];
    if (value !== undefined && Array.isArray(selected)) {
      const remaining = selected.filter(item => item !== value);
      if (remaining.length) return { ...query, [name]: remaining };
    }
    const next = { ...query };
    // An option can have been changed independently in the draft.
    if (value === undefined || Array.isArray(selected) || selected === value) delete next[name];
    return next;
  }

  function loadFrom(endpoint) {
    return async (params, { signal } = {}) => {
      const url = new URL(endpoint, window.location.href);
      if (url.origin !== window.location.origin) throw new Error('Địa chỉ tải danh sách không hợp lệ.');
      url.search = '';
      for (const [name, value] of Object.entries(params)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          if (item !== null && item !== undefined && item !== '') url.searchParams.append(name, item);
        }
      }
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const fallback = response.status === 410
          ? 'Kết quả đang xem đã hết hạn. Hãy tải lại danh sách.'
          : 'Không tải được danh sách. Vui lòng thử lại.';
        const error = new Error(body?.message || fallback);
        error.status = response.status;
        throw error;
      }
      return response.json();
    };
  }

  function create({ defaults = {}, pageSize = 25, load, onChange = () => {}, ownsSnapshot = true }) {
    const defaultQuery = copyQuery(defaults);
    const keepSnapshot = ownsSnapshot ? snapshotOwner() : () => {};
    let draft = copyQuery(defaultQuery);
    let applied = copyQuery(defaultQuery);
    let status = 'idle';
    let error = null;
    let result = null;
    let pending;

    function getSnapshotId() {
      return status === 'ready' || status === 'empty' ? result.snapshotId : null;
    }

    function getState() {
      return {
        draft: copyQuery(draft), applied: copyQuery(applied), status, error,
        items: result ? structuredClone(result.items) : [], total: result?.total ?? 0,
        page: result?.page ?? 1, pageSize: result?.pageSize ?? pageSize,
        snapshotId: getSnapshotId(), meta: structuredClone(result?.meta ?? null)
      };
    }

    async function request(params, retirement) {
      const previous = pending;
      const controller = new AbortController();
      pending = controller;
      previous?.abort();
      status = 'loading';
      error = null;
      onChange(getState());

      try {
        if (retirement) await retirement;
        if (pending !== controller) return;
        const next = await load(params, { signal: controller.signal });
        if (pending !== controller) {
          if (ownsSnapshot && !params.snapshotId) retireSnapshots([next?.snapshotId]);
          return;
        }
        if (!Array.isArray(next?.items) || !Number.isSafeInteger(next.total) || next.total < 0 ||
            next.page !== params.page || !Number.isSafeInteger(next.pageSize) ||
            next.pageSize < 1 || typeof next.snapshotId !== 'string' || !next.snapshotId ||
            (params.pageSize !== undefined && next.pageSize !== params.pageSize) ||
            (params.snapshotId && (next.snapshotId !== params.snapshotId || next.total !== result.total))) {
          throw new Error('Phản hồi danh sách không khớp với truy vấn đang xem.');
        }
        const offset = (next.page - 1) * next.pageSize;
        if (next.items.length !== Math.min(next.pageSize, next.total - offset) ||
            (next.page > 1 && offset >= next.total)) {
          throw new Error('Số bản ghi trả về không khớp với trang đang xem.');
        }
        result = structuredClone(next);
        keepSnapshot(result.snapshotId);
        status = next.total ? 'ready' : 'empty';
      } catch (requestError) {
        if (pending !== controller) return;
        error = requestError;
        status = 'error';
      }

      pending = null;
      const state = getState();
      onChange(state);
      return state;
    }

    function applyQuery(query) {
      applied = copyQuery(query);
      result = null;
      const params = { ...copyQuery(applied), page: 1, ...(pageSize === null ? {} : { pageSize }) };
      return request(params, keepSnapshot(undefined, true));
    }

    return {
      getState, getSnapshotId,
      setDraft(changes) {
        draft = copyQuery({ ...draft, ...changes });
        onChange(getState());
      },
      clear() {
        const previous = pending;
        pending = null;
        previous?.abort();
        draft = copyQuery(defaultQuery);
        applied = copyQuery(defaultQuery);
        status = 'idle';
        error = null;
        result = null;
        keepSnapshot(undefined, true);
        onChange(getState());
      },
      apply() { return applyQuery(draft); },
      refresh() { return applyQuery(applied); },
      remove(name, value) {
        draft = removeCondition(draft, name, value);
        return applyQuery(removeCondition(applied, name, value));
      },
      reset() {
        draft = copyQuery(defaultQuery);
        return applyQuery(draft);
      },
      goToPage(page) {
        if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('Số trang phải là số nguyên dương.');
        if (!result || pageSize === null) return;
        if (page > Math.max(1, Math.ceil(result.total / result.pageSize))) {
          throw new RangeError('Trang nằm ngoài phạm vi kết quả đang xem.');
        }
        return request({ snapshotId: result.snapshotId, page, pageSize: result.pageSize });
      }
    };
  }

  return { create, loadFrom, snapshotOwner, protectSnapshot, retireSnapshots };
})();
