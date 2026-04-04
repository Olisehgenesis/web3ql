/**
 * @file   query.ts
 * @notice Web3QL v1.1 — client-side query engine.
 *
 * After decrypting records from the chain, this module provides:
 *   • WHERE filtering   — eq, ne, gt, gte, lt, lte, in, notIn, like, between, isNull, isNotNull
 *   • ORDER BY          — multi-column, ASC/DESC
 *   • LIMIT / OFFSET    — pagination over decrypted records
 *   • SELECT projection — pick only specific fields
 *   • DISTINCT          — deduplicate on a column value
 *   • COUNT / SUM / AVG / MIN / MAX / GROUP BY aggregations
 *
 * All operations run in-process on the decrypted plaintext — the chain
 * sees only ciphertext. For large tables, use the relay-maintained index
 * endpoint (v1.2) to avoid decrypting every record.
 *
 * Usage:
 * ─────────────────────────────────────────────────────────────
 *   const results = query(records)
 *     .where('age', 'gt', 18n)
 *     .where('name', 'like', 'Ali%')
 *     .orderBy('age', 'asc')
 *     .limit(10)
 *     .select(['name', 'age'])
 *     .execute();
 *
 *   const stats = query(records)
 *     .where('active', 'eq', true)
 *     .aggregate({ count: '*', avg: 'score', max: 'score' });
 * ─────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

export type WhereOperator =
  | 'eq' | 'ne'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'notIn'
  | 'like' | 'ilike'
  | 'between'
  | 'isNull' | 'isNotNull';

export interface WhereClause {
  field   : string;
  op      : WhereOperator;
  /** Single value for eq/ne/gt/gte/lt/lte/like/ilike/isNull/isNotNull */
  value?  : unknown;
  /** Array for `in` and `notIn` */
  values? : unknown[];
  /** Two-element tuple for `between` */
  range?  : [unknown, unknown];
}

export type SortDirection = 'asc' | 'desc';

export interface OrderByClause {
  field    : string;
  direction: SortDirection;
}

export interface AggregateOptions {
  count?: '*' | string;
  sum?  : string;
  avg?  : string;
  min?  : string;
  max?  : string;
  groupBy?: string;
  /** Time-bucketing: group timestamps by 'minute'|'hour'|'day'|'week'|'month'|'year' */
  timeBucket?: { field: string; unit: TimeBucketUnit };
  /** HAVING — filter on aggregated values (applied after aggregation) */
  having?: HavingClause[];
}

export type TimeBucketUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

export interface HavingClause {
  /** 'count'|'sum'|'avg'|'min'|'max' */
  aggregate: 'count' | 'sum' | 'avg';
  op       : 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
  value    : number;
}

export interface AggregateResult {
  group?: unknown;
  count?: number;
  sum?  : number;
  avg?  : number;
  min?  : unknown;
  max?  : unknown;
}

// ─────────────────────────────────────────────────────────────
//  JOIN types
// ─────────────────────────────────────────────────────────────

export type JoinType = 'inner' | 'left' | 'right';

export interface JoinClause {
  type      : JoinType;
  right     : Row[];
  on        : { left: string; right: string };
  /** Prefix added to right-side fields to avoid collision. Default: 'j_' */
  prefix?   : string;
}

// ─────────────────────────────────────────────────────────────
//  Time-bucket helper
// ─────────────────────────────────────────────────────────────

function truncateTimestamp(ms: number, unit: TimeBucketUnit): number {
  const d = new Date(ms);
  switch (unit) {
    case 'minute':
      d.setUTCSeconds(0, 0);
      break;
    case 'hour':
      d.setUTCMinutes(0, 0, 0);
      break;
    case 'day':
      d.setUTCHours(0, 0, 0, 0);
      break;
    case 'week': {
      const dow = d.getUTCDay(); // 0=Sun
      d.setUTCDate(d.getUTCDate() - dow);
      d.setUTCHours(0, 0, 0, 0);
      break;
    }
    case 'month':
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      break;
    case 'year':
      d.setUTCMonth(0, 1);
      d.setUTCHours(0, 0, 0, 0);
      break;
  }
  return d.getTime();
}

