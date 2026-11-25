'use strict';

class ListQueryError extends Error {
  constructor(field) {
    super(`Điều kiện ${field} không hợp lệ.`);
    this.status = 400;
    this.code = 'INVALID_LIST_QUERY';
  }
}

function normalizeSearchText(value) {
  return value.normalize('NFD').toLowerCase().replace(/\p{M}/gu, '')
    .replaceAll('đ', 'd').trim().replace(/\s+/gu, ' ');
}

// Route-owned SQL expression for existing Vietnamese text columns. The sensitive
// collation keeps the character classes literal before the binary substring check.
function vietnameseSearchColumn(column) {
  const accents = [
    ['a', 'àáảãạăằắẳẵặâầấẩẫậ'], ['e', 'èéẻẽẹêềếểễệ'], ['i', 'ìíỉĩị'],
    ['o', 'òóỏõọôồốổỗộơờớởỡợ'], ['u', 'ùúủũụưừứửữự'], ['y', 'ỳýỷỹỵ']
  ];
  let folded = `REPLACE(LOWER(CONVERT(${column} USING utf8mb4)) COLLATE utf8mb4_0900_as_cs, 'đ', 'd')`;
  for (const [letter, marks] of accents) folded = `REGEXP_REPLACE(${folded}, '[${marks}]', '${letter}')`;
  folded = `REGEXP_REPLACE(${folded}, CONCAT(CHAR(92 USING utf8mb4), 'p{M}'), '')`;
  const whitespace = '[\u0009-\u000d \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+';
  return `TRIM(REGEXP_REPLACE(${folded}, '${whitespace}', ' '))`;
}

function scalar(value, field, maxLength) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new ListQueryError(field);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new ListQueryError(field);
  return trimmed;
}

function integer(value, field, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new ListQueryError(field);
  }
  return number;
}

function decimal(value, field) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new ListQueryError(field);
  const [whole, fraction = ''] = value.split('.');
  const digits = whole.replace(/^0+(?=\d)/, '');
  if (digits.length > 16) throw new ListQueryError(field);
  return digits + '.' + fraction.padEnd(2, '0');
}

function date(value, field) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw new ListQueryError(field);
  const parsed = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ListQueryError(field);
  }
  return value;
}

function time(value, field) {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) throw new ListQueryError(field);
  return value.length === 5 ? value + ':00' : value;
}

function phone(value, field) {
  const digits = value.replace(/[().\s-]/gu, '');
  if (!/^\d{8,15}$/.test(digits)) throw new ListQueryError(field);
  return digits;
}

function parseFilter(value, field, filter) {
  switch (filter.type) {
    case 'text': return normalizeSearchText(value);
    case 'exact': return value;
    case 'phone': return phone(value, field);
    case 'integer': return integer(value, field, filter.min, filter.max);
    case 'decimal': return decimal(value, field);
    case 'date': return date(value, field);
    case 'time': return time(value, field);
    case 'enum':
      if (filter.values.includes(value)) return value;
      break;
    case 'boolean':
      if (value === 'true' || value === 'false') return value === 'true';
      break;
    default: throw new TypeError(`Unknown filter type for ${field}`);
  }
  throw new ListQueryError(field);
}

function filterValues(raw, field, filter) {
  const inputs = filter.multiple && Array.isArray(raw) ? raw : [raw];
  if (inputs.length > (filter.maxValues ?? 50)) throw new ListQueryError(field);
  return Array.from(new Set(inputs
    .map(value => scalar(value, field, filter.maxLength ?? 100))
    .filter(Boolean)
    .map(value => parseFilter(value, field, filter))
    .filter(value => value !== '')));
}

function contains(column, accentInsensitive) {
  if (accentInsensitive) {
    return `CONVERT(${column} USING utf8mb4) COLLATE utf8mb4_0900_ai_ci LIKE
      CONCAT('%', REPLACE(REPLACE(REPLACE(?, '!', '!!'), '%', '!%'), '_', '!_'), '%') ESCAPE '!'`;
  }
  return `LOCATE(CAST(? AS BINARY), CAST(${column} AS BINARY)) > 0`;
}

function predicate(filter, values, accentInsensitive) {
  const { column } = filter;
  switch (filter.operator ?? '=') {
    case 'contains': return values.map(() => contains(column, accentInsensitive)).join(' OR ');
    case '=':
      return values.length === 1 ? `${column} = ?` : `${column} IN (${values.map(() => '?').join(', ')})`;
    case '>=': return `${column} >= ?`;
    case '<=': return `${column} <= ?`;
    case 'throughDate':
      return values[0] === '9999-12-31' ? `${column} IS NOT NULL` : `${column} < DATE_ADD(?, INTERVAL 1 DAY)`;
    default: throw new TypeError(`Unknown list filter operator for ${column}`);
  }
}

