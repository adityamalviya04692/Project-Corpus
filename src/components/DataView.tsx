import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Chart, { type ChartKind } from './Chart';
import { contractYaml, query, suggestCharts, type Result, type Table } from '../lib/data';

/* The data workspace: for each table, ask a question in plain English (→ SQL you can
   read and edit), see the column profile and quality checks, and auto-generated charts. */

export type SqlAnswer = { sql: string; result?: Result; error?: string; attempts: number };

const isNumType = (v: unknown) => typeof v === 'number';

/** Picks a chart for a result: (label, number) pairs become a bar or a line chart. */
function chartFor(r: Result): { kind: ChartKind; x: string; y: string } | null {
  if (r.columns.length < 2 || r.rows.length < 2 || r.rows.length > 60) return null;
  const [x, y] = r.columns;
  if (!isNumType(r.rows[0][y])) return null;
  const dateLike = /^\d{4}-\d{2}(-\d{2})?/.test(String(r.rows[0][x]));
  return { kind: dateLike ? 'line' : 'bar', x, y };
}

export function ResultView({ r, compact = false }: { r: Result; compact?: boolean }) {
  const chart = chartFor(r);
  return (
    <div className="result">
      {chart && <Chart kind={chart.kind} rows={r.rows} x={chart.x} y={chart.y} height={compact ? 190 : 230} />}
      <div className="result-table">
        <table>
          <thead>
            <tr>{r.columns.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {r.rows.slice(0, compact ? 12 : 50).map((row, i) => (
              <tr key={i}>{r.columns.map((c) => <td key={c}>{row[c] == null ? <i>null</i> : String(row[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {!compact && <small className="meta">{r.rows.length.toLocaleString()} row{r.rows.length === 1 ? '' : 's'} · {r.ms.toFixed(0)} ms in DuckDB</small>}
    </div>
  );
}

export default function DataView({
  tables, askSql, canAsk, engineName,
}: {
  tables: Table[];
  askSql: (q: string, t: Table) => Promise<SqlAnswer>;
  canAsk: boolean;
  engineName: string;
}) {
  const [active, setActive] = useState(tables[0]?.name);
  const t = tables.find((x) => x.name === active) ?? tables[0];
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<SqlAnswer | null>(null);
  const [sql, setSql] = useState('');
  const charts = useMemo(() => (t ? suggestCharts(t) : []), [t]);
  const [chartData, setChartData] = useState<Record<string, Result>>({});

  useEffect(() => {
    if (!t) return;
    setAnswer(null);
    setSql('');
    let alive = true;
    Promise.all(charts.map((c) => query(c.sql, 5000).then((r) => [c.title, r] as const)))
      .then((pairs) => alive && setChartData(Object.fromEntries(pairs)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [t, charts]);

  if (!t) return null;

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    const a = await askSql(question, t);
    setAnswer(a);
    setSql(a.sql);
    setBusy(false);
  };
  const run = async (s: string) => {
    setBusy(true);
    try {
      setAnswer({ sql: s, result: await query(s), attempts: 0 });
    } catch (e) {
      setAnswer({ sql: s, error: e instanceof Error ? e.message : String(e), attempts: 0 });
    }
    setSql(s);
    setBusy(false);
  };
  const suggestions = [
    ...charts.filter((c) => c.kind !== 'histogram').map((c) => ({ label: c.title, sql: c.sql })),
    { label: `Preview ${t.name}`, sql: `SELECT * FROM "${t.name}" LIMIT 50` },
  ];

  return (
    <section className="dataview" aria-label="Data workspace">
      <div className="table-tabs">
        {tables.map((x) => (
          <button key={x.name} className={x.name === t.name ? 'on' : ''} onClick={() => setActive(x.name)}>
            <b>{x.name}</b>
            <span>{x.rows.toLocaleString()} × {x.columns.length}</span>
          </button>
        ))}
      </div>

      <div className="ask-data">
        <form
          className="composer inline"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask ${t.name} in plain English… e.g. average cost by layer`} aria-label="Question about the data" />
          <button className="btn" disabled={busy || !q.trim()}>{busy ? 'Thinking…' : 'Ask'}</button>
        </form>
        {!canAsk && <small className="hint">Instant mode translates common questions with rules. Load Gemma or add a key and the model writes the SQL.</small>}
        <div className="chips left">
          {suggestions.map((s) => (
            <button key={s.label} onClick={() => run(s.sql)} disabled={busy}>{s.label}</button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="popLayout">
        {answer && (
          <motion.div key={answer.sql + (answer.error ?? '')} className="card sql-card" initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }}>
            <div className="sql-head">
              <span>SQL{answer.attempts > 1 ? ` · fixed after ${answer.attempts - 1} retry` : answer.attempts === 1 ? ` · written by ${engineName}` : ''}</span>
              <button className="mini" onClick={() => run(sql)} disabled={busy}>Run ▸</button>
            </div>
            <textarea className="sql" value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} rows={Math.min(8, sql.split('\n').length + 1)} aria-label="SQL" />
            {answer.error ? <p className="warn">{answer.error}</p> : answer.result && <ResultView r={answer.result} />}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card">
        <h4>Data quality · {t.rows.toLocaleString()} rows profiled</h4>
        <ul className="issues">
          {t.issues.map((i) => (
            <li key={i.text} className={i.level}>{i.text}</li>
          ))}
        </ul>
      </div>

      <div className="data-grid">
        {charts.map((c) =>
          chartData[c.title] ? (
            <div key={c.title} className="card">
              <h4>{c.title}</h4>
              <Chart kind={c.kind} rows={chartData[c.title].rows} />
            </div>
          ) : null,
        )}
      </div>

      <div className="card">
        <h4>Columns · {t.columns.length}</h4>
        <div className="col-grid">
          {t.columns.map((c) => (
            <div key={c.name} className="col-card">
              <div className="col-top">
                <b title={c.name}>{c.name}</b>
                <code>{c.type.toLowerCase()}</code>
              </div>
              <div className="nullbar" title={`${c.nullPct.toFixed(1)}% missing`}>
                <i style={{ width: `${100 - c.nullPct}%` }} />
              </div>
              {c.top && c.top.length > 1 && (
                <div className="topvals">
                  {c.top.slice(0, 4).map((x) => (
                    <span key={x.v} title={`${x.v}: ${x.n}`}>
                      <i style={{ width: `${(x.n / t.rows) * 100}%` }} />
                      <em>{x.v}</em>
                    </span>
                  ))}
                </div>
              )}
              <small>
                {c.unique ? 'unique · ' : ''}
                {c.distinct.toLocaleString()} distinct
                {c.avg != null && Number.isFinite(c.avg) ? ` · avg ${c.avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}
              </small>
              {c.min != null && (
                <small className="range">
                  {String(c.min).slice(0, 16)} → {String(c.max).slice(0, 16)}
                </small>
              )}
            </div>
          ))}
        </div>
      </div>

      <Contract t={t} />
    </section>
  );
}

/* The profile turned into a data contract: dbt tests a pipeline could enforce. */
function Contract({ t }: { t: Table }) {
  const yaml = useMemo(() => contractYaml(t), [t]);
  const [copied, setCopied] = useState(false);
  return (
    <details className="card contract">
      <summary>
        <h4>Data contract · dbt schema.yml</h4>
        <span>not_null, unique and accepted_values tests inferred from the profile</span>
      </summary>
      <div className="contract-body">
        <button
          className="mini"
          onClick={() => {
            void navigator.clipboard?.writeText(yaml).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <pre>{yaml}</pre>
      </div>
    </details>
  );
}
