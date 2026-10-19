import type * as DuckDB from '@duckdb/duckdb-wasm';

/* The tabular side of Corpus. CSV / TSV / Parquet / JSON files become DuckDB tables in
   the browser (self-hosted engine, nothing uploaded). On top: one-pass profiling, data
   quality checks, chart suggestions, and natural-language → SQL with a self-correcting
   retry. The engine (~35 MB) is loaded only when the first table arrives. */

export type Row = Record<string, unknown>;
export interface Column {
  name: string;
  type: string;
  nullPct: number;
  distinct: number;
  min: string | null;
  max: string | null;
  avg: number | null;
  /** Most common values, for low-cardinality text columns. */
  top?: { v: string; n: number }[];
  /** Values outside 1.5×IQR, for numeric columns. */
  outliers?: number;
  /** Exactly one row per value (checked exactly, not estimated). */
  unique?: boolean;
}
export interface Table {
  name: string;
  file: string;
  rows: number;
  columns: Column[];
  sample: Row[];
  issues: { level: 'warn' | 'info'; text: string }[];
}
export interface Result {
  columns: string[];
  rows: Row[];
  ms: number;
}

export const TABULAR = /\.(csv|tsv|parquet|pq|json|jsonl|ndjson)$/i;

let conn: Promise<DuckDB.AsyncDuckDBConnection> | null = null;
let dbRef: DuckDB.AsyncDuckDB | null = null;

function connect() {
  return (conn ??= (async () => {
    const duckdb = await import('@duckdb/duckdb-wasm');
    const [mvpWasm, mvpWorker, ehWasm, ehWorker] = await Promise.all([
      import('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'),
      import('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'),
    ]);
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: mvpWasm.default, mainWorker: mvpWorker.default },
      eh: { mainModule: ehWasm.default, mainWorker: ehWorker.default },
    });
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(bundle.mainWorker!));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    dbRef = db;
    return db.connect();
  })());
}

const plain = (v: unknown): unknown => {
  if (typeof v === 'bigint') return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v.toString();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === 'object' && !Array.isArray(v)) return String(v);
  return v;
};

const isoDate = (v: unknown) => {
  const d = v instanceof Date ? v : new Date(Number(v));
  const iso = d.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
};

export async function query(sql: string, limit = 1000): Promise<Result> {
  const c = await connect();
  const t0 = performance.now();
  const res = await c.query(sql);
  const columns = res.schema.fields.map((f) => f.name);
  // Arrow hands dates and timestamps back as epoch milliseconds.
  const dateCols = new Set(res.schema.fields.filter((f) => /^(Date|Timestamp)/i.test(String(f.type))).map((f) => f.name));
  const rows: Row[] = [];
  const n = Math.min(res.numRows, limit);
  for (let i = 0; i < n; i++) {
    const r = res.get(i)!.toJSON() as Row;
    for (const k of columns) r[k] = dateCols.has(k) && r[k] != null ? isoDate(r[k]) : plain(r[k]);
    rows.push(r);
  }
  return { columns, rows, ms: performance.now() - t0 };
}

export const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const tableName = (file: string) =>
  file.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 't_$1') || 'data';

/** Loads a file into DuckDB and returns its profile. */
export async function loadTable(file: File, taken: string[]): Promise<Table> {
  await connect();
  let name = tableName(file.name);
  for (let i = 2; taken.includes(name); i++) name = `${tableName(file.name)}_${i}`;
  const ext = file.name.split('.').pop()!.toLowerCase();
  const path = `${name}.${ext}`;
  await dbRef!.registerFileBuffer(path, new Uint8Array(await file.arrayBuffer()));
  const reader =
    ext === 'parquet' || ext === 'pq'
      ? `read_parquet('${path}')`
      : ext.startsWith('json') || ext === 'ndjson'
        ? `read_json_auto('${path}')`
        : `read_csv_auto('${path}', sample_size = -1${ext === 'tsv' ? ", delim = '\\t'" : ''})`;
  await query(`CREATE OR REPLACE TABLE ${ident(name)} AS SELECT * FROM ${reader}`);
  return profile(name, file.name);
}

/** One SUMMARIZE pass for every column, then a few targeted checks: top values for
    categories, IQR outliers for numbers, exact uniqueness for ID-like columns. */