// ─────────────────────────────────────────────────────────────
//  HAVING filter
// ─────────────────────────────────────────────────────────────

function applyHaving(result: AggregateResult, having: HavingClause[]): boolean {
  for (const h of having) {
    const val = result[h.aggregate] ?? 0;
    switch (h.op) {
      case 'eq':  if (val !== h.value) return false; break;
      case 'ne':  if (val === h.value) return false; break;
      case 'gt':  if (val <= h.value)  return false; break;
      case 'gte': if (val < h.value)   return false; break;
      case 'lt':  if (val >= h.value)  return false; break;
      case 'lte': if (val > h.value)   return false; break;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
//  Predicate evaluator
// ─────────────────────────────────────────────────────────────

function likeToRegex(pattern: string, caseInsensitive: boolean): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, caseInsensitive ? 'i' : '');
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function applyWhere(row: Row, clause: WhereClause): boolean {
  const rawVal = row[clause.field];

  switch (clause.op) {
    case 'eq':       return rawVal === clause.value;
    case 'ne':       return rawVal !== clause.value;
    case 'gt':       return compare(rawVal, clause.value) > 0;
    case 'gte':      return compare(rawVal, clause.value) >= 0;
    case 'lt':       return compare(rawVal, clause.value) < 0;
    case 'lte':      return compare(rawVal, clause.value) <= 0;
    case 'in':       return (clause.values ?? []).includes(rawVal);
    case 'notIn':    return !(clause.values ?? []).includes(rawVal);
    case 'like':     return likeToRegex(String(clause.value), false).test(String(rawVal));
    case 'ilike':    return likeToRegex(String(clause.value), true).test(String(rawVal));
    case 'between': {
      const [lo, hi] = clause.range!;
      return compare(rawVal, lo) >= 0 && compare(rawVal, hi) <= 0;
    }
    case 'isNull':    return rawVal === null || rawVal === undefined;
    case 'isNotNull': return rawVal !== null && rawVal !== undefined;
    default:          return true;
  }
}

// ─────────────────────────────────────────────────────────────
//  QueryBuilder
// ─────────────────────────────────────────────────────────────

export class QueryBuilder<T extends Row> {
  private _rows    : T[];
  private _wheres  : WhereClause[]   = [];
  private _orders  : OrderByClause[] = [];
  private _limitN? : number;
  private _offsetN?: number;
  private _fields? : string[];
  private _distinct?: string;
  private _joins   : JoinClause[]    = [];

  constructor(rows: T[]) {
    this._rows = rows;
  }

  // ── Filtering ───────────────────────────────────────────────

  /**
   * Add a WHERE condition. Multiple calls are ANDed together.
   *
   * @example
   *   .where('age', 'gt', 18n)
   *   .where('status', 'in', undefined, ['active', 'pending'])
   *   .where('score', 'between', undefined, undefined, [0, 100])
   *   .where('deletedAt', 'isNull')
   */
  where(field: string, op: 'isNull' | 'isNotNull')                          : this;
  where(field: string, op: 'in' | 'notIn',       values: unknown[])         : this;
  where(field: string, op: 'between',             range: [unknown, unknown]) : this;
  where(field: string, op: WhereOperator,         value?: unknown)           : this;
  where(
    field  : string,
    op     : WhereOperator,
    valueOrArr?: unknown,
    _unused2?: unknown,
  ): this {
    if (op === 'isNull' || op === 'isNotNull') {
      this._wheres.push({ field, op });
    } else if (op === 'in' || op === 'notIn') {
      this._wheres.push({ field, op, values: valueOrArr as unknown[] });
    } else if (op === 'between') {
      this._wheres.push({ field, op, range: valueOrArr as [unknown, unknown] });
    } else {
      this._wheres.push({ field, op, value: valueOrArr });
    }
    return this;
  }

  // ── Sorting ─────────────────────────────────────────────────

  /** Add an ORDER BY clause. Multiple calls are applied in sequence. */
  orderBy(field: string, direction: SortDirection = 'asc'): this {
    this._orders.push({ field, direction });
    return this;
  }

  // ── Pagination ──────────────────────────────────────────────

  limit(n: number): this  { this._limitN  = n; return this; }
  offset(n: number): this { this._offsetN = n; return this; }

  // ── Projection ──────────────────────────────────────────────

  /** Return only the specified fields from each row. */
  select(fields: string[]): this { this._fields = fields; return this; }

  /** Deduplicate rows where `field` has the same value. */
  distinct(field: string): this { this._distinct = field; return this; }

  // ── JOIN ────────────────────────────────────────────────────

  /**
   * Join this table with a `right` array on matching key columns.
   *
   * @example
   *   query(orders)
   *     .join('inner', users, { left: 'userId', right: 'id' })
   *     .execute()
   *   // Each matched row = order fields + user fields prefixed with 'j_'
   *
   *   query(orders)
   *     .join('left', users, { left: 'userId', right: 'id' }, 'user_')
   *     .select(['id', 'user_name', 'amount'])
   *     .execute()
   */
  join(
    type  : JoinType,
    right : Row[],
    on    : { left: string; right: string },
    prefix: string = 'j_',
  ): this {
    this._joins.push({ type, right, on, prefix });
    return this;
  }

  // ── Terminal: execute ───────────────────────────────────────

  execute(): Partial<T>[] {
    // 0. Apply JOINs
    let rows: Row[] = [...this._rows];
    for (const j of this._joins) {
      rows = applyJoin(rows, j);
    }

    // 1. Filter
    rows = this._wheres.length
      ? rows.filter((r) => this._wheres.every((w) => applyWhere(r, w)))
      : rows;

    // 2. Distinct
    if (this._distinct) {
      const seen = new Set<unknown>();
      const field = this._distinct;
      rows = rows.filter((r) => {
        const v = r[field];
        if (seen.has(v)) return false;
        seen.add(v);
        return true;
      });
    }

    // 3. Sort
    if (this._orders.length) {
      rows.sort((a, b) => {
        for (const ord of this._orders) {
          const cmp = compare(a[ord.field], b[ord.field]);
          if (cmp !== 0) return ord.direction === 'asc' ? cmp : -cmp;
        }
        return 0;
      });
    }

    // 4. Offset + Limit
    const start = this._offsetN ?? 0;
    const end   = this._limitN != null ? start + this._limitN : undefined;
    rows = rows.slice(start, end);

    // 5. Projection
    if (this._fields) {
      const fields = this._fields;
      return rows.map((r) => {
        const out: Row = {};
        for (const f of fields) out[f] = r[f];
        return out as Partial<T>;
      });
    }

    return rows as Partial<T>[];
  }

  // ── Terminal: aggregate ─────────────────────────────────────

  /**
   * Run aggregation functions over filtered (but not sorted/limited) rows.
   *
   * @example
   *   query(rows).where('active', 'eq', true).aggregate({ count: '*', avg: 'score' })
   *   // => [{ count: 42, avg: 78.5 }]
   *
   *   query(rows).aggregate({ count: '*', groupBy: 'status' })
   *   // => [{ group: 'active', count: 30 }, { group: 'inactive', count: 12 }]
   */
  aggregate(opts: AggregateOptions): AggregateResult[] {
    // Apply JOINs first
    let allRows: Row[] = [...this._rows];
    for (const j of this._joins) allRows = applyJoin(allRows, j);

    const filtered: Row[] = this._wheres.length
      ? allRows.filter((r) => this._wheres.every((w) => applyWhere(r, w)))
      : allRows;

    // Determine grouping key
    const getGroupKey = (row: Row): unknown => {
      if (opts.timeBucket) {
        const rawMs = Number(row[opts.timeBucket.field]);
        return truncateTimestamp(rawMs, opts.timeBucket.unit);
      }
      if (opts.groupBy) return row[opts.groupBy];
      return '__all__';
    };

    const groups = new Map<unknown, Row[]>();
    for (const row of filtered) {
      const gv = getGroupKey(row);
      const bucket = groups.get(gv);
      if (bucket) bucket.push(row);
      else groups.set(gv, [row]);
    }

    const noGroupBy = !opts.groupBy && !opts.timeBucket;
    if (noGroupBy) {
      return [this._aggregateGroup('__all__', filtered, opts, noGroupBy)];
    }

    const results = Array.from(groups.entries()).map(([groupVal, rows]) =>
      this._aggregateGroup(groupVal, rows, opts, false),
    );

    // Apply HAVING filter
    if (opts.having?.length) {
      return results.filter((r) => applyHaving(r, opts.having!));
    }
    return results;
  }

  private _aggregateGroup(
    groupVal: unknown,
    rows    : Row[],
    opts    : AggregateOptions,
    omitGroup: boolean,
  ): AggregateResult {
    const result: AggregateResult = {};
    if (!omitGroup) result.group = groupVal;

    if (opts.count != null) {
      result.count = rows.length;
    }
    if (opts.sum) {
      result.sum = rows.reduce((acc, r) => acc + Number(r[opts.sum!] ?? 0), 0);
    }
    if (opts.avg) {
      result.avg = rows.length
        ? rows.reduce((acc, r) => acc + Number(r[opts.avg!] ?? 0), 0) / rows.length
        : 0;
    }
    if (opts.min) {
      const vals = rows.map((r) => r[opts.min!]).filter((v) => v != null);
      result.min = vals.reduce<unknown>((a, b) => (compare(a, b) <= 0 ? a : b), vals[0]);
    }
    if (opts.max) {
      const vals = rows.map((r) => r[opts.max!]).filter((v) => v != null);
      result.max = vals.reduce<unknown>((a, b) => (compare(a, b) >= 0 ? a : b), vals[0]);
    }
    return result;
  }
}

// ─────────────────────────────────────────────────────────────
//  JOIN implementation
// ─────────────────────────────────────────────────────────────

function applyJoin(left: Row[], j: JoinClause): Row[] {
  const prefix = j.prefix ?? 'j_';
  const rightIndex = new Map<unknown, Row[]>();
  for (const r of j.right) {
    const k = r[j.on.right];
    const bucket = rightIndex.get(k);
    if (bucket) bucket.push(r);
    else rightIndex.set(k, [r]);
  }

  const result: Row[] = [];

  for (const l of left) {
    const k = l[j.on.left];
    const matches = rightIndex.get(k);

    if (matches && matches.length > 0) {
      // INNER or LEFT: emit for each match
      for (const r of matches) {
        const merged: Row = { ...l };
        for (const [rk, rv] of Object.entries(r)) {
          merged[`${prefix}${rk}`] = rv;
        }
        result.push(merged);
      }
    } else {
      // LEFT JOIN: emit left row with nulled right fields
      if (j.type === 'left') {
        result.push({ ...l });
      }
      // INNER JOIN: no match → skip
    }
  }

  // RIGHT JOIN: also emit right rows with no match on left
  if (j.type === 'right') {
    const leftKeys = new Set(left.map((l) => l[j.on.left]));
    for (const r of j.right) {
      if (!leftKeys.has(r[j.on.right])) {
        const merged: Row = {};
        for (const [rk, rv] of Object.entries(r)) {
          merged[`${prefix}${rk}`] = rv;
        }
        result.push(merged);
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
//  Factory helper
// ─────────────────────────────────────────────────────────────

/** Fluent entry point: `query(records).where(...).orderBy(...).execute()` */
export function query<T extends Row>(rows: T[]): QueryBuilder<T> {
  return new QueryBuilder(rows);
}
