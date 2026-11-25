'use strict';

window.ListQuery = (() => {
  const resultParams = new Set(['snapshotId', 'page', 'pageSize']);

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

  function create({ defaults = {}, pageSize = 25, load, onChange = () => {} }) {
    const defaultQuery = copyQuery(defaults);
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
        snapshotId: getSnapshotId()
      };
    }

    async function request(params) {
      const previous = pending;
      const controller = new AbortController();
      pending = controller;
      previous?.abort();
      status = 'loading';
      error = null;
      onChange(getState());

      try {
        const next = await load(params, { signal: controller.signal });
        if (pending !== controller) return;
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
      return request({ ...copyQuery(applied), page: 1, ...(pageSize === null ? {} : { pageSize }) });
    }

    return {
      getState, getSnapshotId,
      setDraft(changes) {
        draft = copyQuery({ ...draft, ...changes });
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

  return { create, loadFrom };
})();