export async function profile(name: string, file: string): Promise<Table> {
  const t = ident(name);
  const [summary, count, sample, dupes] = await Promise.all([
    query(`SUMMARIZE ${t}`),
    query(`SELECT count(*) AS n FROM ${t}`),
    query(`SELECT * FROM ${t} LIMIT 8`),
    query(`SELECT count(*) - (SELECT count(*) FROM (SELECT DISTINCT * FROM ${t})) AS d FROM ${t}`),
  ]);
  const rows = Number(count.rows[0].n);
  const columns: Column[] = summary.rows.map((r) => ({
    name: String(r.column_name),
    type: String(r.column_type),
    nullPct: Number(String(r.null_percentage ?? '0').replace('%', '')) || 0,
    distinct: Number(r.approx_unique ?? 0),
    min: r.min == null ? null : String(r.min),
    max: r.max == null ? null : String(r.max),
    avg: r.avg == null || r.avg === '' ? null : Number(r.avg),
  }));
  const q = new Map(summary.rows.map((r) => [String(r.column_name), [Number(r.q25), Number(r.q75)]]));

  const cats = columns.filter((c) => /VARCHAR|BOOL/i.test(c.type) && c.distinct > 0 && c.distinct <= 30);
  const nums = columns.filter((c) => isNum(c.type) && Number.isFinite(q.get(c.name)?.[0]));
  const idLike = columns.filter((c) => rows > 1 && c.distinct >= rows * 0.9);
  await Promise.all([
    ...cats.map(async (c) => {
      const r = await query(`SELECT ${ident(c.name)}::VARCHAR AS v, count(*) AS n FROM ${t} WHERE ${ident(c.name)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
      c.top = r.rows.map((x) => ({ v: String(x.v), n: Number(x.n) }));
      c.distinct = Math.max(c.top.length, c.distinct);
    }),
    nums.length
      ? query(
          `SELECT ${nums
            .map((c) => {
              const [a, b] = q.get(c.name)!;
              const pad = 1.5 * (b - a);
              return `count(*) FILTER (WHERE ${ident(c.name)} < ${a - pad} OR ${ident(c.name)} > ${b + pad}) AS ${ident(c.name)}`;
            })
            .join(', ')} FROM ${t}`,
        ).then((r) => nums.forEach((c) => (c.outliers = Number(r.rows[0][c.name]) || 0)))
      : null,
    idLike.length
      ? query(`SELECT ${idLike.map((c) => `count(DISTINCT ${ident(c.name)}) = count(*) AS ${ident(c.name)}`).join(', ')} FROM ${t}`).then((r) =>
          idLike.forEach((c) => (c.unique = r.rows[0][c.name] === true && c.nullPct === 0)),
        )
      : null,
  ]);

  const issues: Table['issues'] = [];
  const d = Number(dupes.rows[0].d);
  if (d > 0) issues.push({ level: 'warn', text: `${d.toLocaleString()} duplicate row${d > 1 ? 's' : ''}` });
  for (const c of columns) {
    if (c.nullPct >= 20) issues.push({ level: 'warn', text: `${c.name}: ${c.nullPct.toFixed(0)}% missing` });
    else if (c.nullPct > 0) issues.push({ level: 'info', text: `${c.name}: ${c.nullPct.toFixed(1)}% missing` });
    if (rows > 1 && c.distinct <= 1) issues.push({ level: 'info', text: `${c.name}: constant value` });
    if (c.outliers) issues.push({ level: c.outliers > rows * 0.05 ? 'warn' : 'info', text: `${c.name}: ${c.outliers} outlier${c.outliers > 1 ? 's' : ''} (outside 1.5×IQR)` });
    if (c.unique) issues.push({ level: 'info', text: `${c.name}: unique key candidate` });
  }
  if (!issues.some((i) => i.level === 'warn')) issues.unshift({ level: 'info', text: 'No duplicate rows · no column over 20% missing' });
  return { name, file, rows, columns, sample: sample.rows, issues };
}

const isNum = (t: string) => /INT|DOUBLE|FLOAT|DECIMAL|REAL|NUMERIC|HUGEINT/i.test(t);
const isDate = (t: string) => /DATE|TIMESTAMP/i.test(t);
const isCat = (c: Column, rows: number) => /VARCHAR|BOOL/i.test(c.type) && c.distinct > 1 && c.distinct <= Math.min(30, Math.max(2, rows / 2));

export interface ChartSpec {
  title: string;
  kind: 'bar' | 'line' | 'histogram';
  sql: string;
}

/** Chart suggestions from column types: trends over time, totals by category, distributions. */
export function suggestCharts(t: Table): ChartSpec[] {
  const T = ident(t.name);
  const nums = t.columns.filter((c) => isNum(c.type) && c.distinct > 2 && !/(^|_)id$/i.test(c.name));
  const dates = t.columns.filter((c) => isDate(c.type));
  const cats = t.columns.filter((c) => isCat(c, t.rows));
  const out: ChartSpec[] = [];
  if (dates[0] && nums[0])
    out.push({ title: `${nums[0].name} over time`, kind: 'line', sql: `SELECT date_trunc('day', ${ident(dates[0].name)})::DATE AS x, round(sum(${ident(nums[0].name)}), 2) AS y FROM ${T} GROUP BY 1 ORDER BY 1` });
  if (cats[0] && nums[0])
    out.push({ title: `Average ${nums[0].name} by ${cats[0].name}`, kind: 'bar', sql: `SELECT ${ident(cats[0].name)} AS x, round(avg(${ident(nums[0].name)}), 2) AS y FROM ${T} GROUP BY 1 ORDER BY 2 DESC LIMIT 15` });
  // A status-like column (values such as "failed" / "error") gets a failure-rate chart.
  const status = t.columns.find((c) => c.top?.some((x) => /fail|error/i.test(x.v)));
  const bad = status?.top?.find((x) => /fail|error/i.test(x.v))?.v;
  const by = cats.find((c) => c !== status);
  if (status && bad && by)
    out.push({ title: `Failure rate % by ${by.name}`, kind: 'bar', sql: `SELECT ${ident(by.name)} AS x, round(100 * avg((${ident(status.name)} = '${bad.replace(/'/g, "''")}')::INT), 1) AS y FROM ${T} GROUP BY 1 ORDER BY 2 DESC LIMIT 15` });
  else if (cats[0])
    out.push({ title: `Rows by ${cats[0].name}`, kind: 'bar', sql: `SELECT ${ident(cats[0].name)} AS x, count(*) AS y FROM ${T} GROUP BY 1 ORDER BY 2 DESC LIMIT 15` });
  if (cats[1])
    out.push({ title: `Rows by ${cats[1].name}`, kind: 'bar', sql: `SELECT ${ident(cats[1].name)} AS x, count(*) AS y FROM ${T} GROUP BY 1 ORDER BY 2 DESC LIMIT 15` });
  if (nums[1] ?? nums[0])
    out.push({ title: `Distribution of ${(nums[1] ?? nums[0]).name}`, kind: 'histogram', sql: `SELECT ${ident((nums[1] ?? nums[0]).name)} AS v FROM ${T} WHERE ${ident((nums[1] ?? nums[0]).name)} IS NOT NULL` });
  return out.slice(0, 4);
}

/** Schema + a few rows, as the model sees it for natural-language questions. */
export function schemaPrompt(t: Table): string {
  const cols = t.columns.map((c) => {
    const note = c.top?.length ? `values: ${c.top.slice(0, 8).map((x) => `'${x.v}'`).join(', ')}` : c.min != null ? `${c.min} to ${c.max}` : '';
    return `  ${ident(c.name)} ${c.type}${note ? `  -- ${note}` : ''}`;
  });
  return `CREATE TABLE ${ident(t.name)} ( -- ${t.rows} rows\n${cols.join(',\n')}\n);`;
}

/** Only one read-only SELECT / WITH statement is allowed from generated SQL. */
const WRITE_WORDS = /\b(insert|update|delete|drop|create|alter|attach|copy|install|load|pragma|export)\b/i;
export function safeSql(sql: string): string {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (!/^(with|select)\b/i.test(s) || /;\s*\S/.test(s) || WRITE_WORDS.test(s.replace(/'[^']*'/g, '')))
    throw new Error('Only a single read-only SELECT query is allowed.');
  return s;
}

/** Pulls SQL out of a model reply (fenced block or bare). */
export const extractSql = (reply: string) => (reply.match(/```(?:sql)?\s*([\s\S]*?)```/i)?.[1] ?? reply).trim();

/** Text summary of a table, indexed like a document so chat can answer "what is this file about". */
export function tableAsText(t: Table): string {
  const num = (v: number | null) => (v == null ? '' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const lines = t.columns.map((c) => {
    if (c.top?.length && c.top.length <= 12) return `${c.name} takes ${c.top.length} values: ${c.top.map((x) => `${x.v} (${x.n})`).join(', ')}.`;
    if (isDate(c.type)) return `${c.name} spans ${c.min} to ${c.max}.`;
    if (isNum(c.type) && c.avg != null) return `${c.name} ranges from ${c.min} to ${c.max}, average ${num(c.avg)}.`;
    return `${c.name} has ${c.distinct.toLocaleString()} distinct values${c.unique ? ' and is unique per row' : ''}.`;
  });
  const date = t.columns.find((c) => isDate(c.type) && c.min);
  const key = t.columns.find((c) => c.unique);
  const cats = t.columns.filter((c) => c.top && c.top.length > 1 && c !== key).slice(0, 3);
  const nums = t.columns.filter((c) => isNum(c.type) && !c.unique).map((c) => c.name);
  const lead = [
    `${t.file} is a table of ${t.rows.toLocaleString()} rows${key ? `, one per ${key.name}` : ''}${date ? `, covering ${date.min} to ${date.max}` : ''}.`,
    cats.length ? `It breaks down by ${cats.map((c) => `${c.name} (${c.top!.slice(0, 3).map((x) => x.v).join(', ')}${c.top!.length > 3 ? '…' : ''})`).join(', ')}.` : '',
    nums.length ? `It measures ${nums.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  return [
    `# ${t.file}: a dataset of ${t.rows.toLocaleString()} rows and ${t.columns.length} columns`,
    lead,
    lines.join('\n'),
    `Data quality: ${t.issues.map((i) => i.text).join('; ')}.`,
  ].join('\n\n');
}

/** Does this question want numbers out of a table rather than prose out of a document? */
export function wantsData(question: string, tables: Table[]): boolean {
  if (!tables.length) return false;
  const q = question.toLowerCase();
  const agg = /\b(how many|count|average|avg|mean|median|total|sum|max(imum)?|min(imum)?|highest|lowest|most|least|top \d+|per\b|by\b|trend|over time|distribution|percent|ratio|rate|sql|query|rows?)\b/;
  const names = tables.flatMap((t) => [t.name, ...t.columns.flatMap((c) => [c.name.toLowerCase(), ...c.name.toLowerCase().split('_').filter((w) => w.length > 3)])]);
  const mentions = names.some((n) => new RegExp(`\\b${n.replace(/[^a-z0-9_]/g, '')}s?\\b`).test(q));
  return mentions && agg.test(q);
}

/** The table a question is most likely about (by column and table name mentions). */
export function pickTable(question: string, tables: Table[]): Table {
  const q = question.toLowerCase();
  const score = (t: Table) => (q.includes(t.name) ? 3 : 0) + t.columns.filter((c) => q.includes(c.name.toLowerCase()) || c.name.toLowerCase().split('_').some((w) => w.length > 3 && q.includes(w))).length;
  return [...tables].sort((a, b) => score(b) - score(a))[0];
}

/* Instant mode (no model): a small rule-based NL→SQL for common analytical questions —
   "average duration by pipeline", "how many failed runs per layer", "cost over time". */
export function heuristicSql(question: string, t: Table): string | null {
  const q = question.toLowerCase();
  const T = ident(t.name);
  const hit = (c: Column) => q.includes(c.name.toLowerCase()) || c.name.toLowerCase().split('_').some((w) => w.length > 3 && new RegExp(`\\b${w}`).test(q));
  const nums = t.columns.filter((c) => isNum(c.type) && hit(c) && !/(^|_)id$/i.test(c.name));
  const by = q.match(/\b(?:by|per|for each|across|grouped by)\s+([a-z_ ]+?)(?:\?|$|,|\band\b|\bwhere\b|\bin\b|\bwith\b)/)?.[1]?.trim();
  const dates = t.columns.filter((c) => isDate(c.type));
  const timeTrend = /over time|trend|daily|per day|by day|by date|weekly|by week|monthly|by month/.test(q);
  const group = timeTrend ? null : by ? t.columns.find((c) => c.name.toLowerCase() === by.replace(/\s+/g, '_') || c.name.toLowerCase().split('_').some((w) => w.length > 2 && by.includes(w))) : null;
  // Filters: a category value named in the question (e.g. "failed").
  const where = t.columns
    .flatMap((c) => (c.top ?? []).filter((x) => x.v.length > 2 && new RegExp(`\\b${x.v.toLowerCase().replace(/[^a-z0-9_]/g, '')}\\b`).test(q)).map((x) => `${ident(c.name)} = '${x.v.replace(/'/g, "''")}'`))
    .filter((w) => !group || !w.startsWith(ident(group.name)));
  const fn = /\b(average|avg|mean)\b/.test(q) ? 'avg' : /\b(total|sum)\b/.test(q) ? 'sum' : /\b(max|maximum|highest|longest|largest|most expensive)\b/.test(q) ? 'max' : /\b(min|minimum|lowest|shortest|smallest|cheapest)\b/.test(q) ? 'min' : /\bmedian\b/.test(q) ? 'median' : null;
  const metric = nums[0] && fn ? `round(${fn}(${ident(nums[0].name)}), 2) AS ${ident(`${fn}_${nums[0].name}`)}` : nums[0] && !/how many|count|number of/.test(q) ? `round(avg(${ident(nums[0].name)}), 2) AS ${ident(`avg_${nums[0].name}`)}` : 'count(*) AS runs';
  const filter = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  if (timeTrend && dates[0]) {
    const unit = /week/.test(q) ? 'week' : /month/.test(q) ? 'month' : 'day';
    return `SELECT date_trunc('${unit}', ${ident(dates[0].name)})::DATE AS ${unit}, ${metric.replace(' AS runs', ' AS rows')}\nFROM ${T}${filter}\nGROUP BY 1 ORDER BY 1`;
  }
  if (group) return `SELECT ${ident(group.name)}, ${metric.replace(' AS runs', ' AS rows')}\nFROM ${T}${filter}\nGROUP BY 1 ORDER BY 2 DESC`;
  if (fn || /how many|count|number of/.test(q) || where.length) return `SELECT ${metric.replace(' AS runs', ' AS rows')}\nFROM ${T}${filter}`;
  return null;
}

/** Prompt for natural-language → SQL (DuckDB dialect). */
export function sqlMessages(question: string, t: Table, error?: { sql: string; message: string }): { role: 'system' | 'user'; content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You write one DuckDB SQL query that answers the question. Reply with only the SQL in a ```sql block. Read-only SELECT. Use exact column names in double quotes. ' +
        'Give result columns short readable names. For "by X" questions return X first then the number, ordered by the number. For time trends return the date first, ordered by date. Round decimals to 2 places. Add LIMIT 50 unless it is a single aggregate.',
    },
    {
      role: 'user',
      content: `${schemaPrompt(t)}\n\nQuestion: ${question}${error ? `\n\nThis query failed:\n${error.sql}\nError: ${error.message}\nWrite a corrected query.` : ''}`,
    },
  ];
}

/** Prompt to explain a query result in plain words. */
export function explainMessages(question: string, sql: string, r: Result): { role: 'system' | 'user'; content: string }[] {
  const head = r.columns.join(' | ');
  const body = r.rows.slice(0, 25).map((row) => r.columns.map((c) => String(row[c])).join(' | ')).join('\n');
  return [
    { role: 'system', content: 'Answer the question in 1–2 plain sentences using only the query result. Lead with the direct answer and name the key numbers. No preamble, no SQL.' },
    { role: 'user', content: `Question: ${question}\nSQL: ${sql}\nResult (${r.rows.length} rows):\n${head}\n${body}` },
  ];
}

/** One-sentence deterministic reading of a result, for Instant mode. */
export function describeResult(r: Result): string {
  if (!r.rows.length) return 'The query returned no rows.';
  const fmt = (v: unknown) => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v));
  if (r.rows.length === 1) return r.columns.map((c) => `**${c.replace(/_/g, ' ')}**: ${fmt(r.rows[0][c])}`).join(' · ');
  const [x, y] = r.columns;
  if (y && typeof r.rows[0][y] === 'number') {
    const sorted = [...r.rows].sort((a, b) => Number(b[y]) - Number(a[y]));
    return `Highest **${y.replace(/_/g, ' ')}**: ${fmt(sorted[0][x])} (${fmt(sorted[0][y])}); lowest: ${fmt(sorted.at(-1)![x])} (${fmt(sorted.at(-1)![y])}) — across ${r.rows.length} groups.`;
  }
  return `${r.rows.length} rows returned.`;
}

/* A data contract inferred from the profile, as a dbt schema.yml with tests. */
export function contractYaml(t: Table): string {
  const out = ['version: 2', '', 'models:', `  - name: ${t.name}`, `    description: "Profiled from ${t.file} (${t.rows} rows)"`, '    columns:'];
  for (const c of t.columns) {
    out.push(`      - name: ${c.name}`, `        data_type: ${c.type.toLowerCase()}`);
    const tests: string[] = [];
    if (c.nullPct === 0) tests.push('          - not_null');
    if (c.unique) tests.push('          - unique');
    if (c.top?.length && c.top.length <= 12 && c.distinct <= 12 && /VARCHAR/i.test(c.type))
      tests.push('          - accepted_values:', `              values: [${c.top.map((x) => `'${x.v}'`).join(', ')}]`);
    if (isNum(c.type) && c.min != null && Number(c.min) >= 0) tests.push('          - dbt_utils.accepted_range:', '              min_value: 0');
    if (tests.length) out.push('        tests:', ...tests);
  }
  return out.join('\n');
}