function exceeds(from, to, type) {
  if (type === 'decimal') return BigInt(from.replace('.', '')) > BigInt(to.replace('.', ''));
  return from > to;
}

function listOrder(raw, options) {
  const input = scalar(raw, 'sort', 150) || options.defaultSort;
  const fields = input.split(',');
  if (fields.length > 2) throw new ListQueryError('sort');
  const usedFields = new Set();
  const order = new Map();
  for (const field of fields) {
    const match = /^([A-Za-z][A-Za-z0-9_]*):(asc|desc)$/.exec(field);
    if (!match || !Object.hasOwn(options.sort, match[1]) || usedFields.has(match[1])) {
      throw new ListQueryError('sort');
    }
    const [, name, direction] = match;
    usedFields.add(name);
    for (const column of [].concat(options.sort[name])) {
      if (!order.has(column)) order.set(column, direction.toUpperCase());
    }
  }
  for (const column of options.tieBreakers) {
    if (!order.has(column)) order.set(column, 'ASC');
  }
  return order;
}

// SQL expressions in the options are supplied by the route. Text columns use
// the same space and đ folding as the input. The optional accent-insensitive
// comparison also handles precomposed foreign accents in existing records.
// A filter without a column is parsed for a route-specific predicate, e.g. EXISTS.
function parseListQuery(query, options) {
  const { searchColumns = [], phoneColumn, filters = {}, ranges = [], accentInsensitive = false } = options;
  const columns = phoneColumn ? [...searchColumns, phoneColumn] : searchColumns;
  const keyword = normalizeSearchText(scalar(query.q, 'q', 100));
  if (keyword && !columns.length) throw new ListQueryError('q');
  const digits = keyword.replace(/[().\s-]/gu, '');
  const terms = new Set(keyword.split(' ').filter(Boolean));
  const conditions = [];
  const params = [];
  const parsedFilters = Object.create(null);
  const keywordClauses = [];
  for (const term of terms) {
    keywordClauses.push(`(${columns.map(column => contains(column, accentInsensitive)).join(' OR ')})`);
    params.push(...columns.map(() => term));
  }
  if (phoneColumn && digits !== keyword && /^\d{8,15}$/.test(digits)) {
    conditions.push(`((${keywordClauses.join(' AND ')}) OR ${contains(phoneColumn, accentInsensitive)})`);
    params.push(digits);
  } else {
    conditions.push(...keywordClauses);
  }
  for (const [field, raw] of Object.entries(query)) {
    if (field === 'q' || field === 'sort') continue;
    if (!Object.hasOwn(filters, field)) throw new ListQueryError(field);
    const filter = filters[field];
    const values = filterValues(raw, field, filter);
    if (!values.length) continue;
    parsedFilters[field] = filter.multiple ? values : values[0];
    if (!filter.column) continue;
    if (filter.multiple && filter.operator && !['=', 'contains'].includes(filter.operator)) {
      throw new TypeError(`Unsupported operator for multiple values of ${field}`);
    }
    conditions.push(`(${predicate(filter, values, accentInsensitive)})`);
    if (filter.operator !== 'throughDate' || values[0] !== '9999-12-31') params.push(...values);
  }
  for (const [from, to] of ranges) {
    if (Object.hasOwn(parsedFilters, from) && Object.hasOwn(parsedFilters, to) &&
        exceeds(parsedFilters[from], parsedFilters[to], filters[from].type)) {
      throw new ListQueryError(`${from}/${to}`);
    }
  }
  const order = listOrder(query.sort, options);
  const orderBy = Array.from(order, ([column, direction]) => `${column} ${direction}`).join(', ');
  return { filters: parsedFilters, conditions, params, terms, order, orderBy };
}

function parseListPagination(page, pageSize) {
  return {
    page: page === undefined ? 1 : integer(scalar(page, 'page', 16), 'page', 1),
    pageSize: pageSize === undefined ? 25 : integer(scalar(pageSize, 'pageSize', 3), 'pageSize', 1, 100)
  };
}

module.exports = { ListQueryError, normalizeSearchText, vietnameseSearchColumn, parseListQuery, parseListPagination };
