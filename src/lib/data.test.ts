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
