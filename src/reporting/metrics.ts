// Deterministic metrics math (spec §7.1): calculations and deltas are code.
// AI only ever writes prose over numbers computed here.

import { db } from '@/lib/db';

export type MetricRow = { source: string; metric_date: string; payload: Record<string, unknown> };

export type MetricsSummary = {
  bySource: Record<string, Record<string, number>>;
  deltas: Record<string, Record<string, { current: number; previous: number; pct: number | null }>>;
};

function sumNumeric(rows: MetricRow[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    out[r.source] ??= {};
    for (const [k, v] of Object.entries(r.payload ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[r.source][k] = (out[r.source][k] ?? 0) + v;
      }
    }
  }
  return out;
}

/** Sum a period's snapshots per source and compare with the prior period. */
export async function summarizeMetrics(
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<MetricsSummary> {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevStart = new Date(start.getTime() - days * 86400000);
  const prevEnd = new Date(start.getTime() - 86400000);

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const [{ data: cur }, { data: prev }] = await Promise.all([
    db().from('metrics_snapshots').select('source, metric_date, payload')
      .eq('client_id', clientId).gte('metric_date', periodStart).lte('metric_date', periodEnd),
    db().from('metrics_snapshots').select('source, metric_date, payload')
      .eq('client_id', clientId).gte('metric_date', iso(prevStart)).lte('metric_date', iso(prevEnd)),
  ]);

  const bySource = sumNumeric((cur ?? []) as MetricRow[]);
  const prevBySource = sumNumeric((prev ?? []) as MetricRow[]);

  const deltas: MetricsSummary['deltas'] = {};
  for (const [source, metrics] of Object.entries(bySource)) {
    deltas[source] = {};
    for (const [k, current] of Object.entries(metrics)) {
      const previous = prevBySource[source]?.[k] ?? 0;
      deltas[source][k] = {
        current,
        previous,
        pct: previous !== 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
      };
    }
  }

  return { bySource, deltas };
}
