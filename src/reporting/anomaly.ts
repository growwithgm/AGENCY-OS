// Anomaly detection is DETERMINISTIC: 7-day rolling mean ± 2σ (spec §7.5).
// AI never detects — it only explains what statistics already flagged.
// False alarms burn trust, so the threshold logic stays in code.

import { db } from '@/lib/db';
import { runAI } from '@/ai/runAI';
import { ANOMALY_EXPLAIN_SYSTEM } from '@/ai/prompts';

export type Anomaly = {
  clientId: string;
  source: string;
  metric: string;
  date: string;
  value: number;
  mean: number;
  stddev: number;
  direction: 'above' | 'below';
};

const WINDOW_DAYS = 7;
const SIGMA = 2;

/** Check yesterday's value for each numeric metric against its trailing window. */
export async function detectAnomalies(clientId: string, asOf = new Date()): Promise<Anomaly[]> {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const target = iso(new Date(asOf.getTime() - 86400000));
  const windowStart = iso(new Date(asOf.getTime() - (WINDOW_DAYS + 1) * 86400000));

  const { data: rows } = await db()
    .from('metrics_snapshots')
    .select('source, metric_date, payload')
    .eq('client_id', clientId)
    .gte('metric_date', windowStart)
    .lte('metric_date', target)
    .order('metric_date');

  const anomalies: Anomaly[] = [];
  const bySource = new Map<string, { metric_date: string; payload: Record<string, unknown> }[]>();
  for (const r of rows ?? []) {
    bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
  }

  for (const [source, series] of bySource) {
    const targetRow = series.find((r) => r.metric_date === target);
    if (!targetRow) continue;
    const window = series.filter((r) => r.metric_date !== target);
    if (window.length < 4) continue; // not enough history — stay silent, not wrong

    const metrics = Object.keys(targetRow.payload ?? {}).filter(
      (k) => typeof targetRow.payload[k] === 'number',
    );
    for (const metric of metrics) {
      const values = window
        .map((r) => r.payload?.[metric])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (values.length < 4) continue;

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      const stddev = Math.sqrt(variance);
      if (stddev === 0) continue;

      const value = targetRow.payload[metric] as number;
      if (Math.abs(value - mean) > SIGMA * stddev) {
        anomalies.push({
          clientId, source, metric, date: target, value,
          mean: Math.round(mean * 100) / 100,
          stddev: Math.round(stddev * 100) / 100,
          direction: value > mean ? 'above' : 'below',
        });
      }
    }
  }
  return anomalies;
}

export type AnomalyExplanation = { explanation: string; suggestedTask: { title: string; est_minutes: number } };

const explainSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['explanation', 'suggestedTask'],
  properties: {
    explanation: { type: 'string' },
    suggestedTask: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'est_minutes'],
      properties: {
        title: { type: 'string' },
        est_minutes: { type: 'integer' },
      },
    },
  },
} as const;

/** AI runs only AFTER detection, and only to explain + suggest a task. */
export async function explainAnomaly(anomaly: Anomaly, clientName: string): Promise<AnomalyExplanation> {
  const { result } = await runAI<AnomalyExplanation>({
    kind: 'anomaly_explain',
    model: 'kimi-k3',
    effort: 'low',
    system: ANOMALY_EXPLAIN_SYSTEM,
    messages: [{
      role: 'user',
      content: JSON.stringify({ client: clientName, ...anomaly }),
    }],
    maxTokens: 600,
    schema: explainSchema,
  });
  return result;
}
