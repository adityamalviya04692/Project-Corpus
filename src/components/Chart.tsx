import { useEffect, useRef } from 'react';
import type { Row } from '../lib/data';

/* Small ECharts wrapper (library loaded on first use). Colours come from the theme's
   CSS variables, so charts follow light/dark mode. */

export type ChartKind = 'bar' | 'line' | 'histogram';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function bins(values: number[], n = 20) {
  if (!values.length) return { labels: [] as string[], counts: [] as number[] };
  const lo = Math.min(...values), hi = Math.max(...values);
  const w = (hi - lo) / n || 1;
  const counts = new Array(n).fill(0);
  for (const v of values) counts[Math.min(n - 1, Math.floor((v - lo) / w))]++;
  return { labels: counts.map((_, i) => (lo + i * w).toFixed(w < 1 ? 2 : 0)), counts };
}

export default function Chart({ kind, rows, x = 'x', y = 'y', height = 220 }: { kind: ChartKind; rows: Row[]; x?: string; y?: string; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let chart: { dispose: () => void; resize: () => void } | null = null;
    const ro = new ResizeObserver(() => chart?.resize());
    void import('echarts').then((echarts) => {
      if (disposed || !el.current) return;
      const c = echarts.init(el.current, undefined, { renderer: 'svg' });
      chart = c;
      const ink = css('--muted') || '#888', line = css('--line') || '#ddd', brand = css('--brand') || '#4c5', accent = css('--accent') || '#f80';
      let labels: string[], values: number[];
      if (kind === 'histogram') {
        const b = bins(rows.map((r) => Number(r.v)).filter(Number.isFinite));
        labels = b.labels;
        values = b.counts;
      } else {
        labels = rows.map((r) => String(r[x]));
        values = rows.map((r) => Number(r[y]));
      }
      c.setOption({
        animationDuration: 700,
        animationEasing: 'cubicOut',
        animationDelay: (i: number) => i * 35,
        grid: { left: 8, right: 12, top: 14, bottom: 8, containLabel: true },
        tooltip: { trigger: 'axis', backgroundColor: css('--card'), borderColor: line, textStyle: { color: css('--ink'), fontSize: 12 } },
        xAxis: { type: 'category', data: labels, axisLabel: { color: ink, fontSize: 10, hideOverlap: true, interval: kind === 'line' ? 'auto' : 0, width: 72, overflow: 'truncate' }, axisLine: { lineStyle: { color: line } }, axisTick: { show: false } },
        yAxis: { type: 'value', axisLabel: { color: ink, fontSize: 10 }, splitLine: { lineStyle: { color: line, type: 'dashed' } } },
        series: [
          kind === 'line'
            ? { type: 'line', data: values, smooth: true, showSymbol: false, lineStyle: { width: 2.5, color: brand }, areaStyle: { color: brand, opacity: 0.12 } }
            : {
                type: 'bar',
                data: values,
                barMaxWidth: 30,
                itemStyle: {
                  borderRadius: [6, 6, 2, 2],
                  color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: kind === 'histogram' ? accent : brand },
                    { offset: 1, color: `${kind === 'histogram' ? accent : brand}55` },
                  ]),
                },
                emphasis: { itemStyle: { color: accent } },
              },
        ],
      });
      ro.observe(el.current);
    });
    return () => {
      disposed = true;
      ro.disconnect();
      chart?.dispose();
    };
  }, [kind, rows, x, y]);
  return <div ref={el} className="chart" style={{ height }} />;
}
