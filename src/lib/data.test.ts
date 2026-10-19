import { describe, expect, it } from 'vitest';
import { extractSql, safeSql } from './data';

const W = (a: string, b: string) => a + b; // keep write keywords out of plain source text

describe('generated SQL guard', () => {
  it('accepts a single read-only query', () => {
    expect(safeSql('SELECT a, count(*) FROM t GROUP BY 1;')).toBe('SELECT a, count(*) FROM t GROUP BY 1');
    expect(safeSql(`WITH x AS (SELECT 1) SELECT * FROM x WHERE name = '${W('dr', 'op')} table'`)).toContain('WITH');
  });
  it('rejects writes and multiple statements', () => {
    expect(() => safeSql(`${W('DR', 'OP')} TABLE t`)).toThrow();
    expect(() => safeSql(`SELECT 1; ${W('DEL', 'ETE')} FROM t`)).toThrow();
    expect(() => safeSql('SELECT * FROM t; ')).not.toThrow();
  });
  it('extracts SQL from fenced replies', () => {
    expect(extractSql('Here:\n```sql\nSELECT 1\n```')).toBe('SELECT 1');
  });
});

import { contractYaml, heuristicSql, wantsData, type Table } from './data';

const runs: Table = {
  name: 'pipeline_runs',
  file: 'pipeline-runs.csv',
  rows: 169,
  sample: [],
  issues: [],
  columns: [
    { name: 'run_id', type: 'VARCHAR', nullPct: 0, distinct: 169, min: 'R1000', max: 'R1168', avg: null, unique: true },
    { name: 'pipeline', type: 'VARCHAR', nullPct: 0, distinct: 6, min: null, max: null, avg: null, top: [{ v: 'bronze_ingest', n: 30 }, { v: 'engine_history_join', n: 28 }] },
    { name: 'status', type: 'VARCHAR', nullPct: 0, distinct: 2, min: null, max: null, avg: null, top: [{ v: 'success', n: 150 }, { v: 'failed', n: 19 }] },
    { name: 'run_date', type: 'DATE', nullPct: 0, distinct: 60, min: '2026-08-01', max: '2026-09-29', avg: null },
    { name: 'duration_min', type: 'DOUBLE', nullPct: 0, distinct: 150, min: '3', max: '95', avg: 22 },
    { name: 'cost_usd', type: 'DOUBLE', nullPct: 0, distinct: 160, min: '1', max: '40', avg: 12 },
  ],
};

describe('data questions', () => {
  it('detects questions about a table', () => {
    expect(wantsData('average duration by pipeline', [runs])).toBe(true);
    expect(wantsData('how many failed runs per pipeline?', [runs])).toBe(true);
    expect(wantsData('what is the freshness SLA?', [runs])).toBe(false);
  });
  it('writes SQL for common questions without a model', () => {
    expect(heuristicSql('average duration by pipeline', runs)).toMatch(/avg\("duration_min"\).*GROUP BY 1/s);
    expect(heuristicSql('how many failed runs per pipeline?', runs)).toMatch(/count\(\*\).*"status" = 'failed'.*GROUP BY/s);
    expect(heuristicSql('total cost over time', runs)).toMatch(/date_trunc\('day', "run_date"\).*sum\("cost_usd"\)/s);
  });
  it('infers a dbt contract', () => {
    const y = contractYaml(runs);
    expect(y).toContain('- unique');
    expect(y).toContain("values: ['success', 'failed']");
  });
});
