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

export async function query(sql: string, limit = 1000): Promise<Result> {
  const c = await connect();
  const t0 = performance.now();
  const res = await c.query(sql);
  const columns = res.schema.fields.map((f) => f.name);
  const rows: Row[] = [];
  const n = Math.min(res.numRows, limit);
  for (let i = 0; i < n; i++) {
    const r = res.get(i)!.toJSON() as Row;
    for (const k of columns) r[k] = plain(r[k]);
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

/** One SUMMARIZE pass for every column, plus a few data-quality checks. */
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
  const issues: Table['issues'] = [];
  const d = Number(dupes.rows[0].d);
  if (d > 0) issues.push({ level: 'warn', text: `${d.toLocaleString()} duplicate row${d > 1 ? 's' : ''}` });
  for (const c of columns) {
    if (c.nullPct >= 20) issues.push({ level: 'warn', text: `${c.name}: ${c.nullPct.toFixed(0)}% missing` });
    if (rows > 1 && c.distinct <= 1) issues.push({ level: 'info', text: `${c.name}: constant value` });
    if (rows > 20 && c.distinct >= rows * 0.98 && /VARCHAR|INT/.test(c.type)) issues.push({ level: 'info', text: `${c.name}: looks like an ID` });
  }
  if (!issues.length) issues.push({ level: 'info', text: 'No duplicates, nulls under 20%' });
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
  if (cats[0])
    out.push({ title: `Rows by ${cats[0].name}`, kind: 'bar', sql: `SELECT ${ident(cats[0].name)} AS x, count(*) AS y FROM ${T} GROUP BY 1 ORDER BY 2 DESC LIMIT 15` });
  if (cats[1])
    out.push({ title: `Rows by ${cats[1].name}`, kind: 'bar', sql: `SELECT ${ident(cats[1].name)} AS x, count(*) AS y FROM ${T} GROUP BY 1 ORDER BY 2 DESC LIMIT 15` });
  if (nums[1] ?? nums[0])
    out.push({ title: `Distribution of ${(nums[1] ?? nums[0]).name}`, kind: 'histogram', sql: `SELECT ${ident((nums[1] ?? nums[0]).name)} AS v FROM ${T} WHERE ${ident((nums[1] ?? nums[0]).name)} IS NOT NULL` });
  return out.slice(0, 4);
}

/** Schema + a few rows, as the model sees it for natural-language questions. */
export function schemaPrompt(t: Table): string {
  const cols = t.columns.map((c) => `  ${ident(c.name)} ${c.type}${c.distinct && c.distinct <= 12 && /VARCHAR/.test(c.type) ? `  -- e.g. ${t.sample.map((r) => r[c.name]).filter((v, i, a) => v != null && a.indexOf(v) === i).slice(0, 4).map((v) => `'${v}'`).join(', ')}` : ''}`);
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
  return [
    `# Dataset ${t.file}`,
    `Table ${t.name} has ${t.rows.toLocaleString()} rows and ${t.columns.length} columns.`,
    `Columns: ${t.columns.map((c) => `${c.name} (${c.type.toLowerCase()}${c.min != null ? `, ${c.min} to ${c.max}` : ''})`).join('; ')}.`,
    `Data quality: ${t.issues.map((i) => i.text).join('; ')}.`,
  ].join('\n\n');
}
